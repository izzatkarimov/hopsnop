import logging
import re
import uuid
from collections.abc import Callable, Iterator
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone

import httpx
import pytest
from fastapi.testclient import TestClient
from httpx import Response
from pydantic import SecretStr
from sqlalchemy import delete, event, func, select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.security import hash_token
from app.db.session import SessionLocal, engine
from app.main import app
from app.models import (
    EmailVerificationToken,
    PasswordResetToken,
    QueuedEmail,
    RateLimit,
    User,
)
from app.services import auth as auth_service
from app.services import email_caps, rate_limit
from app.services.email import ConsoleEmailSender, ResendEmailSender, get_email_sender
from app.services.rate_limit import key_hash
from concurrency import at_once
from helpers import PASSWORD, add_user, let_cooldown_pass, log_in, registration, token_from

ADDRESS = "203.0.113.7"
OTHER_ADDRESS = "198.51.100.23"
SOMEONE = "192.0.2.99"
ALICE = "alice@example.com"
NEW_PASSWORD = "an entirely different passphrase"
LOGGER = "app.services.email_caps"
CLIENT_CAP_LINE = "An email was not sent: EMAILS_PER_ADDRESS_AND_IP_PER_DAY is reached."
TOTAL_SKIP_LINE = "An email was not sent: EMAILS_PER_DAY is reached."


@pytest.fixture
def at(make_client: Callable[..., TestClient]) -> Callable[[str], TestClient]:
    def client_at(address: str) -> TestClient:
        return make_client(client=(address, 50000))

    return client_at


@pytest.fixture
def pass_time(monkeypatch: pytest.MonkeyPatch) -> Callable[..., None]:
    offset = timedelta()

    def now() -> datetime:
        return datetime.now(timezone.utc) + offset

    def forward(**duration: float) -> None:
        nonlocal offset
        offset += timedelta(**duration)

    for module in (rate_limit, auth_service, email_caps):
        monkeypatch.setattr(module, "_now", now)
    return forward


@pytest.fixture
def only_the_caps(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "email_token_cooldown_seconds", 0)
    monkeypatch.setattr(settings, "registration_notices_per_account", 1000)
    monkeypatch.setattr(settings, "email_requests_per_ip", 1000)
    monkeypatch.setattr(settings, "registrations_per_ip", 1000)


def count(session: Session, model: type = QueuedEmail) -> int:
    return session.scalar(select(func.count()).select_from(model))


def forgot(client: TestClient, email: str = ALICE) -> Response:
    return client.post("/auth/forgot-password", json={"email": email})


def resend(client: TestClient, email: str = ALICE) -> Response:
    return client.post("/auth/resend-verification", json={"email": email})


def register(client: TestClient, email: str = ALICE) -> Response:
    username = f"n{uuid.uuid4().hex[:12]}"
    return client.post(
        "/auth/register", json=registration(username=username, email=email)
    )


def remove(client: TestClient) -> Response:
    return client.post("/auth/delete-account", json={"password": PASSWORD})


def whole_answer(response: Response) -> tuple:
    return response.status_code, response.text, dict(response.headers)


def emails_sent(outbox) -> int:
    return (
        len(outbox.verification)
        + len(outbox.password_reset)
        + len(outbox.registration_notice)
    )


def queue(
    session: Session,
    email: str = ALICE,
    client: str = ADDRESS,
    *,
    times: int = 1,
    at_time: datetime | None = None,
) -> None:
    session.add_all(
        QueuedEmail(
            address_hash=key_hash("queued-email:address", email),
            client_hash=key_hash("queued-email:client", client),
            queued_at=at_time or datetime.now(timezone.utc),
        )
        for _ in range(times)
    )
    session.flush()


def fill_the_total(session: Session) -> None:
    queue(session, "someone.else@example.com", SOMEONE, times=settings.emails_per_day)


