from collections.abc import Callable, Iterator
from contextlib import contextmanager
from datetime import datetime, timezone

import pytest
from fastapi.testclient import TestClient
from httpx import Response
from sqlalchemy import event, func, select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.security import hash_token, verify_password
from app.db.session import engine
from app.models import EmailVerificationToken, PasswordResetToken, User, UserSession
from app.services import auth as auth_service
from helpers import (
    PASSWORD,
    SENSITIVE_KEYS,
    add_user,
    columns,
    keys_in,
    let_cooldown_pass,
    recorded_selects,
    registration,
    token_from,
)

ACCEPTED = {
    "message": (
        "If that email address can be used for a new account, a verification "
        "email has been sent."
    )
}
HOLDERS = {
    "verified": {"verified": True},
    "unverified": {"verified": False},
    "deactivated": {"active": False},
}
NEW_ACCOUNT = registration(username="carol", email="carol@example.com")
TAKEN_EMAIL = registration(username="another", email="alice@example.com")


def count(session: Session, model: type) -> int:
    return session.scalar(select(func.count()).select_from(model))


def whole_answer(response: Response) -> tuple:
    return response.status_code, response.text, dict(response.headers)


@pytest.fixture
def hashed(monkeypatch: pytest.MonkeyPatch) -> list[str]:
    passwords: list[str] = []
    real = auth_service.hash_password

    def recording(password: str) -> str:
        passwords.append(password)
        return real(password)

    monkeypatch.setattr(auth_service, "hash_password", recording)
    return passwords


def first_answering(real: Callable, first: object) -> Callable:
    pending = [first]

    def answer(*args: object) -> object:
        return pending.pop() if pending else real(*args)

    return answer


@pytest.fixture
def race_lost(monkeypatch: pytest.MonkeyPatch) -> None:
    """The checks before the insert find nothing; only a constraint notices."""
    for function, nothing in (("_username_is_taken", False), ("_address_holder", None)):
        real = getattr(auth_service, function)
        monkeypatch.setattr(auth_service, function, first_answering(real, nothing))


@contextmanager
def recorded_statements() -> Iterator[list[str]]:
    statements: list[str] = []

    def record(conn, cursor, statement, parameters, context, executemany) -> None:
        # Savepoints belong to the test's transaction, not to the request.
        if "SAVEPOINT" not in statement:
            statements.append(" ".join(statement.split()))

    event.listen(engine, "before_cursor_execute", record)
    try:
        yield statements
    finally:
        event.remove(engine, "before_cursor_execute", record)


def test_valid_registration_succeeds(client: TestClient, session: Session) -> None:
    response = client.post("/auth/register", json=registration())

    assert response.status_code == 202
    assert response.json() == ACCEPTED

    user = session.scalars(select(User)).one()
    assert user.username == "alice"
    assert user.email == "alice@example.com"
    assert user.display_name == "Alice"
    assert user.is_active is True


def test_password_is_stored_only_as_an_argon2id_hash(
    client: TestClient, session: Session
) -> None:
    client.post("/auth/register", json=registration())

    user = session.scalars(select(User)).one()
    assert user.password_hash != PASSWORD
    assert PASSWORD not in user.password_hash
    assert user.password_hash.startswith("$argon2id$")
    assert verify_password(PASSWORD, user.password_hash)


def test_password_is_hashed_exactly_as_typed(
    client: TestClient, session: Session
) -> None:
    password = "  spaces are part of it  "
    client.post("/auth/register", json=registration(password=password))

    user = session.scalars(select(User)).one()
    assert verify_password(password, user.password_hash)
    assert not verify_password(password.strip(), user.password_hash)


def test_username_is_normalized_to_lowercase(
    client: TestClient, session: Session
) -> None:
    response = client.post("/auth/register", json=registration(username="  Alice_01 "))

    assert response.status_code == 202
    assert session.scalars(select(User.username)).one() == "alice_01"


def test_email_is_normalized_to_lowercase(client: TestClient, session: Session) -> None:
    response = client.post(
        "/auth/register", json=registration(email="  Alice.Smith@Example.COM ")
    )

    assert response.status_code == 202
    assert session.scalars(select(User.email)).one() == "alice.smith@example.com"


