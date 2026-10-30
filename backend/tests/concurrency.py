import threading
import time
import uuid
from collections.abc import Callable, Iterable
from concurrent.futures import Future, ThreadPoolExecutor
from datetime import datetime, timezone
from types import ModuleType
from typing import TypeVar

import pytest
from fastapi.testclient import TestClient
from httpx import Response
from sqlalchemy import delete, exists, select, text
from sqlalchemy.orm import Session, aliased

from app.db.session import SessionLocal
from app.main import app
from app.models import Post, RateLimit, Story, User, UserSession
from app.services.rate_limit import key_hash
from helpers import PASSWORD_HASH, log_in

# Long enough for anything here; every wait ends as soon as its condition holds.
TIMEOUT = 15

LOGIN_SCOPES = ("login:identifier+address", "login:address", "login:identifier")
ADDRESS_SCOPES = (
    "login:address",
    "register",
    "forgot-password",
    "resend-verification",
    "verify-email",
    "reset-password",
)
ACCOUNT_SCOPES = (
    "password-confirmation:account",
    "data-export:account",
    "image-upload:account",
)

_Result = TypeVar("_Result")


class Account:
    """A committed account; its requests use addresses no other test uses."""

    def __init__(self, *, verified: bool = True) -> None:
        self.name = f"race_{uuid.uuid4().hex[:12]}"
        self.email = f"{self.name}@example.com"
        self.run = uuid.uuid4().hex
        self.addresses: set[str] = set()
        with SessionLocal() as db:
            user = User(
                username=self.name,
                email=self.email,
                password_hash=PASSWORD_HASH,
                display_name="Race",
                email_verified_at=datetime.now(timezone.utc) if verified else None,
            )
            db.add(user)
            db.commit()
            self.id = user.id

    def address(self, number: int = 0) -> str:
        address = f"race-{self.run}-{number}"
        self.addresses.add(address)
        return address

    def client(self, number: int = 0) -> TestClient:
        """Every request gets its own database session, as in real use."""
        return TestClient(
            app, base_url="https://testserver", client=(self.address(number), 50000)
        )

    def sessions(self, db: Session) -> list[UserSession]:
        return list(
            db.scalars(select(UserSession).where(UserSession.user_id == self.id))
        )

    def unused_tokens(self, model: type) -> list[str]:
        with SessionLocal() as db:
            return list(
                db.scalars(
                    select(model.token_hash).where(
                        model.user_id == self.id, model.used_at.is_(None)
                    )
                )
            )

    def login_counters(self, number: int = 0) -> list[int | None]:
        address = self.address(number)
        subjects = (f"{self.name}\x00{address}", address, self.name)
        with SessionLocal() as db:
            return [
                db.scalar(
                    select(RateLimit.count).where(
                        RateLimit.key_hash == key_hash(scope, subject)
                    )
                )
                for scope, subject in zip(LOGIN_SCOPES, subjects)
            ]

    def keys(self) -> list[str]:
        keys = [key_hash(scope, str(self.id)) for scope in ACCOUNT_SCOPES]
        for identifier in (self.name, self.email):
            keys.append(key_hash("login:identifier", identifier))
            keys += [
                key_hash("login:identifier+address", f"{identifier}\x00{address}")
                for address in self.addresses
            ]
        for address in self.addresses:
            keys += [key_hash(scope, address) for scope in ADDRESS_SCOPES]
        return keys

    def remove(self) -> None:
        remove_accounts([self])


def remove_accounts(accounts: Iterable[Account]) -> None:
    """Posts first, replies before parents: the database keeps answered posts."""
    accounts = list(accounts)
    if not accounts:
        return
    ids = [account.id for account in accounts]
    keys = [key for account in accounts for key in account.keys()]
    reply = aliased(Post)
    with SessionLocal() as db:
        db.execute(delete(RateLimit).where(RateLimit.key_hash.in_(keys)))
        db.execute(delete(Story).where(Story.author_id.in_(ids)))
        while db.execute(
            delete(Post).where(
                Post.author_id.in_(ids) | Post.deleted_at.is_not(None),
                ~exists().where(reply.parent_post_id == Post.id),
            )
        ).rowcount:
            pass
        db.execute(delete(User).where(User.id.in_(ids)))
        db.commit()


class Gate:
    """Once closed, the next call does its work and then waits here until opened."""

    def __init__(self) -> None:
        self._closed = False
        self._lock = threading.Lock()
        self.reached = threading.Event()
        self._opened = threading.Event()

    def wrap(self, function: Callable) -> Callable:
        def wrapped(*args: object, **kwargs: object) -> object:
            result = function(*args, **kwargs)
            with self._lock:
                stop_here, self._closed = self._closed, False
            if stop_here:
                self.reached.set()
                assert self._opened.wait(TIMEOUT), "the gate was never opened"
            return result

        return wrapped

    def close(self) -> None:
        self._closed = True

    def open(self) -> None:
        self._opened.set()


def signed_in(account: Account, number: int = 0) -> TestClient:
    client = account.client(number)
    assert log_in(client, account.name).status_code == 200
    return client


def stopped_after(
    monkeypatch: pytest.MonkeyPatch, module: ModuleType, function: str
) -> Gate:
    gate = Gate()
    monkeypatch.setattr(module, function, gate.wrap(getattr(module, function)))
    return gate


def requests_waiting_for_a_lock() -> int:
    with SessionLocal() as db:
        return db.scalar(
            text(
                "SELECT count(*) FROM pg_stat_activity "
                "WHERE datname = current_database() AND wait_event_type = 'Lock'"
            )
        )


def let_run(other: Future) -> None:
    deadline = time.monotonic() + TIMEOUT
    while not other.done() and requests_waiting_for_a_lock() == 0:
        assert time.monotonic() < deadline, "neither finished nor waiting"
        time.sleep(0.01)


def until_waiting(count: int) -> None:
    deadline = time.monotonic() + TIMEOUT
    while requests_waiting_for_a_lock() < count:
        assert time.monotonic() < deadline, f"fewer than {count} requests waiting"
        time.sleep(0.01)


def one_after_the_other(
    first: Callable[[], Response], second: Callable[[], Response], gate: Gate
) -> tuple[Response, Response, bool]:
    """``first`` holds at the gate while ``second`` runs as far as it can."""
    with ThreadPoolExecutor(2) as pool:
        gate.close()
        earlier = pool.submit(first)
        assert gate.reached.wait(TIMEOUT), "the first request never got that far"
        later = pool.submit(second)
        let_run(later)
        waited = not later.done()
        gate.open()
        return earlier.result(TIMEOUT), later.result(TIMEOUT), waited


def at_once(count: int, request: Callable[[int], _Result]) -> list[_Result]:
    together = threading.Barrier(count)

    def run(number: int) -> _Result:
        together.wait()
        return request(number)

    with ThreadPoolExecutor(count) as pool:
        return list(pool.map(run, range(count)))
