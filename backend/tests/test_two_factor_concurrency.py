import base64
from datetime import datetime, timezone

import pytest
from sqlalchemy import func, select

from app.core import two_factor as codes
from app.core.config import settings
from app.db.session import SessionLocal
from app.models import LoginChallenge, RecoveryCode, TwoFactorCredential, UserSession
from app.services import auth as auth_service
from app.services import erasure, two_factor
from concurrency import (
    Account,
    Gate,
    at_once,
    one_after_the_other,
    signed_in,
    stopped_after,
)
from helpers import PASSWORD, log_in, token_from

SECRET = b"a secret for the race"[:20]
NEW_PASSWORD = "an entirely different passphrase"


def now() -> datetime:
    return datetime.now(timezone.utc)


def code() -> str:
    return codes.hotp(SECRET, codes.step_at(now()))


def switch_on(account: Account) -> None:
    with SessionLocal() as db:
        db.add(
            TwoFactorCredential(
                user_id=account.id,
                secret_ciphertext=codes.encrypt_secret(SECRET, account.id),
                enabled_at=now(),
                created_at=now(),
            )
        )
        db.commit()


def challenge_of(account: Account, number: int = 0) -> str:
    answer = log_in(account.client(number), account.name)
    assert answer.status_code == 202, answer.text
    return answer.json()["challenge"]


def second_step(account: Account, number: int, challenge: str, given: str):
    return account.client(number).post(
        "/auth/login/two-factor", json={"challenge": challenge, "code": given}
    )


def sessions_of(account: Account) -> int:
    with SessionLocal() as db:
        return db.scalar(
            select(func.count())
            .select_from(UserSession)
            .where(UserSession.user_id == account.id, UserSession.revoked_at.is_(None))
        )


def test_two_second_steps_with_the_same_code_at_once_exactly_one_succeeds(
    account,
) -> None:
    owner = account()
    switch_on(owner)
    challenge = challenge_of(owner)
    given = code()

    answers = at_once(2, lambda n: second_step(owner, n + 1, challenge, given).status_code)

    assert sorted(answers) == [200, 400]
    assert sessions_of(owner) == 1


def test_the_second_of_two_second_steps_waits_and_finds_the_challenge_gone(
    account, monkeypatch: pytest.MonkeyPatch
) -> None:
    owner = account()
    switch_on(owner)
    challenge = challenge_of(owner)
    given = code()
    gate = stopped_after(monkeypatch, two_factor, "credential_of")

    first, second, waited = one_after_the_other(
        lambda: second_step(owner, 1, challenge, given),
        lambda: second_step(owner, 2, challenge, given),
        gate,
    )

    assert waited
    assert first.status_code == 200
    assert second.json() == {"detail": "Invalid or expired login challenge."}
    assert sessions_of(owner) == 1


def test_one_recovery_code_at_once_works_once(account) -> None:
    owner = account()
    switch_on(owner)
    recovery = "AAAA-BBBB-CCCC-DDDD"
    with SessionLocal() as db:
        db.add(
            RecoveryCode(
                user_id=owner.id,
                code_hash=codes.recovery_code_hash(owner.id, recovery),
            )
        )
        db.commit()
    challenge = challenge_of(owner)

    answers = at_once(
        2, lambda n: second_step(owner, n + 1, challenge, recovery).status_code
    )

    assert sorted(answers) == [200, 400]
    with SessionLocal() as db:
        assert db.scalar(select(func.count()).select_from(RecoveryCode)) == 0