def test_display_name_is_trimmed_but_otherwise_kept(
    client: TestClient, session: Session
) -> None:
    client.post("/auth/register", json=registration(display_name="  Alice Smith  "))

    assert session.scalars(select(User.display_name)).one() == "Alice Smith"


def test_registration_creates_an_unverified_account(
    client: TestClient, session: Session
) -> None:
    client.post("/auth/register", json=registration())

    assert session.scalars(select(User)).one().email_verified_at is None


def test_registration_does_not_log_the_user_in(
    client: TestClient, session: Session
) -> None:
    response = client.post("/auth/register", json=registration())

    assert "set-cookie" not in response.headers
    assert count(session, UserSession) == 0
    assert client.get("/auth/me").status_code == 401


def test_registration_sends_a_verification_link(client: TestClient, outbox) -> None:
    client.post("/auth/register", json=registration())

    [(recipient, url)] = outbox.verification
    assert recipient == "alice@example.com"
    assert url.startswith(f"{settings.frontend_url}/verify-email?token=")


def test_verification_token_is_stored_hashed(
    client: TestClient, session: Session, outbox
) -> None:
    before = datetime.now(timezone.utc)
    client.post("/auth/register", json=registration())

    raw_token = token_from(outbox.verification[0][1])
    token = session.scalars(select(EmailVerificationToken)).one()
    assert token.token_hash == hash_token(raw_token)
    assert token.token_hash != raw_token
    assert token.used_at is None
    lifetime = settings.email_verification_token_lifetime
    after = datetime.now(timezone.utc)
    assert before + lifetime <= token.expires_at <= after + lifetime


def test_registration_response_contains_no_secrets(client: TestClient, outbox) -> None:
    response = client.post("/auth/register", json=registration())

    assert keys_in(response.json()).isdisjoint(SENSITIVE_KEYS)
    assert PASSWORD not in response.text
    assert token_from(outbox.verification[0][1]) not in response.text


def test_registration_response_holds_no_account_data(client: TestClient) -> None:
    response = client.post("/auth/register", json=registration())

    assert set(response.json()) == {"message"}
    assert "alice" not in response.text


@pytest.mark.parametrize("username", ["alice", "ALICE", " Alice "])
def test_duplicate_username_is_rejected(
    client: TestClient, session: Session, username: str
) -> None:
    add_user(session, "alice")

    response = client.post(
        "/auth/register",
        json=registration(username=username, email="another@example.com"),
    )

    assert response.status_code == 409
    assert response.json() == {"detail": "Username already in use."}
    assert count(session, User) == 1


@pytest.mark.parametrize(
    "email", ["free@example.com", "bob@example.com"], ids=["free email", "taken email"]
)
def test_taken_username_is_refused_alike_whether_or_not_the_email_is_taken(
    client: TestClient, session: Session, outbox, hashed: list[str], email: str
) -> None:
    add_user(session, "alice")
    add_user(session, "bob")

    with recorded_selects() as reads:
        response = client.post("/auth/register", json=registration(email=email))

    assert response.status_code == 409
    assert response.json() == {"detail": "Username already in use."}
    assert count(session, User) == 2
    assert hashed == []
    assert outbox.registration_notice == []
    [read] = reads
    assert "users.username" in read
    assert "users.email" not in read


@pytest.mark.parametrize("holder", HOLDERS)
def test_taken_email_is_answered_exactly_like_a_new_account(
    client: TestClient, session: Session, holder: str
) -> None:
    add_user(session, "alice", **HOLDERS[holder])

    new_account = client.post("/auth/register", json=NEW_ACCOUNT)
    taken = client.post("/auth/register", json=TAKEN_EMAIL)

    assert new_account.status_code == 202
    assert new_account.json() == ACCEPTED
    assert new_account.headers["cache-control"] == "no-store"
    assert "set-cookie" not in new_account.headers
    assert whole_answer(taken) == whole_answer(new_account)


@pytest.mark.parametrize("email", ["alice@example.com", "Alice@Example.com"])
def test_taken_email_creates_nothing_and_changes_nothing(
    client: TestClient, session: Session, email: str
) -> None:
    alice = add_user(session, "alice")
    before = columns(session, alice)

    response = client.post(
        "/auth/register",
        json=registration(
            username="another",
            email=email,
            password="an entirely different passphrase",
            display_name="Somebody Else",
        ),
    )

    assert response.status_code == 202
    assert count(session, User) == 1
    assert count(session, EmailVerificationToken) == 0
    assert count(session, PasswordResetToken) == 0
    assert count(session, UserSession) == 0
    assert columns(session, alice) == before