def caps_log(caplog: pytest.LogCaptureFixture) -> list[logging.LogRecord]:
    return [record for record in caplog.records if record.name == LOGGER]


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


def first(statements: list[str], fragment: str) -> int:
    return next(n for n, statement in enumerate(statements) if fragment in statement)


def test_one_client_gets_at_most_the_cap_to_one_address_across_every_kind_of_email(
    at, session: Session, outbox, only_the_caps: None
) -> None:
    add_user(session, "alice", verified=False)
    client = at(ADDRESS)
    cap = settings.emails_per_address_and_ip_per_day
    kinds = (resend, forgot, register)

    for number in range(cap):
        assert kinds[number % len(kinds)](client).status_code == 202

    assert emails_sent(outbox) == cap
    assert outbox.verification and outbox.password_reset and outbox.registration_notice
    for kind in kinds:
        assert kind(client).status_code == 202
    assert emails_sent(outbox) == cap


def test_another_client_still_gets_a_reset_sent_once_one_has_used_up_its_places(
    at, session: Session, outbox, only_the_caps: None
) -> None:
    add_user(session, "alice")
    blocker, owner = at(ADDRESS), at(OTHER_ADDRESS)
    cap = settings.emails_per_address_and_ip_per_day
    for _ in range(cap + 1):
        forgot(blocker)
    assert len(outbox.password_reset) == cap

    assert forgot(owner).status_code == 202

    assert len(outbox.password_reset) == cap + 1
    token = token_from(outbox.password_reset[-1][1])
    reset = owner.post(
        "/auth/reset-password", json={"token": token, "new_password": NEW_PASSWORD}
    )
    assert reset.status_code == 200
    assert log_in(owner, "alice", NEW_PASSWORD).status_code == 200


def test_another_client_keeps_a_full_allowance_for_that_address(
    at, session: Session, outbox, only_the_caps: None
) -> None:
    add_user(session, "alice")
    cap = settings.emails_per_address_and_ip_per_day
    queue(session, ALICE, ADDRESS, times=cap)
    owner = at(OTHER_ADDRESS)

    for _ in range(cap + 1):
        forgot(owner)

    assert len(outbox.password_reset) == cap


def test_a_client_that_has_used_up_one_address_can_still_reach_another(
    at, session: Session, outbox, only_the_caps: None
) -> None:
    add_user(session, "alice")
    add_user(session, "bob")
    queue(session, ALICE, ADDRESS, times=settings.emails_per_address_and_ip_per_day)

    forgot(at(ADDRESS), "bob@example.com")

    assert [to for to, _ in outbox.password_reset] == ["bob@example.com"]


def test_clients_behind_one_ip_share_an_allowance(
    at, session: Session, outbox, only_the_caps: None
) -> None:
    add_user(session, "alice")
    cap = settings.emails_per_address_and_ip_per_day
    queue(session, ALICE, ADDRESS, times=cap)

    forgot(at(ADDRESS))

    assert outbox.password_reset == []


def test_several_clients_can_each_send_their_allowance_up_to_the_total(
    at, session: Session, outbox, only_the_caps: None, monkeypatch: pytest.MonkeyPatch
) -> None:
    add_user(session, "alice")
    cap = settings.emails_per_address_and_ip_per_day
    monkeypatch.setattr(settings, "emails_per_day", cap + 2)

    for address in (ADDRESS, OTHER_ADDRESS):
        for _ in range(cap):
            forgot(at(address))

    assert len(outbox.password_reset) == cap + 2


def test_an_address_in_mixed_case_is_one_address(
    at, session: Session, outbox, only_the_caps: None
) -> None:
    add_user(session, "alice")
    queue(session, ALICE, ADDRESS, times=settings.emails_per_address_and_ip_per_day)

    forgot(at(ADDRESS), "Alice@Example.COM")

    assert outbox.password_reset == []