def test_wrong_codes_at_once_get_no_more_tries_than_the_limit(
    account, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(settings, "login_challenge_attempts", 1000)
    owner = account()
    switch_on(owner)
    challenge = challenge_of(owner)
    allowed = settings.two_factor_failures_per_account
    workers = allowed * 3

    answers = at_once(
        workers, lambda n: second_step(owner, n + 1, challenge, "000000").status_code
    )

    assert sorted(answers) == [400] * allowed + [429] * (workers - allowed)


def test_a_login_past_its_password_check_cannot_outrun_turning_it_on(
    account, monkeypatch: pytest.MonkeyPatch
) -> None:
    owner = account()
    holder = signed_in(owner, 0)
    started = holder.post("/auth/two-factor/start", json={"password": PASSWORD})
    text = started.json()["secret"]
    secret = base64.b32decode(text + "=" * (-len(text) % 8))
    gate = stopped_after(monkeypatch, auth_service, "verify_password")

    login, confirmed, _ = one_after_the_other(
        lambda: log_in(owner.client(1), owner.name),
        lambda: holder.post(
            "/auth/two-factor/confirm",
            json={
                "password": PASSWORD,
                "code": codes.hotp(secret, codes.step_at(now())),
            },
        ),
        gate,
    )

    assert confirmed.status_code == 200
    assert login.status_code == 202
    assert sessions_of(owner) == 1
    assert holder.get("/auth/me").status_code == 200


def test_a_login_about_to_take_the_lock_cannot_outrun_turning_it_on(
    account, monkeypatch: pytest.MonkeyPatch
) -> None:
    owner = account()
    holder = signed_in(owner, 0)
    started = holder.post("/auth/two-factor/start", json={"password": PASSWORD})
    text = started.json()["secret"]
    secret = base64.b32decode(text + "=" * (-len(text) % 8))
    gate = Gate()
    pause = gate.wrap(lambda: None)
    lock_account = auth_service._lock_account

    def pause_then_lock(*args: object, **kwargs: object) -> object:
        pause()
        return lock_account(*args, **kwargs)

    monkeypatch.setattr(auth_service, "_lock_account", pause_then_lock)

    login, confirmed, _ = one_after_the_other(
        lambda: log_in(owner.client(1), owner.name),
        lambda: holder.post(
            "/auth/two-factor/confirm",
            json={
                "password": PASSWORD,
                "code": codes.hotp(secret, codes.step_at(now())),
            },
        ),
        gate,
    )

    assert confirmed.status_code == 200
    assert login.status_code == 202
    assert sessions_of(owner) == 1


def test_a_second_step_during_a_password_reset_finds_the_challenge_gone(
    account, outbox, monkeypatch: pytest.MonkeyPatch
) -> None:
    owner = account()
    switch_on(owner)
    challenge = challenge_of(owner)
    assert (
        owner.client(3)
        .post("/auth/forgot-password", json={"email": owner.email})
        .status_code
        == 202
    )
    token = token_from(outbox.password_reset[-1][1])
    given = code()
    gate = stopped_after(monkeypatch, two_factor, "remove_challenges")

    reset, step, waited = one_after_the_other(
        lambda: owner.client(4).post(
            "/auth/reset-password",
            json={"token": token, "new_password": NEW_PASSWORD},
        ),
        lambda: second_step(owner, 1, challenge, given),
        gate,
    )

    assert waited
    assert reset.status_code == 200
    assert step.json() == {"detail": "Invalid or expired login challenge."}
    assert sessions_of(owner) == 0


def test_a_second_step_during_a_deletion_finds_nothing_and_opens_nothing(
    account, monkeypatch: pytest.MonkeyPatch
) -> None:
    owner = account()
    holder = signed_in(owner, 0)
    switch_on(owner)
    challenge = challenge_of(owner, 1)
    given = code()
    gate = stopped_after(monkeypatch, erasure, "erase_account")

    deleted, step, waited = one_after_the_other(
        lambda: holder.post("/auth/delete-account", json={"password": PASSWORD}),
        lambda: second_step(owner, 2, challenge, given),
        gate,
    )

    assert waited
    assert deleted.status_code == 204
    assert step.json() == {"detail": "Invalid or expired login challenge."}
    with SessionLocal() as db:
        for model in (TwoFactorCredential, RecoveryCode, LoginChallenge):
            assert db.scalar(select(func.count()).select_from(model)) == 0