@pytest.mark.parametrize("email", ["alice@example.com", "Alice@Example.com"])
def test_taken_email_sends_its_owner_one_notice_and_no_link(
    client: TestClient, session: Session, outbox, email: str
) -> None:
    add_user(session, "alice")

    client.post("/auth/register", json=registration(username="another", email=email))

    assert outbox.registration_notice == ["alice@example.com"]
    assert outbox.verification == []
    assert outbox.password_reset == []


def test_unverified_holder_gets_the_notice_and_keeps_the_link_it_has(
    client: TestClient, session: Session, outbox
) -> None:
    client.post("/auth/register", json=registration())
    first_link = token_from(outbox.verification[0][1])
    # So that only the design keeps a new link from replacing it, not the cooldown.
    let_cooldown_pass(session)

    client.post("/auth/register", json=TAKEN_EMAIL)

    assert outbox.registration_notice == ["alice@example.com"]
    assert len(outbox.verification) == 1
    assert session.scalars(select(EmailVerificationToken.token_hash)).all() == [
        hash_token(first_link)
    ]
    assert (
        client.post("/auth/verify-email", json={"token": first_link}).status_code == 200
    )


def test_deactivated_holder_is_sent_nothing(
    client: TestClient, session: Session, outbox
) -> None:
    add_user(session, "alice", active=False)

    response = client.post("/auth/register", json=TAKEN_EMAIL)

    assert response.status_code == 202
    assert outbox.registration_notice == []
    assert outbox.verification == []
    assert outbox.password_reset == []


def test_new_account_is_sent_a_link_and_no_notice(client: TestClient, outbox) -> None:
    client.post("/auth/register", json=NEW_ACCOUNT)

    assert [to for to, _ in outbox.verification] == ["carol@example.com"]
    assert outbox.registration_notice == []


@pytest.mark.parametrize(
    "taken",
    [{"email": "another@example.com"}, {}],
    ids=["the username", "the username and the email"],
)
def test_username_conflict_only_the_database_catches_is_refused(
    client: TestClient, session: Session, race_lost: None, outbox, taken: dict
) -> None:
    add_user(session, "alice")

    response = client.post("/auth/register", json=registration(**taken))

    assert response.status_code == 409
    assert response.json() == {"detail": "Username already in use."}
    assert session.scalars(select(User.username)).all() == ["alice"]
    assert outbox.registration_notice == []


def test_email_conflict_only_the_database_catches_is_answered_like_a_new_account(
    client: TestClient,
    session: Session,
    race_lost: None,
    outbox,
    hashed: list[str],
) -> None:
    add_user(session, "alice")

    response = client.post("/auth/register", json=TAKEN_EMAIL)

    assert response.status_code == 202
    assert response.json() == ACCEPTED
    assert session.scalars(select(User.username)).all() == ["alice"]
    assert count(session, EmailVerificationToken) == 0
    assert outbox.verification == []
    assert outbox.registration_notice == ["alice@example.com"]
    assert hashed == [PASSWORD]


@pytest.mark.parametrize("holder", [None, *HOLDERS])
def test_password_is_hashed_once_whether_or_not_the_email_is_taken(
    client: TestClient, session: Session, hashed: list[str], holder: str | None
) -> None:
    if holder is not None:
        add_user(session, "alice", **HOLDERS[holder])

    client.post("/auth/register", json=TAKEN_EMAIL)

    assert hashed == [PASSWORD]


def test_password_is_hashed_even_when_no_more_notices_are_sent(
    client: TestClient, session: Session, hashed: list[str], outbox
) -> None:
    add_user(session, "alice")

    for username in ("another", "yet_another"):
        client.post(
            "/auth/register",
            json=registration(username=username, email="alice@example.com"),
        )

    assert hashed == [PASSWORD, PASSWORD]
    assert outbox.registration_notice == ["alice@example.com"]