def test_a_place_comes_back_24_hours_after_it_was_taken(
    at, session: Session, outbox, only_the_caps: None, pass_time
) -> None:
    add_user(session, "alice")
    client = at(ADDRESS)
    cap = settings.emails_per_address_and_ip_per_day
    forgot(client)
    pass_time(hours=1)
    for _ in range(cap):
        forgot(client)
    assert len(outbox.password_reset) == cap

    pass_time(hours=22, minutes=59)
    forgot(client)
    assert len(outbox.password_reset) == cap

    pass_time(minutes=1)
    forgot(client)
    assert len(outbox.password_reset) == cap + 1
    forgot(client)
    assert len(outbox.password_reset) == cap + 1


def test_requests_that_send_nothing_take_no_place_and_log_no_skip(
    at, session: Session, outbox, caplog: pytest.LogCaptureFixture
) -> None:
    caplog.set_level(logging.INFO, logger=LOGGER)
    add_user(session, "alice")
    add_user(session, "inactive", active=False)
    client = at(ADDRESS)

    forgot(client, "nobody@example.com")
    forgot(client, "inactive@example.com")
    resend(client, ALICE)
    register(client, "inactive@example.com")
    assert count(session) == 0

    forgot(client, ALICE)
    forgot(client, ALICE)
    assert count(session) == 1
    assert caps_log(caplog) == []


def test_a_request_inside_the_cooldown_never_reaches_the_caps(
    at, session: Session, caplog: pytest.LogCaptureFixture
) -> None:
    caplog.set_level(logging.INFO, logger=LOGGER)
    add_user(session, "alice")
    client = at(ADDRESS)
    forgot(client)
    fill_the_total(session)

    with recorded_statements() as statements:
        assert forgot(client).status_code == 202

    assert not any("pg_advisory_xact_lock" in statement for statement in statements)
    assert caps_log(caplog) == []


def test_a_notice_past_its_own_limit_takes_no_place(
    at, session: Session, outbox
) -> None:
    add_user(session, "alice")
    client = at(ADDRESS)

    register(client)
    register(client)

    assert outbox.registration_notice == [ALICE]
    assert count(session) == 1


