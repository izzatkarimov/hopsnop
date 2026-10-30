import os
from collections.abc import Callable, Iterator
from datetime import datetime, timedelta, timezone

# Settings load at import, and production refuses without its own; switched back below.
os.environ.setdefault("ENVIRONMENT", "development")

import httpx
import pytest
from fastapi.testclient import TestClient
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.api.deps import get_db
from app.core.config import settings
from app.db.session import engine
from app.main import app
from app.models import Post, Story, User
from app.services import auth as auth_service
from app.services import posts as posts_service
from app.services import stories as stories_service
from app.services.email import get_email_sender
from concurrency import Account, remove_accounts
from database_guard import leak_report, name_refusal, refusal, tables_with_rows
from helpers import add_user, log_in, store_picture

_FOUND_EMPTY = pytest.StashKey[bool]()


def pytest_sessionstart(session: pytest.Session) -> None:
    if session.config.option.collectonly:
        return
    refused = name_refusal(engine.url)
    if refused:
        pytest.exit(refused, returncode=2)
    try:
        with engine.connect() as connection:
            found = tables_with_rows(connection)
    except SQLAlchemyError as error:
        # Error kind only: its text can hold the connection password.
        pytest.exit(
            "\nThe tests were not run: the database could not be checked "
            f"({type(error).__name__}). Is it running, and is its schema "
            "created (alembic upgrade head)?\n",
            returncode=2,
        )
    if found:
        pytest.exit(refusal(found, engine.url), returncode=2)
    session.config.stash[_FOUND_EMPTY] = True


def pytest_sessionfinish(session: pytest.Session) -> None:
    if not session.config.stash.get(_FOUND_EMPTY, False):
        return
    with engine.connect() as connection:
        found = tables_with_rows(connection)
    if not found:
        return
    reporter = session.config.pluginmanager.get_plugin("terminalreporter")
    if reporter is not None:
        reporter.write_sep("=", "the database was not left empty", red=True)
        reporter.write_line(leak_report(found), red=True)
    session.exitstatus = pytest.ExitCode.TESTS_FAILED


@pytest.fixture
def session() -> Iterator[Session]:
    with engine.connect() as connection:
        transaction = connection.begin()
        # Savepoints in the outer transaction contain an IntegrityError's rollback.
        with Session(
            bind=connection,
            join_transaction_mode="create_savepoint",
        ) as session:
            yield session
        transaction.rollback()


def make_user(session: Session, username: str) -> User:
    user = User(
        username=username,
        email=f"{username}@example.com",
        password_hash="not-a-real-hash",
        display_name=username.title(),
    )
    session.add(user)
    session.flush()
    return user


@pytest.fixture
def alice(session: Session) -> User:
    return make_user(session, "alice")


@pytest.fixture
def bob(session: Session) -> User:
    return make_user(session, "bob")


@pytest.fixture
def post(session: Session, alice: User) -> Post:
    post = Post(author=alice, content="Hello, Hopsnop!")
    session.add(post)
    session.flush()
    return post


@pytest.fixture
def story(session: Session, alice: User) -> Story:
    story = Story(
        author=alice,
        media_id=store_picture(),
        media_width=32,
        media_height=24,
        media_type="image",
        expires_at=datetime.now(timezone.utc) + timedelta(hours=24),
    )
    session.add(story)
    session.flush()
    return story


@pytest.fixture(autouse=True)
def _image_store(
    monkeypatch: pytest.MonkeyPatch, tmp_path_factory: pytest.TempPathFactory
) -> None:
    monkeypatch.setattr(
        settings, "image_storage_path", str(tmp_path_factory.mktemp("images"))
    )


@pytest.fixture(autouse=True)
def _production_settings(monkeypatch: pytest.MonkeyPatch) -> None:
    # Production behaviour whatever .env says; development tests switch it themselves.
    monkeypatch.setattr(settings, "environment", "production")
    # Nor does a Resend key in .env ever reach a test.
    monkeypatch.setattr(settings, "resend_api_key", None)
    monkeypatch.setattr(settings, "email_from", None)


class Outbox:
    def __init__(self) -> None:
        self.verification: list[tuple[str, str]] = []
        self.password_reset: list[tuple[str, str]] = []

    def send_email_verification(self, *, to: str, url: str) -> None:
        self.verification.append((to, url))

    def send_password_reset(self, *, to: str, url: str) -> None:
        self.password_reset.append((to, url))


@pytest.fixture
def outbox() -> Outbox:
    return Outbox()


@pytest.fixture(autouse=True)
def _email_outbox(outbox: Outbox) -> Iterator[None]:
    app.dependency_overrides[get_email_sender] = lambda: outbox
    yield
    app.dependency_overrides.pop(get_email_sender, None)


@pytest.fixture(autouse=True)
def _no_network(monkeypatch: pytest.MonkeyPatch) -> None:
    # httpx's network transport refuses; the test client and MockTransport don't use it.
    def refuse(self: httpx.HTTPTransport, request: httpx.Request) -> httpx.Response:
        raise AssertionError(f"A test tried to reach {request.url.host}.")

    monkeypatch.setattr(httpx.HTTPTransport, "handle_request", refuse)


@pytest.fixture
def make_client(session: Session) -> Iterator[Callable[..., TestClient]]:
    def use_test_session() -> Iterator[Session]:
        # A commit only releases a savepoint here; real requests see committed data.
        session.commit()
        try:
            yield session
        finally:
            session.rollback()

    app.dependency_overrides[get_db] = use_test_session
    clients: list[TestClient] = []

    def make(**kwargs: object) -> TestClient:
        # HTTPS, because the production session cookie is Secure.
        client = TestClient(app, base_url="https://testserver", **kwargs)
        clients.append(client)
        return client

    yield make

    for client in clients:
        client.close()
    app.dependency_overrides.clear()


@pytest.fixture
def client(make_client: Callable[..., TestClient]) -> TestClient:
    return make_client()


@pytest.fixture
def alice_account(session: Session) -> User:
    return add_user(session, "alice")


@pytest.fixture
def bob_account(session: Session) -> User:
    return add_user(session, "bob")


@pytest.fixture
def alice_client(client: TestClient, alice_account: User) -> TestClient:
    assert log_in(client, "alice").status_code == 200
    return client


@pytest.fixture
def bob_client(make_client: Callable[..., TestClient], bob_account: User) -> TestClient:
    client = make_client()
    assert log_in(client, "bob").status_code == 200
    return client


class Clock:
    def __init__(self) -> None:
        self.now = datetime.now(timezone.utc)

    def __call__(self) -> datetime:
        return self.now

    def advance(self, **duration: float) -> None:
        self.now += timedelta(**duration)


@pytest.fixture
def clock(monkeypatch: pytest.MonkeyPatch) -> Clock:
    clock = Clock()
    monkeypatch.setattr(posts_service, "_now", clock)
    monkeypatch.setattr(stories_service, "_now", clock)
    return clock


@pytest.fixture
def account() -> Iterator[Callable[..., Account]]:
    made: list[Account] = []

    def make(**kwargs: bool) -> Account:
        made.append(Account(**kwargs))
        return made[-1]

    yield make
    remove_accounts(made)


@pytest.fixture
def issued(monkeypatch: pytest.MonkeyPatch) -> list[str]:
    tokens: list[str] = []
    generate = auth_service.generate_token

    def recording_generate() -> str:
        tokens.append(generate())
        return tokens[-1]

    monkeypatch.setattr(auth_service, "generate_token", recording_generate)
    return tokens