def test_new_account_and_taken_email_read_the_same_and_write_about_the_same(
    client: TestClient, session: Session
) -> None:
    add_user(session, "alice")

    with recorded_statements() as new_account:
        client.post("/auth/register", json=NEW_ACCOUNT)
    with recorded_statements() as taken:
        client.post("/auth/register", json=TAKEN_EMAIL)

    def reads(statements: list[str]) -> list[str]:
        return [s for s in statements if s.startswith("SELECT")]

    def writes(statements: list[str]) -> list[str]:
        return [s for s in statements if not s.startswith("SELECT")]

    # The username, the holder, the email lock, the caps' counts.
    assert len(reads(taken)) == 4
    assert reads(new_account) == reads(taken)
    # Taken: per-IP counter, notice's, place. New: that counter, account, place, links.
    assert len(writes(taken)) == 3
    assert len(writes(new_account)) == 5


@pytest.mark.parametrize(
    "invalid",
    [
        {"username": "al"},
        {"username": "a" * 31},
        {"username": "alice smith"},
        {"username": "alice-smith"},
        {"username": "alice@home"},
        {"username": "álice"},
        {"username": ""},
        {"username": None},
        {"email": "not-an-email"},
        {"email": "alice@"},
        {"email": "alice@localhost"},
        {"email": "a" * 250 + "@example.com"},
        {"email": "älice@example.com"},
        {"email": ""},
        {"password": "short"},
        {"password": "x" * 11},
        {"password": "x" * 129},
        {"password": ""},
        {"password": 123456789012},
        {"display_name": ""},
        {"display_name": "   "},
        {"display_name": "x" * 51},
    ],
)
def test_invalid_registration_data_is_rejected(
    client: TestClient, session: Session, invalid: dict
) -> None:
    response = client.post("/auth/register", json=registration(**invalid))

    assert response.status_code == 422
    assert count(session, User) == 0


@pytest.mark.parametrize("missing", ["username", "email", "password", "display_name"])
def test_registration_requires_every_field(
    client: TestClient, session: Session, missing: str
) -> None:
    payload = registration()
    del payload[missing]

    response = client.post("/auth/register", json=payload)

    assert response.status_code == 422
    assert count(session, User) == 0


def test_field_length_limits_are_inclusive(client: TestClient) -> None:
    response = client.post(
        "/auth/register",
        json=registration(username="a" * 30, display_name="x" * 50, password="x" * 12),
    )

    assert response.status_code == 202


def test_password_minimum_length_comes_from_configuration(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(settings, "password_min_length", 20)

    too_short = client.post("/auth/register", json=registration(password="x" * 19))
    long_enough = client.post("/auth/register", json=registration(password="x" * 20))

    assert too_short.status_code == 422
    assert long_enough.status_code == 202


def test_password_needs_no_particular_character_classes(client: TestClient) -> None:
    response = client.post("/auth/register", json=registration(password="a" * 12))

    assert response.status_code == 202


def test_validation_error_does_not_echo_the_submitted_values(
    client: TestClient,
) -> None:
    payload = registration()
    del payload["username"]
    missing_field = client.post("/auth/register", json=payload)
    short_password = client.post(
        "/auth/register", json=registration(password="hunter2")
    )

    assert PASSWORD not in missing_field.text
    assert "hunter2" not in short_password.text
    for response in (missing_field, short_password):
        assert response.status_code == 422
        for error in response.json()["detail"]:
            assert set(error) == {"loc", "msg", "type"}


def test_client_cannot_set_fields_it_does_not_own(
    client: TestClient, session: Session
) -> None:
    response = client.post(
        "/auth/register",
        json=registration(
            is_active=False,
            email_verified_at="2020-01-01T00:00:00Z",
            password_hash="chosen-by-client",
            id="00000000-0000-0000-0000-000000000000",
        ),
    )

    assert response.status_code == 202
    user = session.scalars(select(User)).one()
    assert user.is_active is True
    assert user.email_verified_at is None
    assert user.password_hash.startswith("$argon2id$")
    assert str(user.id) != "00000000-0000-0000-0000-000000000000"


def test_registration_is_all_or_nothing(
    make_client, session: Session, monkeypatch: pytest.MonkeyPatch, outbox
) -> None:
    def fail() -> str:
        raise RuntimeError("token generation failed")

    monkeypatch.setattr(auth_service, "generate_token", fail)
    client = make_client(raise_server_exceptions=False)

    response = client.post("/auth/register", json=registration())

    assert response.status_code == 500
    assert count(session, User) == 0
    assert count(session, EmailVerificationToken) == 0
    assert outbox.verification == []