def test_the_total_is_capped_across_many_addresses_and_clients(
    at, session: Session, outbox, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(settings, "emails_per_day", 3)
    names = ("alice", "bob", "carol", "dave")
    for name in names:
        add_user(session, name)

    for number, name in enumerate(names):
        assert forgot(at(f"192.0.2.{number + 1}"), f"{name}@example.com").status_code == 202

    assert [to for to, _ in outbox.password_reset] == [
        "alice@example.com",
        "bob@example.com",
        "carol@example.com",
    ]
    assert count(session) == 3


def test_the_total_reopens_24_hours_after_a_place_was_taken(
    at, session: Session, outbox, monkeypatch: pytest.MonkeyPatch, pass_time
) -> None:
    monkeypatch.setattr(settings, "emails_per_day", 1)
    add_user(session, "alice")
    add_user(session, "bob")
    client = at(ADDRESS)
    forgot(client, ALICE)

    pass_time(hours=23, minutes=59)
    forgot(client, "bob@example.com")
    assert len(outbox.password_reset) == 1

    pass_time(minutes=1)
    forgot(client, "bob@example.com")
    assert [to for to, _ in outbox.password_reset] == [ALICE, "bob@example.com"]


def test_the_caps_are_read_from_the_settings(
    at,
    session: Session,
    outbox,
    only_the_caps: None,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "emails_per_address_and_ip_per_day", 2)
    add_user(session, "alice")
    add_user(session, "bob")
    client = at(ADDRESS)
    for _ in range(3):
        forgot(client, ALICE)
    assert len(outbox.password_reset) == 2

    monkeypatch.setattr(settings, "emails_per_day", 3)
    for _ in range(2):
        forgot(client, "bob@example.com")
    assert len(outbox.password_reset) == 3


@pytest.mark.parametrize(
    "route", ["forgot-password", "resend-verification", "new account", "taken email"]
)
def test_the_answer_is_the_same_when_sent_and_when_skipped_by_either_cap(
    at, session: Session, outbox, route: str
) -> None:
    def target(name: str) -> str:
        if route != "new account":
            add_user(session, name, verified=route != "resend-verification")
        return f"{name}@example.com"

    send = {
        "forgot-password": forgot,
        "resend-verification": resend,
        "new account": register,
        "taken email": register,
    }[route]
    client = at(ADDRESS)

    sent = send(client, target("first"))
    assert emails_sent(outbox) == 1

    capped = target("second")
    queue(
        session, capped, ADDRESS, times=settings.emails_per_address_and_ip_per_day
    )
    skipped_for_the_client = send(client, capped)
    assert emails_sent(outbox) == 1

    fill_the_total(session)
    skipped_in_total = send(client, target("third"))
    assert emails_sent(outbox) == 1

    assert sent.status_code == 202
    assert "retry-after" not in sent.headers
    assert whole_answer(skipped_for_the_client) == whole_answer(sent)
    assert whole_answer(skipped_in_total) == whole_answer(sent)


def test_the_limits_per_ip_still_answer_429_with_the_caps_full(
    at, session: Session
) -> None:
    fill_the_total(session)
    client = at(ADDRESS)

    answers = [
        forgot(client).status_code for _ in range(settings.email_requests_per_ip + 1)
    ]

    assert answers == [202] * settings.email_requests_per_ip + [429]


@pytest.mark.parametrize(
    ("ask", "model", "redeem", "body", "verified"),
    [
        (
            forgot,
            PasswordResetToken,
            "/auth/reset-password",
            {"new_password": NEW_PASSWORD},
            True,
        ),
        (resend, EmailVerificationToken, "/auth/verify-email", {}, False),
    ],
    ids=["reset", "verification"],
)
def test_a_skipped_email_issues_no_token_and_leaves_the_link_in_the_mailbox_working(
    at,
    session: Session,
    outbox,
    issued: list[str],
    ask: Callable,
    model: type,
    redeem: str,
    body: dict,
    verified: bool,
) -> None:
    add_user(session, "alice", verified=verified)
    client = at(ADDRESS)
    ask(client)
    let_cooldown_pass(session)
    fill_the_total(session)

    assert ask(client).status_code == 202

    assert emails_sent(outbox) == 1
    assert len(issued) == 1
    assert session.scalars(select(model.token_hash)).all() == [hash_token(issued[0])]
    answer = client.post(redeem, json={"token": issued[0], **body})
    assert answer.status_code == 200


def test_a_skip_does_not_start_the_cooldown(
    at, session: Session, outbox, monkeypatch: pytest.MonkeyPatch, pass_time
) -> None:
    monkeypatch.setattr(settings, "emails_per_day", 1)
    add_user(session, "alice")
    almost_a_day_ago = datetime.now(timezone.utc) - timedelta(hours=24, minutes=-1)
    queue(session, "someone.else@example.com", SOMEONE, at_time=almost_a_day_ago)
    client = at(ADDRESS)
    forgot(client)
    assert outbox.password_reset == []

    # Well inside the cooldown, had the skip issued a link.
    pass_time(minutes=2)
    forgot(client)

    assert len(outbox.password_reset) == 1


@pytest.mark.parametrize("sender_kind", ["console", "resend"])
def test_the_caps_hold_whatever_the_sender(
    at,
    session: Session,
    caplog: pytest.LogCaptureFixture,
    monkeypatch: pytest.MonkeyPatch,
    sender_kind: str,
) -> None:
    caplog.set_level(logging.WARNING)
    requests: list[httpx.Request] = []

    def accept(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        return httpx.Response(200, json={"id": "4ef9a417"})

    sender = (
        ConsoleEmailSender()
        if sender_kind == "console"
        else ResendEmailSender(
            SecretStr("re_test_key"),
            "Hopsnop <no-reply@hopsnop.example>",
            transport=httpx.MockTransport(accept),
        )
    )
    app.dependency_overrides[get_email_sender] = lambda: sender
    monkeypatch.setattr(settings, "emails_per_day", 1)
    add_user(session, "alice")
    add_user(session, "bob")
    client = at(ADDRESS)

    forgot(client, ALICE)
    forgot(client, "bob@example.com")

    if sender_kind == "console":
        assert caplog.text.count("[development] Password reset link") == 1
        assert "bob@example.com" not in caplog.text
    else:
        assert len(requests) == 1
    assert count(session) == 1


def test_a_new_account_is_created_without_a_link_when_no_email_can_go(
    at, session: Session, outbox, pass_time
) -> None:
    fill_the_total(session)
    client = at(ADDRESS)

    assert client.post("/auth/register", json=registration()).status_code == 202

    user = session.scalars(select(User).where(User.username == "alice")).one()
    assert user.email_verified_at is None
    assert count(session, EmailVerificationToken) == 0
    assert outbox.verification == []
    assert log_in(client).status_code == 403

    pass_time(hours=24)
    assert resend(client).status_code == 202
    [(_, url)] = outbox.verification
    verified = client.post("/auth/verify-email", json={"token": token_from(url)})
    assert verified.status_code == 200
    assert log_in(client).status_code == 200


def test_a_skip_for_the_cap_per_address_and_client_is_one_warning_line(
    at, session: Session, caplog: pytest.LogCaptureFixture
) -> None:
    caplog.set_level(logging.INFO, logger=LOGGER)
    add_user(session, "alice")
    queue(session, ALICE, ADDRESS, times=settings.emails_per_address_and_ip_per_day)

    forgot(at(ADDRESS))

    [record] = caps_log(caplog)
    assert record.levelno == logging.WARNING
    assert record.getMessage() == CLIENT_CAP_LINE


def test_the_total_is_warned_of_once_when_it_fills_and_not_for_each_skip(
    at,
    session: Session,
    caplog: pytest.LogCaptureFixture,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    caplog.set_level(logging.INFO, logger=LOGGER)
    monkeypatch.setattr(settings, "emails_per_day", 2)
    names = ("alice", "bob", "carol", "dave", "erin")
    for name in names:
        add_user(session, name)
    client = at(ADDRESS)

    forgot(client, "alice@example.com")
    assert caps_log(caplog) == []
    forgot(client, "bob@example.com")
    [filled] = caps_log(caplog)
    assert filled.levelno == logging.WARNING
    assert filled.getMessage() == (
        "EMAILS_PER_DAY (2) is reached: no email goes out until places free up."
    )

    for name in names[2:]:
        forgot(client, f"{name}@example.com")

    records = caps_log(caplog)
    assert [r for r in records if r.levelno >= logging.WARNING] == [filled]
    skips = [r for r in records if r.levelno == logging.INFO]
    assert [r.getMessage() for r in skips] == [TOTAL_SKIP_LINE] * 3


def test_no_log_line_holds_an_address_a_client_a_link_or_a_token(
    at,
    session: Session,
    outbox,
    issued: list[str],
    only_the_caps: None,
    caplog: pytest.LogCaptureFixture,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    caplog.set_level(logging.DEBUG)
    monkeypatch.setattr(settings, "emails_per_address_and_ip_per_day", 1)
    monkeypatch.setattr(settings, "emails_per_day", 2)
    add_user(session, "alice")
    add_user(session, "bob")
    add_user(session, "carol")
    client = at(ADDRESS)

    forgot(client, ALICE)
    forgot(client, ALICE)
    forgot(client, "bob@example.com")
    forgot(client, "carol@example.com")

    assert len(caps_log(caplog)) == 3
    url = outbox.password_reset[0][1]
    hashes = session.scalars(select(QueuedEmail.address_hash)).all()
    for secret in (ALICE, "bob@", "carol@", ADDRESS, url, *issued, *hashes):
        assert secret not in caplog.text


def take_a_place_then_fail(db: Session, *, email: str, client: str) -> bool:
    email_caps.take_place(db, email=email, client=client)
    raise RuntimeError("the database went away")


@pytest.mark.parametrize("ask", [forgot, register], ids=["reset", "notice"])
def test_a_place_that_was_taken_goes_back_if_the_request_fails(
    make_client: Callable[..., TestClient],
    session: Session,
    outbox,
    monkeypatch: pytest.MonkeyPatch,
    ask: Callable,
) -> None:
    add_user(session, "alice")
    client = make_client(raise_server_exceptions=False)

    def fail() -> str:
        raise RuntimeError("the database went away")

    monkeypatch.setattr(auth_service, "generate_token", fail)
    monkeypatch.setattr(auth_service, "take_place_for_notice", take_a_place_then_fail)

    assert ask(client).status_code == 500

    assert count(session) == 0
    assert emails_sent(outbox) == 0


def test_a_new_account_that_fails_after_its_place_leaves_neither(
    make_client: Callable[..., TestClient],
    session: Session,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def fail() -> str:
        raise RuntimeError("the database went away")

    monkeypatch.setattr(auth_service, "generate_token", fail)
    client = make_client(raise_server_exceptions=False)

    assert client.post("/auth/register", json=registration()).status_code == 500

    assert count(session) == 0
    assert count(session, User) == 0


@pytest.mark.parametrize(
    ("ask", "table"),
    [(forgot, "password_reset_tokens"), (resend, "email_verification_tokens")],
    ids=["reset", "verification"],
)
def test_a_link_takes_the_accounts_row_then_the_email_lock_then_writes_the_token(
    at, session: Session, ask: Callable, table: str
) -> None:
    add_user(session, "alice", verified=ask is forgot)
    client = at(ADDRESS)

    with recorded_statements() as statements:
        ask(client)

    order = [
        first(statements, "FOR NO KEY UPDATE"),
        first(statements, "pg_advisory_xact_lock"),
        first(statements, "FROM queued_emails"),
        first(statements, "INSERT INTO queued_emails"),
        first(statements, f"DELETE FROM {table}"),
        first(statements, f"INSERT INTO {table}"),
    ]
    assert order == sorted(order)


def test_a_new_account_is_inserted_before_the_email_lock_and_its_token_after(
    at,
) -> None:
    with recorded_statements() as statements:
        at(ADDRESS).post("/auth/register", json=registration())

    order = [
        first(statements, "INSERT INTO users"),
        first(statements, "pg_advisory_xact_lock"),
        first(statements, "FROM queued_emails"),
        first(statements, "INSERT INTO queued_emails"),
        first(statements, "INSERT INTO email_verification_tokens"),
    ]
    assert order == sorted(order)


def test_deleting_an_account_blanks_both_hashes_and_its_rows_still_count(
    alice_client: TestClient, session: Session, alice_account: User
) -> None:
    queue(session, ALICE, ADDRESS, times=2)
    queue(session, "bob@example.com", ADDRESS)

    assert remove(alice_client).status_code == 204

    rows = [
        tuple(row)
        for row in session.execute(
            select(QueuedEmail.address_hash, QueuedEmail.client_hash)
        )
    ]
    assert rows.count((None, None)) == 2
    assert rows.count(
        (
            key_hash("queued-email:address", "bob@example.com"),
            key_hash("queued-email:client", ADDRESS),
        )
    ) == 1
    assert len(rows) == 3


def test_registering_and_deleting_again_and_again_cannot_get_past_the_total(
    make_client: Callable[..., TestClient],
    session: Session,
    outbox,
    only_the_caps: None,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "emails_per_day", 2)
    client = make_client()

    for _ in range(2):
        assert client.post("/auth/register", json=registration()).status_code == 202
        token = token_from(outbox.verification[-1][1])
        assert client.post("/auth/verify-email", json={"token": token}).status_code == 200
        assert log_in(client).status_code == 200
        assert remove(client).status_code == 204

    client.post("/auth/register", json=registration())

    assert len(outbox.verification) == 2
    assert count(session) == 2


def test_the_next_owner_of_an_address_gets_a_full_allowance(
    alice_client: TestClient,
    make_client: Callable[..., TestClient],
    session: Session,
    outbox,
) -> None:
    queue(
        session, ALICE, "testclient", times=settings.emails_per_address_and_ip_per_day
    )
    newcomer = make_client()
    forgot(newcomer)
    assert outbox.password_reset == []

    assert remove(alice_client).status_code == 204
    newcomer.post("/auth/register", json=registration())

    assert [to for to, _ in outbox.verification] == [ALICE]


def test_a_deletion_that_fails_keeps_the_hashes(
    alice_client: TestClient,
    session: Session,
    alice_account: User,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    queue(session, ALICE, ADDRESS)
    alice_id = alice_account.id
    forget = email_caps.forget_address

    def forget_then_fail(db: Session, email: str) -> None:
        forget(db, email)
        raise RuntimeError("the database went away")

    monkeypatch.setattr(email_caps, "forget_address", forget_then_fail)
    with pytest.raises(RuntimeError):
        remove(alice_client)

    assert session.scalars(select(QueuedEmail.address_hash)).all() == [
        key_hash("queued-email:address", ALICE)
    ]
    assert session.get(User, alice_id) is not None


def test_the_table_holds_an_id_two_hashes_and_a_time_and_nothing_else() -> None:
    columns = {column.key for column in QueuedEmail.__table__.columns}

    assert columns == {"id", "address_hash", "client_hash", "queued_at"}


def test_neither_the_address_nor_the_client_is_stored_as_it_is(
    at, session: Session, outbox
) -> None:
    add_user(session, "alice")

    forgot(at(ADDRESS))

    row = session.scalars(select(QueuedEmail)).one()
    assert row.address_hash == key_hash("queued-email:address", ALICE)
    assert row.client_hash == key_hash("queued-email:client", ADDRESS)
    assert row.address_hash != key_hash("queued-email:client", ALICE)
    for value in (row.address_hash, row.client_hash):
        assert re.fullmatch(r"[0-9a-f]{64}", value)
        for raw in (ALICE, "alice", "example.com", ADDRESS):
            assert raw not in value


# Below: real transactions, as requests take turns. Cleaned up by ``remove_accounts``.


def email_lock_is_free() -> bool:
    with SessionLocal() as db:
        free = db.scalar(
            select(func.pg_try_advisory_xact_lock(email_caps.EMAIL_LOCK_KEY))
        )
        db.rollback()
        return free


@pytest.mark.parametrize(
    "caps",
    [{}, {"emails_per_address_and_ip_per_day": 0}, {"emails_per_day": 0}],
    ids=["sent", "skipped for the client", "skipped in total"],
)
def test_the_email_lock_is_given_back_before_the_answer_goes_out(
    account, monkeypatch: pytest.MonkeyPatch, caps: dict
) -> None:
    for name, value in caps.items():
        monkeypatch.setattr(settings, name, value)
    verified, unverified = account(), account(verified=False)
    new_name = f"{verified.name}_new"

    try:
        for ask in (
            lambda db: auth_service.request_password_reset(
                db, verified.email, client=SOMEONE
            ),
            lambda db: auth_service.request_email_verification(
                db, unverified.email, client=SOMEONE
            ),
            lambda db: auth_service.take_place_for_notice(
                db, email=verified.email, client=SOMEONE
            ),
            lambda db: auth_service.register_user(
                db,
                username=new_name,
                email=f"{new_name}@example.com",
                password=PASSWORD,
                display_name="New",
                client=SOMEONE,
            ),
        ):
            with SessionLocal() as db:
                ask(db)
                assert email_lock_is_free()
    finally:
        with SessionLocal() as db:
            db.execute(delete(User).where(User.username == new_name))
            db.commit()


def test_simultaneous_resets_for_the_last_place_send_exactly_one(
    account, outbox, issued: list[str], monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(settings, "emails_per_day", 1)
    accounts = [account() for _ in range(8)]

    def ask(number: int) -> int:
        with accounts[number].client(number) as client:
            return forgot(client, accounts[number].email).status_code

    assert set(at_once(len(accounts), ask)) == {202}

    assert len(outbox.password_reset) == 1
    assert len(issued) == 1
    with SessionLocal() as db:
        assert count(db) == 1


def test_simultaneous_requests_for_a_clients_last_place_send_exactly_one(
    account, outbox, issued: list[str], monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(settings, "emails_per_address_and_ip_per_day", 1)
    monkeypatch.setattr(settings, "email_token_cooldown_seconds", 0)
    monkeypatch.setattr(settings, "email_requests_per_ip", 1000)
    owner = account()

    def ask(_: int) -> int:
        with owner.client(0) as client:
            return forgot(client, owner.email).status_code

    assert set(at_once(8, ask)) == {202}

    assert len(outbox.password_reset) == 1
    assert len(issued) == 1


def test_simultaneous_notices_for_the_last_place_send_exactly_one(
    account, outbox, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(settings, "emails_per_day", 1)
    monkeypatch.setattr(settings, "registration_notices_per_account", 1000)
    owner = account()

    def ask(number: int) -> int:
        with owner.client(number) as client:
            return client.post(
                "/auth/register",
                json=registration(
                    username=f"{owner.name}_{number}", email=owner.email
                ),
            ).status_code

    assert set(at_once(8, ask)) == {202}

    assert outbox.registration_notice == [owner.email]


def test_simultaneous_registrations_at_the_last_place_create_all_and_send_one_link(
    account, outbox, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(settings, "emails_per_day", 1)
    clients = account()
    names = [f"{clients.name}_{number}" for number in range(6)]

    def ask(number: int) -> int:
        with clients.client(number) as client:
            return client.post(
                "/auth/register",
                json=registration(
                    username=names[number], email=f"{names[number]}@example.com"
                ),
            ).status_code

    try:
        assert set(at_once(len(names), ask)) == {202}

        with SessionLocal() as db:
            created = select(func.count()).where(User.username.in_(names))
            assert db.scalar(created) == len(names)
            links = select(func.count()).select_from(EmailVerificationToken)
            assert db.scalar(links) == 1
        assert len(outbox.verification) == 1
    finally:
        with SessionLocal() as db:
            db.execute(delete(User).where(User.username.in_(names)))
            db.commit()


def test_the_same_new_address_twice_at_once_makes_one_account_without_a_deadlock(
    account, outbox
) -> None:
    clients = account()
    email = f"{clients.name}_new@example.com"
    names = [f"{clients.name}_a", f"{clients.name}_b"]

    def ask(number: int) -> int:
        with clients.client(number) as client:
            return client.post(
                "/auth/register",
                json=registration(username=names[number], email=email),
            ).status_code

    try:
        assert set(at_once(2, ask)) == {202}

        with SessionLocal() as db:
            assert db.scalar(select(func.count()).where(User.email == email)) == 1
        assert [to for to, _ in outbox.verification] == [email]
    finally:
        with SessionLocal() as db:
            for user_id in db.scalars(select(User.id).where(User.email == email)).all():
                db.execute(
                    delete(RateLimit).where(
                        RateLimit.key_hash
                        == key_hash("registration-notice:account", str(user_id))
                    )
                )
            db.execute(delete(User).where(User.email == email))
            db.commit()
