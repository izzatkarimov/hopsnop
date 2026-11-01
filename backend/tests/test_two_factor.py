import base64
import logging
import uuid
from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from urllib.parse import parse_qs, unquote, urlsplit

import pytest
from cryptography.exceptions import InvalidTag
from fastapi.testclient import TestClient
from httpx import Response
from sqlalchemy import event, func, select
from sqlalchemy.orm import Session

from app.core import two_factor as codes
from app.core.config import settings
from app.core.security import hash_token
from app.db.session import engine
from app.models import (
    LoginChallenge,
    QueuedEmail,
    RateLimit,
    RecoveryCode,
    TwoFactorCredential,
    User,
    UserSession,
)
from app.services import auth as auth_service
from app.services import rate_limit
from helpers import (
    PASSWORD,
    add_user,
    log_in,
    session_token,
    token_from,
    unzip,
)

ALICE = "alice@example.com"
ADDRESS = "203.0.113.7"
NEW_PASSWORD = "an entirely different passphrase"
WRONG_CODE_ANSWER = {"detail": "Invalid code."}
DEAD_CHALLENGE_ANSWER = {"detail": "Invalid or expired login challenge."}
NOT_A_CODE = "000000"


@pytest.fixture
def now(clock, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(auth_service, "_now", clock)
    return clock


@dataclass
class Enrolled:
    secret: bytes
    recovery_codes: list[str]


def secret_from(started: Response) -> bytes:
    text = started.json()["secret"]
    return base64.b32decode(text + "=" * (-len(text) % 8))


def code_at(secret: bytes, clock, steps: int = 0) -> str:
    return codes.hotp(secret, codes.step_at(clock.now) + steps)


def start(client: TestClient, password: str = PASSWORD) -> Response:
    return client.post("/auth/two-factor/start", json={"password": password})


def confirm(client: TestClient, code: str, password: str = PASSWORD) -> Response:
    return client.post(
        "/auth/two-factor/confirm", json={"password": password, "code": code}
    )


def disable(client: TestClient, code: str, password: str = PASSWORD) -> Response:
    return client.post(
        "/auth/two-factor/disable", json={"password": password, "code": code}
    )


def replace_codes(client: TestClient, code: str, password: str = PASSWORD) -> Response:
    return client.post(
        "/auth/two-factor/recovery-codes", json={"password": password, "code": code}
    )


def turn_on(client: TestClient, clock) -> Enrolled:
    started = start(client)
    assert started.status_code == 200
    secret = secret_from(started)
    confirmed = confirm(client, code_at(secret, clock))
    assert confirmed.status_code == 200, confirmed.text
    # On to a step whose code hasn't been used.
    clock.advance(seconds=codes.STEP_SECONDS)
    return Enrolled(secret, confirmed.json()["recovery_codes"])


def challenge_for(client: TestClient, identifier: str = "alice") -> str:
    answer = log_in(client, identifier)
    assert answer.status_code == 202, answer.text
    return answer.json()["challenge"]


def second_step(client: TestClient, challenge: str, code: str) -> Response:
    return client.post(
        "/auth/login/two-factor", json={"challenge": challenge, "code": code}
    )


def whole_answer(response: Response) -> tuple:
    return response.status_code, response.text, dict(response.headers)


def count(session: Session, model: type, *where: object) -> int:
    return session.scalar(select(func.count()).select_from(model).where(*where))


def alive_sessions(session: Session) -> int:
    return count(session, UserSession, UserSession.revoked_at.is_(None))


# The code itself


@pytest.mark.parametrize(
    ("seconds", "expected"),
    [
        (59, "94287082"),
        (1111111109, "07081804"),
        (1111111111, "14050471"),
        (1234567890, "89005924"),
        (2000000000, "69279037"),
        (20000000000, "65353130"),
    ],
)
def test_the_code_matches_the_sha1_vectors_of_rfc_6238(
    seconds: int, expected: str
) -> None:
    when = datetime.fromtimestamp(seconds, timezone.utc)

    assert codes.hotp(b"12345678901234567890", codes.step_at(when), 8) == expected
    assert codes.hotp(b"12345678901234567890", codes.step_at(when)) == expected[-6:]


@pytest.mark.parametrize("code", ["١٢٣٤٥٦", "12345", "1234567", "12a456", ""])
def test_only_six_ascii_digits_are_a_totp_code(code: str) -> None:
    assert not codes.is_totp_code(code)


def test_a_replayed_step_and_any_before_it_are_refused() -> None:
    secret, when = b"s" * 20, datetime(2026, 11, 1, tzinfo=timezone.utc)
    step = codes.step_at(when)

    assert codes.matching_step(secret, codes.hotp(secret, step), when, after=None) == step
    for after in (step, step + 1):
        code = codes.hotp(secret, step)
        assert codes.matching_step(secret, code, when, after=after) is None


# Turning it on


def test_start_returns_the_uri_and_the_secret_and_changes_nothing_yet(
    alice_client: TestClient, make_client, session: Session, alice_account: User, now
) -> None:
    answer = start(alice_client)

    assert answer.status_code == 200
    assert set(answer.json()) == {"secret", "otpauth_uri"}
    uri = urlsplit(answer.json()["otpauth_uri"])
    assert (uri.scheme, uri.netloc) == ("otpauth", "totp")
    assert unquote(uri.path) == "/Hopsnop:alice"
    assert parse_qs(uri.query) == {
        "secret": [answer.json()["secret"]],
        "issuer": ["Hopsnop"],
        "algorithm": ["SHA1"],
        "digits": ["6"],
        "period": ["30"],
    }
    assert len(secret_from(answer)) == 20
    me = alice_client.get("/users/me").json()
    assert (me["two_factor_enabled"], me["recovery_codes_left"]) == (False, 0)
    assert log_in(make_client()).status_code == 200


def test_the_right_code_turns_it_on_and_returns_ten_codes(
    alice_client: TestClient, session: Session, alice_account: User, now
) -> None:
    enrolled = turn_on(alice_client, now)

    assert len(enrolled.recovery_codes) == len(set(enrolled.recovery_codes)) == 10
    for code in enrolled.recovery_codes:
        assert len(code) == 19 and code.count("-") == 3
    me = alice_client.get("/users/me").json()
    assert (me["two_factor_enabled"], me["recovery_codes_left"]) == (True, 10)
    row = session.scalars(select(TwoFactorCredential)).one()
    assert row.enabled_at is not None and row.pending_until is None


def test_a_wrong_code_does_not_turn_it_on(
    alice_client: TestClient, session: Session, alice_account: User, now
) -> None:
    secret = secret_from(start(alice_client))

    answer = confirm(alice_client, codes.hotp(secret, codes.step_at(now.now) + 5))

    assert answer.status_code == 400
    assert answer.json() == WRONG_CODE_ANSWER
    assert alice_client.get("/users/me").json()["two_factor_enabled"] is False


def test_starting_again_replaces_the_pending_secret(
    alice_client: TestClient, session: Session, alice_account: User, now
) -> None:
    first = secret_from(start(alice_client))
    second = secret_from(start(alice_client))

    assert first != second
    assert confirm(alice_client, code_at(first, now)).status_code == 400
    assert confirm(alice_client, code_at(second, now)).status_code == 200
    assert count(session, TwoFactorCredential) == 1


def test_confirm_with_nothing_pending_is_refused(
    alice_client: TestClient, alice_account: User, now
) -> None:
    answer = confirm(alice_client, NOT_A_CODE)

    assert answer.status_code == 400
    assert answer.json() == {"detail": "No two-factor setup is pending."}


def test_a_pending_secret_stops_working_after_an_hour(
    alice_client: TestClient, session: Session, alice_account: User, now
) -> None:
    secret = secret_from(start(alice_client))
    now.advance(hours=1)

    answer = confirm(alice_client, code_at(secret, now))

    assert answer.json() == {"detail": "No two-factor setup is pending."}
    assert alice_client.get("/users/me").json()["two_factor_enabled"] is False


@pytest.mark.parametrize("step", ["start", "confirm"])
def test_starting_or_confirming_when_it_is_on_is_refused(
    alice_client: TestClient, session: Session, alice_account: User, now, step: str
) -> None:
    enrolled = turn_on(alice_client, now)
    before = session.scalars(select(TwoFactorCredential.secret_ciphertext)).one()

    answer = (
        start(alice_client)
        if step == "start"
        else confirm(alice_client, code_at(enrolled.secret, now))
    )

    assert answer.status_code == 409
    assert answer.json() == {"detail": "Two-factor login is already on."}
    assert session.scalars(select(TwoFactorCredential.secret_ciphertext)).one() == before


def test_every_route_needs_a_session(client: TestClient) -> None:
    for answer in (
        start(client),
        confirm(client, NOT_A_CODE),
        replace_codes(client, NOT_A_CODE),
        disable(client, NOT_A_CODE),
    ):
        assert answer.status_code == 401


def test_a_wrong_password_is_refused_counted_and_changes_nothing(
    alice_client: TestClient, session: Session, alice_account: User, now
) -> None:
    secret = secret_from(start(alice_client))
    limit = settings.password_confirmation_failures

    answers = [
        confirm(alice_client, code_at(secret, now), "not the password").status_code
        for _ in range(limit)
    ]

    assert answers == [400] * limit
    assert start(alice_client, "not the password").status_code == 429
    assert confirm(alice_client, code_at(secret, now)).status_code == 429
    assert alice_client.get("/users/me").json()["two_factor_enabled"] is False


def test_a_wrong_password_uses_up_no_code_attempt(
    alice_client: TestClient, session: Session, alice_account: User, now
) -> None:
    secret_from(start(alice_client))

    answer = confirm(alice_client, NOT_A_CODE, "not the password")

    assert answer.json() == {"detail": "Current password is incorrect."}
    key = rate_limit.key_hash("two-factor:account", str(alice_account.id))
    assert session.scalar(select(RateLimit.count).where(RateLimit.key_hash == key)) == 0


def test_a_wrong_code_uses_up_no_password_attempt(
    alice_client: TestClient, session: Session, alice_account: User, now
) -> None:
    secret_from(start(alice_client))

    confirm(alice_client, NOT_A_CODE)

    key = rate_limit.key_hash("password-confirmation:account", str(alice_account.id))
    assert session.scalar(select(RateLimit.count).where(RateLimit.key_hash == key)) == 0


# Login


def test_the_password_alone_starts_no_session_and_sets_no_cookie(
    alice_client: TestClient,
    make_client,
    session: Session,
    alice_account: User,
    now,
) -> None:
    turn_on(alice_client, now)
    before = count(session, UserSession)
    other = make_client()

    answer = log_in(other)

    assert answer.status_code == 202
    assert set(answer.json()) == {"challenge", "expires_at"}
    assert "set-cookie" not in answer.headers
    assert answer.headers["cache-control"] == "no-store"
    assert count(session, UserSession) == before
    assert other.get("/auth/me").status_code == 401


def test_a_challenge_is_stored_only_as_a_hash(
    alice_client: TestClient, make_client, session: Session, alice_account: User, now
) -> None:
    turn_on(alice_client, now)

    challenge = challenge_for(make_client())

    row = session.scalars(select(LoginChallenge)).one()
    assert row.token_hash == hash_token(challenge)
    assert row.token_hash != challenge
    assert row.expires_at - row.created_at == timedelta(minutes=5)


def test_the_second_step_with_a_totp_code_logs_in_exactly_as_login_does(
    alice_client: TestClient, make_client, session: Session, alice_account: User, now
) -> None:
    enrolled = turn_on(alice_client, now)
    other = make_client()

    answer = second_step(other, challenge_for(other), code_at(enrolled.secret, now))

    assert answer.status_code == 200
    assert answer.json()["username"] == "alice"
    assert "set-cookie" in answer.headers
    assert session_token(other)
    assert other.get("/auth/me").status_code == 200
    assert count(session, LoginChallenge) == 0


def test_the_second_step_with_a_recovery_code_logs_in_and_tells_the_owner(
    alice_client: TestClient,
    make_client,
    session: Session,
    alice_account: User,
    outbox,
    now,
) -> None:
    enrolled = turn_on(alice_client, now)
    other = make_client()

    answer = second_step(other, challenge_for(other), enrolled.recovery_codes[0])

    assert answer.status_code == 200
    assert other.get("/users/me").json()["recovery_codes_left"] == 9
    assert outbox.recovery_code_used == [ALICE]


def test_the_login_with_a_cookie_ends_the_old_session_only_at_the_second_step(
    make_client, alice_client: TestClient, session: Session, alice_account: User, now
) -> None:
    enrolled = turn_on(alice_client, now)
    old = session_token(alice_client)
    challenge = challenge_for(alice_client)

    assert alice_client.get("/auth/me").status_code == 200
    second_step(alice_client, challenge, code_at(enrolled.secret, now))

    row = session.scalars(
        select(UserSession).where(UserSession.token_hash == hash_token(old))
    ).one()
    session.refresh(row)
    assert row.revoked_at is not None


def test_a_password_that_needs_rehashing_is_upgraded_at_the_first_step(
    alice_client: TestClient,
    make_client,
    session: Session,
    alice_account: User,
    now,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    turn_on(alice_client, now)
    before = alice_account.password_hash
    monkeypatch.setattr(auth_service, "password_needs_rehash", lambda _: True)

    challenge_for(make_client())

    session.refresh(alice_account)
    assert alice_account.password_hash != before


def test_a_wrong_code_answers_alike_for_totp_replay_and_recovery_and_opens_nothing(
    alice_client: TestClient, make_client, session: Session, alice_account: User, now
) -> None:
    enrolled = turn_on(alice_client, now)
    used = code_at(enrolled.secret, now, -1)
    other = make_client()
    challenge = challenge_for(other)

    answers = [
        second_step(other, challenge, used),
        second_step(other, challenge, "AAAA-AAAA-AAAA-AAAA"),
    ]

    assert [a.json() for a in answers] == [WRONG_CODE_ANSWER] * 2
    assert {a.status_code for a in answers} == {400}
    assert {tuple(sorted(a.headers)) for a in answers} == {tuple(sorted(answers[0].headers))}
    assert "set-cookie" not in answers[0].headers
    assert other.get("/auth/me").status_code == 401


def test_expired_used_voided_and_unknown_challenges_answer_alike(
    alice_client: TestClient, make_client, session: Session, alice_account: User, now
) -> None:
    enrolled = turn_on(alice_client, now)
    other = make_client()

    used = challenge_for(other)
    second_step(other, used, code_at(enrolled.secret, now))
    now.advance(seconds=codes.STEP_SECONDS)
    other = make_client()

    voided = challenge_for(other)
    for _ in range(settings.login_challenge_attempts):
        assert second_step(other, voided, NOT_A_CODE).json() == WRONG_CODE_ANSWER

    expired = challenge_for(other)
    now.advance(minutes=5)
    code = code_at(enrolled.secret, now)

    answers = [
        second_step(other, challenge, code)
        for challenge in (expired, used, voided, "no such challenge")
    ]

    assert {a.status_code for a in answers} == {400}
    assert [a.json() for a in answers] == [DEAD_CHALLENGE_ANSWER] * 4
    assert other.get("/auth/me").status_code == 401


def test_a_code_after_a_challenge_is_used_up_leaves_it_used_up(
    alice_client: TestClient, make_client, session: Session, alice_account: User, now
) -> None:
    enrolled = turn_on(alice_client, now)
    other = make_client()
    challenge = challenge_for(other)
    for _ in range(settings.login_challenge_attempts):
        second_step(other, challenge, NOT_A_CODE)

    answer = second_step(other, challenge, code_at(enrolled.secret, now))

    assert answer.json() == DEAD_CHALLENGE_ANSWER
    assert count(session, LoginChallenge) == 0


def test_a_new_login_replaces_the_open_challenge(
    alice_client: TestClient, make_client, session: Session, alice_account: User, now
) -> None:
    enrolled = turn_on(alice_client, now)
    other = make_client()
    first = challenge_for(other)
    second = challenge_for(other)

    assert count(session, LoginChallenge) == 1
    code = code_at(enrolled.secret, now)
    assert second_step(other, first, code).json() == DEAD_CHALLENGE_ANSWER
    assert second_step(other, second, code).status_code == 200


def test_the_same_code_is_refused_the_second_time(
    alice_client: TestClient, make_client, session: Session, alice_account: User, now
) -> None:
    enrolled = turn_on(alice_client, now)
    code = code_at(enrolled.secret, now)
    first, second = make_client(), make_client()

    assert second_step(first, challenge_for(first), code).status_code == 200
    answer = second_step(second, challenge_for(second), code)

    assert answer.json() == WRONG_CODE_ANSWER


def test_the_code_that_confirmed_cannot_be_used_to_log_in(
    alice_client: TestClient, make_client, session: Session, alice_account: User, now
) -> None:
    secret = secret_from(start(alice_client))
    code = code_at(secret, now)
    confirm(alice_client, code)
    other = make_client()

    assert second_step(other, challenge_for(other), code).json() == WRONG_CODE_ANSWER


@pytest.mark.parametrize(
    ("steps", "accepted"), [(-2, False), (-1, True), (0, True), (1, True), (2, False)]
)
def test_one_step_of_drift_is_accepted_and_two_are_not(
    alice_client: TestClient,
    make_client,
    session: Session,
    alice_account: User,
    now,
    steps: int,
    accepted: bool,
) -> None:
    enrolled = turn_on(alice_client, now)
    # So that the step before this one is later than the code that confirmed.
    now.advance(seconds=5 * codes.STEP_SECONDS)
    other = make_client()

    answer = second_step(other, challenge_for(other), code_at(enrolled.secret, now, steps))

    assert (answer.status_code == 200) is accepted


def test_a_code_accepted_from_the_next_step_refuses_the_current_one(
    alice_client: TestClient, make_client, session: Session, alice_account: User, now
) -> None:
    enrolled = turn_on(alice_client, now)
    first, second = make_client(), make_client()
    ahead = code_at(enrolled.secret, now, 1)
    assert second_step(first, challenge_for(first), ahead).status_code == 200

    answer = second_step(second, challenge_for(second), code_at(enrolled.secret, now))

    assert answer.json() == WRONG_CODE_ANSWER


def test_a_code_with_spaces_and_a_recovery_code_in_lower_case_are_accepted(
    alice_client: TestClient, make_client, session: Session, alice_account: User, now
) -> None:
    enrolled = turn_on(alice_client, now)
    first, second = make_client(), make_client()
    code = code_at(enrolled.secret, now)

    spaced = f"{code[:3]} {code[3:]}"
    assert second_step(first, challenge_for(first), spaced).status_code == 200
    lower = enrolled.recovery_codes[0].lower().replace("-", " ")
    assert second_step(second, challenge_for(second), lower).status_code == 200


def test_wrong_password_answers_are_identical_with_it_on_and_off(
    alice_client: TestClient, make_client, session: Session, alice_account: User, now
) -> None:
    add_user(session, "bob")
    turn_on(alice_client, now)

    on = log_in(make_client(), "alice", "not the password")
    off = log_in(make_client(), "bob", "not the password")
    unknown = log_in(make_client(), "nobody_here", "not the password")

    assert on.status_code == 401
    assert whole_answer(on) == whole_answer(off) == whole_answer(unknown)
    assert count(session, LoginChallenge) == 0


def test_a_login_with_it_off_is_as_it_was(
    make_client, session: Session, alice_account: User
) -> None:
    client = make_client()

    answer = log_in(client)

    assert answer.status_code == 200
    assert "set-cookie" in answer.headers
    assert count(session, LoginChallenge) == 0


def test_a_right_password_with_it_on_uses_up_no_login_attempt(
    alice_client: TestClient, make_client, session: Session, alice_account: User, now
) -> None:
    turn_on(alice_client, now)

    for _ in range(settings.login_failures_per_identifier_and_ip + 2):
        assert log_in(make_client()).status_code == 202


def test_a_deactivated_account_is_refused_at_the_second_step(
    alice_client: TestClient, make_client, session: Session, alice_account: User, now
) -> None:
    enrolled = turn_on(alice_client, now)
    other = make_client()
    challenge = challenge_for(other)
    alice_account.is_active = False
    session.flush()

    answer = second_step(other, challenge, code_at(enrolled.secret, now))

    assert answer.json() == DEAD_CHALLENGE_ANSWER


# Recovery codes


def test_each_recovery_code_works_once_and_the_count_goes_down(
    alice_client: TestClient, make_client, session: Session, alice_account: User, now
) -> None:
    enrolled = turn_on(alice_client, now)
    first, second = make_client(), make_client()
    code = enrolled.recovery_codes[0]

    assert second_step(first, challenge_for(first), code).status_code == 200
    assert second_step(second, challenge_for(second), code).json() == WRONG_CODE_ANSWER
    assert first.get("/users/me").json()["recovery_codes_left"] == 9
    assert count(session, RecoveryCode) == 9


def test_recovery_codes_are_stored_only_as_keyed_hashes_of_this_account(
    alice_client: TestClient, session: Session, alice_account: User, now
) -> None:
    enrolled = turn_on(alice_client, now)

    stored = set(session.scalars(select(RecoveryCode.code_hash)))
    assert stored == {
        codes.recovery_code_hash(alice_account.id, code)
        for code in enrolled.recovery_codes
    }
    for code in enrolled.recovery_codes:
        assert code not in stored and hash_token(code) not in stored
        assert codes.recovery_code_hash(uuid.uuid4(), code) not in stored


def test_replacing_recovery_codes_voids_the_old_set_and_needs_the_app(
    alice_client: TestClient, make_client, session: Session, alice_account: User, now
) -> None:
    enrolled = turn_on(alice_client, now)

    refused = replace_codes(alice_client, enrolled.recovery_codes[0])
    assert refused.json() == WRONG_CODE_ANSWER
    assert count(session, RecoveryCode) == 10

    answer = replace_codes(alice_client, code_at(enrolled.secret, now))
    assert answer.status_code == 200
    fresh = answer.json()["recovery_codes"]
    assert len(fresh) == 10 and not set(fresh) & set(enrolled.recovery_codes)
    other = make_client()
    challenge = challenge_for(other)
    assert second_step(other, challenge, enrolled.recovery_codes[0]).json() == WRONG_CODE_ANSWER
    assert second_step(other, challenge, fresh[0]).status_code == 200


def test_replacing_recovery_codes_with_it_off_is_refused(
    alice_client: TestClient, alice_account: User, now
) -> None:
    answer = replace_codes(alice_client, NOT_A_CODE)

    assert answer.status_code == 400
    assert answer.json() == {"detail": "Two-factor login is off."}


# Turning it off


@pytest.mark.parametrize("with_code", ["totp", "recovery"])
def test_turning_it_off_needs_password_and_code_and_removes_everything(
    alice_client: TestClient,
    make_client,
    session: Session,
    alice_account: User,
    outbox,
    now,
    with_code: str,
) -> None:
    enrolled = turn_on(alice_client, now)
    challenge_for(make_client())
    code = (
        code_at(enrolled.secret, now)
        if with_code == "totp"
        else enrolled.recovery_codes[0]
    )

    assert disable(alice_client, code, "not the password").status_code == 400
    assert disable(alice_client, NOT_A_CODE).json() == WRONG_CODE_ANSWER
    assert count(session, TwoFactorCredential) == 1

    assert disable(alice_client, code).status_code == 200

    assert count(session, TwoFactorCredential) == 0
    assert count(session, RecoveryCode) == 0
    assert count(session, LoginChallenge) == 0
    assert log_in(make_client()).status_code == 200
    me = alice_client.get("/users/me").json()
    assert (me["two_factor_enabled"], me["recovery_codes_left"]) == (False, 0)
    assert outbox.two_factor_disabled == [ALICE]
    assert outbox.recovery_code_used == []


def test_turning_it_off_when_it_is_off_is_refused(
    alice_client: TestClient, alice_account: User, now
) -> None:
    answer = disable(alice_client, NOT_A_CODE)

    assert answer.json() == {"detail": "Two-factor login is off."}


def test_turning_it_off_with_only_a_pending_secret_is_refused(
    alice_client: TestClient, alice_account: User, now
) -> None:
    secret = secret_from(start(alice_client))

    answer = disable(alice_client, code_at(secret, now))

    assert answer.json() == {"detail": "Two-factor login is off."}


# Sessions


@pytest.mark.parametrize("action", ["on", "off", "replace"])
def test_other_sessions_end_and_the_current_one_stays(
    alice_client: TestClient,
    make_client,
    session: Session,
    alice_account: User,
    now,
    action: str,
) -> None:
    enrolled = turn_on(alice_client, now) if action != "on" else None
    # A session that exists before the action, whichever way it has to be started.
    elsewhere = make_client()
    if enrolled:
        answer = second_step(
            elsewhere, challenge_for(elsewhere), enrolled.recovery_codes[0]
        )
        assert answer.status_code == 200
    else:
        assert log_in(elsewhere).status_code == 200
    token_before = session_token(alice_client)

    if action == "on":
        turn_on(alice_client, now)
    elif action == "off":
        assert disable(alice_client, code_at(enrolled.secret, now)).status_code == 200
    else:
        answer = replace_codes(alice_client, code_at(enrolled.secret, now))
        assert answer.status_code == 200

    assert elsewhere.get("/auth/me").status_code == 401
    assert alice_client.get("/auth/me").status_code == 200
    assert session_token(alice_client) == token_before


def test_a_password_reset_ends_every_session_and_leaves_it_on(
    alice_client: TestClient,
    make_client,
    session: Session,
    alice_account: User,
    outbox,
    now,
) -> None:
    enrolled = turn_on(alice_client, now)
    other = make_client()
    other.post("/auth/forgot-password", json={"email": ALICE})
    token = token_from(outbox.password_reset[-1][1])

    answer = other.post(
        "/auth/reset-password", json={"token": token, "new_password": NEW_PASSWORD}
    )

    assert answer.status_code == 200
    assert alive_sessions(session) == 0
    assert count(session, TwoFactorCredential) == 1
    assert count(session, RecoveryCode) == 10
    login = log_in(other, "alice", NEW_PASSWORD)
    assert login.status_code == 202
    code = code_at(enrolled.secret, now)
    assert second_step(other, login.json()["challenge"], code).status_code == 200


def test_a_password_reset_voids_open_challenges_and_clears_the_counter(
    alice_client: TestClient,
    make_client,
    session: Session,
    alice_account: User,
    outbox,
    now,
) -> None:
    enrolled = turn_on(alice_client, now)
    attacker = make_client()
    challenge = challenge_for(attacker)
    second_step(attacker, challenge, NOT_A_CODE)
    attacker.post("/auth/forgot-password", json={"email": ALICE})
    token = token_from(outbox.password_reset[-1][1])

    attacker.post(
        "/auth/reset-password", json={"token": token, "new_password": NEW_PASSWORD}
    )

    code = code_at(enrolled.secret, now)
    assert second_step(attacker, challenge, code).json() == DEAD_CHALLENGE_ANSWER
    assert count(session, LoginChallenge) == 0
    key = rate_limit.key_hash("two-factor:account", str(alice_account.id))
    assert count(session, RateLimit, RateLimit.key_hash == key) == 0


def test_a_password_change_voids_open_challenges_and_clears_the_counter(
    alice_client: TestClient, make_client, session: Session, alice_account: User, now
) -> None:
    enrolled = turn_on(alice_client, now)
    attacker = make_client()
    challenge = challenge_for(attacker)
    second_step(attacker, challenge, NOT_A_CODE)

    changed = alice_client.post(
        "/auth/change-password",
        json={"current_password": PASSWORD, "new_password": NEW_PASSWORD},
    )

    assert changed.status_code == 200
    code = code_at(enrolled.secret, now)
    assert second_step(attacker, challenge, code).json() == DEAD_CHALLENGE_ANSWER
    key = rate_limit.key_hash("two-factor:account", str(alice_account.id))
    assert count(session, RateLimit, RateLimit.key_hash == key) == 0
    assert count(session, TwoFactorCredential) == 1


# Limits


def test_wrong_codes_are_limited_per_account_whatever_the_ip(
    alice_client: TestClient,
    make_client,
    session: Session,
    alice_account: User,
    now,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "login_challenge_attempts", 1000)
    enrolled = turn_on(alice_client, now)
    allowed = settings.two_factor_failures_per_account
    challenge = challenge_for(make_client())

    answers = [
        second_step(
            make_client(client=(f"192.0.2.{number + 1}", 50000)), challenge, NOT_A_CODE
        ).status_code
        for number in range(allowed)
    ]
    refused = second_step(
        make_client(client=("192.0.2.200", 50000)),
        challenge,
        code_at(enrolled.secret, now),
    )

    assert answers == [400] * allowed
    assert refused.status_code == 429
    assert refused.headers["retry-after"].isdigit()


def test_wrong_codes_are_limited_per_ip_across_accounts(
    make_client,
    session: Session,
    now,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "two_factor_failures_per_ip", 2)
    client = make_client(client=(ADDRESS, 50000))

    answers = [
        second_step(client, "no such challenge", NOT_A_CODE).status_code
        for _ in range(3)
    ]

    assert answers == [400, 400, 429]


def test_a_right_code_gives_its_places_back(
    alice_client: TestClient, make_client, session: Session, alice_account: User, now
) -> None:
    enrolled = turn_on(alice_client, now)
    other = make_client(client=(ADDRESS, 50000))

    assert second_step(other, challenge_for(other), code_at(enrolled.secret, now)).status_code == 200

    for scope, subject in (
        ("two-factor:account", str(alice_account.id)),
        ("two-factor:address", ADDRESS),
    ):
        key = rate_limit.key_hash(scope, subject)
        assert session.scalar(select(RateLimit.count).where(RateLimit.key_hash == key)) == 0


def test_wrong_codes_on_turning_it_off_count_against_the_same_limit(
    alice_client: TestClient, session: Session, alice_account: User, now
) -> None:
    enrolled = turn_on(alice_client, now)
    allowed = settings.two_factor_failures_per_account

    answers = [disable(alice_client, NOT_A_CODE).status_code for _ in range(allowed)]

    assert answers == [400] * allowed
    assert disable(alice_client, code_at(enrolled.secret, now)).status_code == 429
    assert count(session, TwoFactorCredential) == 1


# Notices


def fill_the_failure_counter(make_client, challenge: str) -> list[int]:
    return [
        second_step(
            make_client(client=(f"192.0.2.{number + 1}", 50000)), challenge, NOT_A_CODE
        ).status_code
        for number in range(settings.two_factor_failures_per_account)
    ]


def test_turning_it_on_and_off_each_tell_the_owner_once(
    alice_client: TestClient, session: Session, alice_account: User, outbox, now
) -> None:
    enrolled = turn_on(alice_client, now)
    assert outbox.two_factor_enabled == [ALICE]
    assert outbox.two_factor_disabled == []

    disable(alice_client, code_at(enrolled.secret, now))

    assert outbox.two_factor_enabled == [ALICE]
    assert outbox.two_factor_disabled == [ALICE]


def test_a_failed_setup_tells_nobody(
    alice_client: TestClient, alice_account: User, outbox, now
) -> None:
    start(alice_client)
    confirm(alice_client, NOT_A_CODE)

    assert outbox.two_factor_enabled == []


def test_a_filled_failure_counter_tells_the_owner_once_per_window(
    alice_client: TestClient,
    make_client,
    session: Session,
    alice_account: User,
    outbox,
    now,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "login_challenge_attempts", 1000)
    turn_on(alice_client, now)
    challenge = challenge_for(make_client())
    allowed = settings.two_factor_failures_per_account

    for number in range(allowed - 1):
        second_step(make_client(client=(f"192.0.2.{number + 1}", 50000)), challenge, NOT_A_CODE)
    assert outbox.two_factor_failures == []

    last = second_step(make_client(client=("192.0.2.100", 50000)), challenge, NOT_A_CODE)
    assert last.json() == WRONG_CODE_ANSWER
    assert outbox.two_factor_failures == [ALICE]

    # Filled again in the same window, once places are free.
    session.execute(
        RateLimit.__table__.update()
        .where(
            RateLimit.key_hash
            == rate_limit.key_hash("two-factor:account", str(alice_account.id))
        )
        .values(count=allowed - 1)
    )
    again = second_step(make_client(client=("192.0.2.101", 50000)), challenge, NOT_A_CODE)
    assert again.status_code == 400
    assert outbox.two_factor_failures == [ALICE]


def test_the_failure_notice_comes_again_in_the_next_window(
    alice_client: TestClient,
    make_client,
    session: Session,
    alice_account: User,
    outbox,
    now,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "login_challenge_attempts", 1000)
    offset = timedelta()
    monkeypatch.setattr(
        rate_limit, "_now", lambda: datetime.now(timezone.utc) + offset
    )
    turn_on(alice_client, now)
    challenge = challenge_for(make_client())
    fill_the_failure_counter(make_client, challenge)
    assert len(outbox.two_factor_failures) == 1

    offset = settings.rate_limit_window
    now.advance(minutes=settings.rate_limit_window_minutes - 4)
    fresh = challenge_for(make_client())
    fill_the_failure_counter(make_client, fresh)

    assert len(outbox.two_factor_failures) == 2


def test_the_failure_notice_is_silent_and_the_answer_stays_the_same(
    alice_client: TestClient,
    make_client,
    session: Session,
    alice_account: User,
    outbox,
    now,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "login_challenge_attempts", 1000)
    turn_on(alice_client, now)
    challenge = challenge_for(make_client())

    first = second_step(make_client(client=("192.0.2.1", 50000)), challenge, NOT_A_CODE)
    for number in range(settings.two_factor_failures_per_account - 2):
        second_step(make_client(client=(f"192.0.2.{number + 2}", 50000)), challenge, NOT_A_CODE)
    filling = second_step(make_client(client=("192.0.2.1", 50000)), challenge, NOT_A_CODE)

    assert outbox.two_factor_failures == [ALICE]
    assert whole_answer(filling) == whole_answer(first)


def test_security_notices_skip_the_cap_per_client_but_not_the_total(
    alice_client: TestClient,
    make_client,
    session: Session,
    alice_account: User,
    outbox,
    now,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    client_hash = rate_limit.key_hash("queued-email:client", "testclient")
    address_hash = rate_limit.key_hash("queued-email:address", ALICE)
    queue_time = datetime.now(timezone.utc)
    session.add_all(
        QueuedEmail(address_hash=address_hash, client_hash=client_hash, queued_at=queue_time)
        for _ in range(settings.emails_per_address_and_ip_per_day)
    )
    session.flush()

    enrolled = turn_on(alice_client, now)
    assert outbox.two_factor_enabled == [ALICE]

    used = count(session, QueuedEmail)
    monkeypatch.setattr(settings, "emails_per_day", used)
    answer = disable(alice_client, code_at(enrolled.secret, now))

    assert answer.status_code == 200
    assert outbox.two_factor_disabled == []
    assert count(session, TwoFactorCredential) == 0


def test_the_failure_notice_stays_under_the_total_and_the_answer_is_the_same(
    alice_client: TestClient,
    make_client,
    session: Session,
    alice_account: User,
    outbox,
    now,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "login_challenge_attempts", 1000)
    turn_on(alice_client, now)
    monkeypatch.setattr(settings, "emails_per_day", count(session, QueuedEmail))
    challenge = challenge_for(make_client())

    answers = fill_the_failure_counter(make_client, challenge)

    assert answers == [400] * settings.two_factor_failures_per_account
    assert outbox.two_factor_failures == []


def test_the_failure_notice_goes_out_with_the_cap_per_client_full(
    alice_client: TestClient,
    make_client,
    session: Session,
    alice_account: User,
    outbox,
    now,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "login_challenge_attempts", 1000)
    monkeypatch.setattr(settings, "emails_per_address_and_ip_per_day", 1)
    turn_on(alice_client, now)
    other = make_client()
    other.post("/auth/forgot-password", json={"email": ALICE})
    challenge = challenge_for(other)

    for _ in range(settings.two_factor_failures_per_account):
        second_step(other, challenge, NOT_A_CODE)

    assert outbox.two_factor_failures == [ALICE]


def test_a_failed_notice_changes_nothing_about_a_finished_turning_off(
    alice_client: TestClient,
    session: Session,
    alice_account: User,
    now,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    enrolled = turn_on(alice_client, now)
    monkeypatch.setattr(settings, "emails_per_day", count(session, QueuedEmail))

    assert disable(alice_client, code_at(enrolled.secret, now)).status_code == 200
    assert count(session, TwoFactorCredential) == 0


def test_a_security_notice_uses_up_nothing_of_a_clients_allowance(
    alice_client: TestClient, session: Session, alice_account: User, outbox, now
) -> None:
    turn_on(alice_client, now)

    row = session.scalars(select(QueuedEmail)).one()
    assert row.address_hash == rate_limit.key_hash("queued-email:address", ALICE)
    assert row.client_hash is None


# Lock order


def statements_of(action: Callable[[], object]) -> list[str]:
    statements: list[str] = []

    def record(conn, cursor, statement, parameters, context, executemany) -> None:
        if "SAVEPOINT" not in statement:
            statements.append(" ".join(statement.split()))

    event.listen(engine, "before_cursor_execute", record)
    try:
        action()
    finally:
        event.remove(engine, "before_cursor_execute", record)
    return statements


def in_order(statements: list[str], *fragments: tuple[str, ...]) -> None:
    def first(needles: tuple[str, ...]) -> int:
        return next(
            n
            for n, statement in enumerate(statements)
            if all(needle in statement for needle in needles)
        )

    positions = [first(fragment) for fragment in fragments]
    assert positions == sorted(positions), fragments


def test_a_second_step_locks_the_account_then_the_challenge_and_then_writes(
    alice_client: TestClient, make_client, session: Session, alice_account: User, now
) -> None:
    enrolled = turn_on(alice_client, now)
    other = make_client()
    challenge = challenge_for(other)
    code = code_at(enrolled.secret, now)

    statements = statements_of(lambda: second_step(other, challenge, code))

    in_order(
        statements,
        ("INSERT INTO rate_limits",),
        ("FROM users", "FOR NO KEY UPDATE"),
        ("FROM login_challenges", "FOR UPDATE"),
        ("FROM two_factor_credentials",),
        ("INSERT INTO sessions",),
    )


def test_turning_it_on_locks_the_account_then_writes_and_only_then_takes_the_email_lock(
    alice_client: TestClient, session: Session, alice_account: User, now
) -> None:
    secret = secret_from(start(alice_client))
    code = code_at(secret, now)

    statements = statements_of(lambda: confirm(alice_client, code))

    in_order(
        statements,
        ("INSERT INTO rate_limits",),
        ("FROM users", "FOR NO KEY UPDATE"),
        ("FROM two_factor_credentials",),
        ("INSERT INTO recovery_codes",),
        ("UPDATE sessions SET",),
        ("pg_advisory_xact_lock",),
    )


def test_turning_it_off_locks_the_account_then_writes_and_only_then_takes_the_email_lock(
    alice_client: TestClient, session: Session, alice_account: User, now
) -> None:
    enrolled = turn_on(alice_client, now)
    code = code_at(enrolled.secret, now)

    statements = statements_of(lambda: disable(alice_client, code))

    in_order(
        statements,
        ("FROM users", "FOR NO KEY UPDATE"),
        ("DELETE FROM two_factor_credentials",),
        ("DELETE FROM recovery_codes",),
        ("DELETE FROM login_challenges",),
        ("UPDATE sessions SET",),
        ("pg_advisory_xact_lock",),
    )


# The secret at rest and in the open


def test_the_secret_is_encrypted_at_rest_and_opens_only_with_the_key_and_for_its_account(
    alice_client: TestClient,
    session: Session,
    alice_account: User,
    now,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    started = start(alice_client)
    secret, text = secret_from(started), started.json()["secret"]

    stored = session.scalars(select(TwoFactorCredential.secret_ciphertext)).one()

    assert secret not in stored and text.encode() not in stored
    assert codes.decrypt_secret(stored, alice_account.id) == secret
    with pytest.raises(InvalidTag):
        codes.decrypt_secret(stored, uuid.uuid4())
    other_key = base64.urlsafe_b64encode(b"o" * 32).decode()
    monkeypatch.setattr(settings, "two_factor_key", type(settings.two_factor_key)(other_key))
    with pytest.raises(InvalidTag):
        codes.decrypt_secret(stored, alice_account.id)


def test_two_encryptions_of_one_secret_differ() -> None:
    user_id = uuid.uuid4()

    assert codes.encrypt_secret(b"s" * 20, user_id) != codes.encrypt_secret(b"s" * 20, user_id)


def test_no_response_after_the_setup_and_no_log_holds_the_secret_or_the_codes(
    alice_client: TestClient,
    make_client,
    session: Session,
    alice_account: User,
    now,
    caplog: pytest.LogCaptureFixture,
) -> None:
    caplog.set_level(logging.DEBUG)
    started = start(alice_client)
    text, secret = started.json()["secret"], secret_from(started)
    code = code_at(secret, now)
    confirmed = confirm(alice_client, code)
    recovery_codes = confirmed.json()["recovery_codes"]
    now.advance(seconds=codes.STEP_SECONDS)
    other = make_client()
    login = log_in(other)
    challenge = login.json()["challenge"]
    wrong = second_step(other, challenge, NOT_A_CODE)
    right = second_step(other, challenge, recovery_codes[0])
    me = alice_client.get("/users/me")
    auth_me = alice_client.get("/auth/me")
    sessions = alice_client.get("/auth/sessions")
    exported = alice_client.post("/users/me/export", json={"password": PASSWORD})
    document, _ = unzip(exported)

    hashes = list(session.scalars(select(RecoveryCode.code_hash)))
    secrets_here = [text, code, challenge, *recovery_codes, *hashes]
    for answer in (login, wrong, right, me, auth_me, sessions):
        for secret_text in secrets_here:
            if answer is login and secret_text == challenge:
                continue
            assert secret_text not in answer.text
    assert str(document).find(text) == -1
    for secret_text in secrets_here:
        assert secret_text not in caplog.text
        assert secret_text not in str(document)


def test_the_profile_says_only_whether_it_is_on_and_how_many_codes_are_left(
    alice_client: TestClient, alice_account: User, now, session: Session
) -> None:
    before = alice_client.get("/users/me").json()
    turn_on(alice_client, now)
    after = alice_client.get("/users/me").json()

    assert (before["two_factor_enabled"], before["recovery_codes_left"]) == (False, 0)
    assert (after["two_factor_enabled"], after["recovery_codes_left"]) == (True, 10)
    assert alice_client.get("/users/alice").json().get("two_factor_enabled") is None
    assert "two_factor_enabled" not in alice_client.get("/auth/me").json()


def test_the_export_says_whether_it_is_on_and_since_when(
    alice_client: TestClient, session: Session, alice_account: User, now
) -> None:
    def document() -> dict:
        return unzip(
            alice_client.post("/users/me/export", json={"password": PASSWORD})
        )[0]

    assert document()["two_factor"] == {"enabled": False, "enabled_at": None}

    secret_from(start(alice_client))
    assert document()["two_factor"] == {"enabled": False, "enabled_at": None}


def test_the_export_gives_when_it_was_turned_on(
    alice_client: TestClient, session: Session, alice_account: User, now
) -> None:
    turn_on(alice_client, now)

    document, _ = unzip(alice_client.post("/users/me/export", json={"password": PASSWORD}))

    assert document["two_factor"]["enabled"] is True
    assert document["two_factor"]["enabled_at"]


def test_deleting_the_account_removes_all_of_it_and_its_counters(
    alice_client: TestClient, make_client, session: Session, alice_account: User, now
) -> None:
    turn_on(alice_client, now)
    other = make_client()
    second_step(other, challenge_for(other), NOT_A_CODE)
    alice_id = alice_account.id

    answer = alice_client.post("/auth/delete-account", json={"password": PASSWORD})

    assert answer.status_code == 204
    for model in (TwoFactorCredential, RecoveryCode, LoginChallenge):
        assert count(session, model) == 0
    for scope in ("two-factor:account", "two-factor-failure-notice:account"):
        key = rate_limit.key_hash(scope, str(alice_id))
        assert count(session, RateLimit, RateLimit.key_hash == key) == 0
