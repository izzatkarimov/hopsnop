import subprocess
import sys
import types
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import delete, func, select, text
from sqlalchemy.engine import make_url
from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import Session

import conftest
from app.api.auth import password_confirmation_limits
from app.core.config import Settings, settings
from app.db import session as database
from app.db.base import Base
from app.db.session import SessionLocal, create_application_engine
from app.models import Like, RateLimit, User, UserSession
from app.services import auth as auth_service
from app.services import erasure
from app.services import posts as posts_service
from app.services import stories as stories_service
from app.services import users as users_service
from app.services.rate_limit import key_hash
from concurrency import TIMEOUT, let_run
from database_guard import TEST_DATABASE, leak_report, refusal, tables_with_rows
from helpers import PASSWORD, add_post, add_user, log_in, recorded_selects

REPOSITORY = Path(__file__).resolve().parent.parent
NEW_PASSWORD = "an entirely different passphrase"


def test_empty_database_has_no_table_with_rows(session: Session) -> None:
    assert tables_with_rows(session.connection()) == {}


def test_every_table_that_holds_a_row_is_named_with_its_count(
    session: Session,
) -> None:
    alice, bob = add_user(session, "alice"), add_user(session, "bob")
    post = add_post(session, alice)
    add_post(session, bob, parent=post)
    session.add(Like(user_id=bob.id, post_id=post.id))
    session.flush()

    assert tables_with_rows(session.connection()) == {
        "likes": 1,
        "posts": 2,
        "users": 2,
    }


def test_every_table_of_the_application_is_looked_at(session: Session) -> None:
    connection = session.connection()

    with recorded_selects() as statements:
        tables_with_rows(connection)

    looked_at = {statement.split("FROM ")[1].strip() for statement in statements}
    assert looked_at == set(Base.metadata.tables)
    assert {"users", "posts", "stories", "sessions", "rate_limits"} <= looked_at
    assert len(statements) == len(Base.metadata.tables)


def test_refusal_names_the_database_and_what_is_in_it_but_no_password() -> None:
    url = make_url("postgresql+psycopg://hopsnop:s3cr3t-pw@db.example:5433/hopsnop")

    message = refusal({"users": 3, "posts": 12}, url)

    assert "'hopsnop' on db.example:5433" in message
    assert "users (3), posts (12)" in message
    assert "s3cr3t-pw" not in message
    assert "hopsnop:" not in message


def test_refusal_says_that_nothing_was_changed_and_what_to_do() -> None:
    url = make_url("postgresql+psycopg://u:p@localhost:5433/hopsnop")

    message = refusal({"users": 1}, url)

    assert "The tests were not run" in message
    assert "Nothing was changed" in message
    assert TEST_DATABASE in message
    for word in ("TRUNCATE", "DELETE", "DROP", "truncate", "drop "):
        assert word not in message


def test_report_of_rows_left_behind_names_them() -> None:
    message = leak_report({"rate_limits": 2, "users": 1})

    assert "rate_limits (2), users (1)" in message
    assert "next run will be refused" in message


def leave_a_row() -> str:
    key = uuid.uuid4().hex + uuid.uuid4().hex
    with SessionLocal() as db:
        now = datetime.now(timezone.utc)
        db.add(RateLimit(key_hash=key, window_start=now, count=1))
        db.commit()
    return key


def remove_the_row(key: str) -> None:
    with SessionLocal() as db:
        db.execute(delete(RateLimit).where(RateLimit.key_hash == key))
        db.commit()


def test_run_against_a_database_that_is_not_empty_is_refused() -> None:
    key = leave_a_row()
    try:
        run = subprocess.run(
            [sys.executable, "-m", "pytest", "tests/test_security.py", "-q"]
            + ["-p", "no:cacheprovider"],
            cwd=REPOSITORY,
            capture_output=True,
            text=True,
            timeout=120,
        )
        with SessionLocal() as db:
            still_there = db.scalar(
                select(func.count()).where(RateLimit.key_hash == key)
            )
    finally:
        remove_the_row(key)

    output = run.stdout + run.stderr
    assert run.returncode == 2
    assert "The tests were not run" in output
    assert "rate_limits (1)" in output
    assert " passed" not in output and " failed" not in output
    assert still_there == 1
    assert settings.database_url not in output


def finished_session(*, found_empty: bool) -> types.SimpleNamespace:
    stash = pytest.Stash()
    if found_empty:
        stash[conftest._FOUND_EMPTY] = True
    config = types.SimpleNamespace(
        stash=stash,
        pluginmanager=types.SimpleNamespace(get_plugin=lambda name: None),
    )
    return types.SimpleNamespace(config=config, exitstatus=pytest.ExitCode.OK)


def test_run_that_leaves_rows_behind_is_failed() -> None:
    finished = finished_session(found_empty=True)
    key = leave_a_row()
    try:
        conftest.pytest_sessionfinish(finished)
    finally:
        remove_the_row(key)

    assert finished.exitstatus == pytest.ExitCode.TESTS_FAILED


def test_run_that_leaves_nothing_behind_keeps_its_result() -> None:
    finished = finished_session(found_empty=True)

    conftest.pytest_sessionfinish(finished)

    assert finished.exitstatus == pytest.ExitCode.OK


def test_run_that_was_refused_is_not_blamed_for_what_was_there() -> None:
    finished = finished_session(found_empty=False)
    key = leave_a_row()
    try:
        conftest.pytest_sessionfinish(finished)
    finally:
        remove_the_row(key)

    assert finished.exitstatus == pytest.ExitCode.OK


def test_application_names_the_isolation_level_it_depends_on() -> None:
    assert database.ISOLATION_LEVEL == "READ COMMITTED"


def test_every_transaction_of_the_application_runs_at_that_level() -> None:
    with SessionLocal() as db:
        assert db.scalar(text("SHOW transaction_isolation")) == "read committed"
        assert db.connection().get_isolation_level() == "READ COMMITTED"


def test_level_is_set_by_the_application_and_not_left_to_the_server() -> None:
    # A server whose own default is stricter, as an administrator may set it.
    stricter = {"options": "-c default_transaction_isolation=serializable"}
    engine = create_application_engine(settings.database_url, connect_args=stricter)
    try:
        with engine.connect() as connection:
            default = connection.scalar(text("SHOW default_transaction_isolation"))
            actual = connection.scalar(text("SHOW transaction_isolation"))
    finally:
        engine.dispose()

    assert default == "serializable"
    assert actual == "read committed"


def test_application_names_the_time_zone_it_depends_on() -> None:
    assert database.TIME_ZONE == "UTC"


def test_every_connection_of_the_application_is_in_that_time_zone() -> None:
    with SessionLocal() as db:
        assert db.scalar(text("SHOW TimeZone")) == "UTC"
        moment = db.scalar(text("SELECT now()"))
    assert moment.utcoffset() == timedelta(0)


def test_time_zone_is_set_by_the_application_and_not_left_to_the_server() -> None:
    # A server in a local time zone that changes to winter time.
    local = {"options": "-c TimeZone=Europe/Warsaw"}
    engine = create_application_engine(settings.database_url, connect_args=local)
    try:
        with engine.connect() as connection:
            zone = connection.scalar(text("SHOW TimeZone"))
            # 30 days apart, across the change to winter time on 25 October 2026.
            start, end = connection.execute(
                text(
                    "SELECT timestamptz '2026-10-19 12:00:00+00',"
                    " timestamptz '2026-11-18 12:00:00+00'"
                )
            ).one()
            connection.rollback()
            after_rollback = connection.scalar(text("SHOW TimeZone"))
    finally:
        engine.dispose()

    assert zone == "UTC"
    assert after_rollback == "UTC"
    assert end - start == timedelta(days=30)


def test_request_that_waited_for_a_lock_sees_what_its_holder_committed(
    account,
) -> None:
    owner = account()

    def read_when_free() -> str:
        with SessionLocal() as db:
            assert db.scalar(select(func.count()).select_from(User)) >= 1
            locked = auth_service._lock_account(db, owner.id)
            return locked.display_name

    with SessionLocal() as holder, ThreadPoolExecutor(1) as pool:
        auth_service._lock_account(holder, owner.id).display_name = "Changed"
        holder.flush()
        waiting = pool.submit(read_when_free)
        let_run(waiting)
        assert not waiting.done()
        holder.commit()
        seen = waiting.result(TIMEOUT)

    assert seen == "Changed"


def test_there_is_one_rule_for_which_accounts_are_shown() -> None:
    rule = users_service.ACCOUNT_IS_SHOWN

    assert posts_service.ACCOUNT_IS_SHOWN is rule
    assert stories_service.ACCOUNT_IS_SHOWN is rule
    assert not hasattr(posts_service, "_ACCOUNT_IS_SHOWN")
    assert [str(condition) for condition in rule] == [
        "users.is_active IS true",
        "users.email_verified_at IS NOT NULL",
    ]


@pytest.mark.parametrize("hidden", ["inactive", "unverified"])
def test_posts_and_profiles_agree_on_an_account_that_is_not_shown(
    client: TestClient, session: Session, hidden: str
) -> None:
    author = add_user(
        session, "hidden", active=hidden != "inactive", verified=hidden != "unverified"
    )
    post = add_post(session, author)

    assert client.get("/users/hidden").status_code == 404
    assert client.get("/users/hidden/posts").status_code == 404
    assert client.get(f"/posts/{post.id}").status_code == 404
    assert client.get(f"/posts/{post.id}/replies").status_code == 404
    assert client.get("/feed").json()["items"] == []


def erasure_lock_is_free() -> bool:
    with SessionLocal() as db:
        return db.scalar(
            select(func.pg_try_advisory_xact_lock(erasure.ERASURE_LOCK_KEY))
        )


def test_erasure_lock_is_held_until_the_transaction_commits() -> None:
    with SessionLocal() as db:
        assert erasure_lock_is_free()

        erasure.lock_erasure(db)
        assert not erasure_lock_is_free()

        db.commit()
        assert erasure_lock_is_free()


def test_erasure_lock_is_released_by_a_rollback_as_well() -> None:
    with SessionLocal() as db:
        erasure.lock_erasure(db)
        assert not erasure_lock_is_free()

        db.rollback()

    assert erasure_lock_is_free()


def test_erasure_lock_is_released_when_its_session_is_simply_closed() -> None:
    with SessionLocal() as db:
        erasure.lock_erasure(db)

    assert erasure_lock_is_free()


def test_erasure_lock_can_be_asked_for_again_by_its_holder() -> None:
    with SessionLocal() as db:
        erasure.lock_erasure(db)
        erasure.lock_erasure(db)
        assert not erasure_lock_is_free()

        db.commit()

    assert erasure_lock_is_free()


def test_second_erasure_waits_for_the_first() -> None:
    order: list[str] = []

    def second() -> None:
        with SessionLocal() as db:
            erasure.lock_erasure(db)
            order.append("second has it")
            db.commit()

    with SessionLocal() as first, ThreadPoolExecutor(1) as pool:
        erasure.lock_erasure(first)
        waiting = pool.submit(second)
        let_run(waiting)
        assert not waiting.done()
        order.append("first lets go")
        first.commit()
        waiting.result(TIMEOUT)

    assert order == ["first lets go", "second has it"]


def test_nothing_but_another_erasure_waits_for_the_lock(account) -> None:
    owner, other = account(), account()
    reader, writer = owner.client(), other.client()

    def use_the_application() -> list[int]:
        answers = [log_in(writer, other.name).status_code]
        created = writer.post("/posts", json={"content": "While it is held"})
        answers.append(created.status_code)
        post_id = created.json()["id"]
        answers += [
            writer.post(f"/posts/{post_id}/like").status_code,
            writer.post(f"/users/{owner.name}/follow").status_code,
            writer.patch(f"/posts/{post_id}", json={"content": "Edited"}).status_code,
            reader.get("/feed").status_code,
            reader.get(f"/posts/{post_id}").status_code,
            reader.get(f"/users/{other.name}").status_code,
        ]
        return answers

    with SessionLocal() as holder, ThreadPoolExecutor(1) as pool:
        erasure.lock_erasure(holder)
        answers = pool.submit(use_the_application).result(TIMEOUT)
        assert not erasure_lock_is_free()

    assert answers == [200, 201, 200, 200, 200, 200, 200, 200]


def test_erasure_lock_is_one_fixed_lock_of_this_database() -> None:
    assert isinstance(erasure.ERASURE_LOCK_KEY, int)
    assert 0 < erasure.ERASURE_LOCK_KEY < 2**63


def test_account_is_locked_for_no_key_update_and_exclusively_for_update(
    session: Session, alice_account: User
) -> None:
    with recorded_selects() as statements:
        auth_service._lock_account(session, alice_account.id)
        auth_service._lock_account(session, alice_account.id, exclusive=True)

    ordinary, exclusive = (" ".join(statement.split()) for statement in statements)
    assert ordinary.endswith("FOR NO KEY UPDATE")
    assert exclusive.endswith("FOR UPDATE")
    assert "NO KEY" not in exclusive


def can_be_referred_to(user_id: uuid.UUID) -> bool:
    """Asked without waiting, by taking the lock a foreign key takes on the row."""
    with SessionLocal() as db:
        try:
            db.execute(
                text("SELECT 1 FROM users WHERE id = :id FOR KEY SHARE NOWAIT"),
                {"id": user_id},
            )
        except OperationalError:
            return False
        return True


def can_be_locked(user_id: uuid.UUID) -> bool:
    with SessionLocal() as db:
        try:
            db.execute(
                text("SELECT 1 FROM users WHERE id = :id FOR NO KEY UPDATE NOWAIT"),
                {"id": user_id},
            )
        except OperationalError:
            return False
        return True


def test_ordinary_account_lock_lets_rows_refer_to_the_account(account) -> None:
    owner = account()

    with SessionLocal() as db:
        auth_service._lock_account(db, owner.id)

        assert can_be_referred_to(owner.id)
        assert not can_be_locked(owner.id)

    assert can_be_locked(owner.id)


def test_exclusive_account_lock_keeps_out_what_would_refer_to_the_account(
    account,
) -> None:
    owner = account()

    with SessionLocal() as db:
        auth_service._lock_account(db, owner.id, exclusive=True)

        assert not can_be_referred_to(owner.id)
        assert not can_be_locked(owner.id)

    assert can_be_referred_to(owner.id)


def test_locking_an_account_brings_the_loaded_one_up_to_date(
    session: Session, alice_account: User
) -> None:
    loaded_hash = alice_account.password_hash
    # Changed behind the back of the loaded object.
    session.execute(
        text("UPDATE users SET password_hash = 'changed' WHERE id = :id"),
        {"id": alice_account.id},
    )
    assert alice_account.password_hash == loaded_hash

    locked = auth_service._lock_account(session, alice_account.id)

    assert locked is alice_account
    assert alice_account.password_hash == "changed"


def test_locking_an_account_that_is_not_there_finds_nothing(session: Session) -> None:
    assert auth_service._lock_account(session, uuid.uuid4()) is None
    assert auth_service._lock_account(session, uuid.uuid4(), exclusive=True) is None


def test_checking_the_current_password_returns_the_hash_it_matched(
    session: Session, alice_account: User
) -> None:
    verified = auth_service._check_current_password(alice_account, PASSWORD)

    assert verified == alice_account.password_hash
    assert verified.startswith("$argon2id$")


def test_wrong_current_password_is_refused(
    session: Session, alice_account: User
) -> None:
    with pytest.raises(auth_service.WrongCurrentPasswordError) as refused:
        auth_service._check_current_password(alice_account, "not the password")

    assert refused.value.status_code == 400


def test_account_whose_password_is_unchanged_is_locked_and_returned(
    session: Session, alice_account: User
) -> None:
    verified = auth_service._check_current_password(alice_account, PASSWORD)

    with recorded_selects() as statements:
        account = auth_service._lock_account_if_unchanged(
            session, alice_account, verified
        )

    assert account is alice_account
    [statement] = statements
    assert " ".join(statement.split()).endswith("FOR NO KEY UPDATE")


def test_exclusive_lock_is_passed_on(session: Session, alice_account: User) -> None:
    verified = auth_service._check_current_password(alice_account, PASSWORD)

    with recorded_selects() as statements:
        auth_service._lock_account_if_unchanged(
            session, alice_account, verified, exclusive=True
        )

    [statement] = statements
    assert " ".join(statement.split()).endswith("FOR UPDATE")
    assert "NO KEY" not in statement


def test_password_that_was_replaced_meanwhile_is_no_longer_the_current_one(
    session: Session, alice_account: User
) -> None:
    verified = auth_service._check_current_password(alice_account, PASSWORD)
    session.execute(
        text("UPDATE users SET password_hash = 'replaced' WHERE id = :id"),
        {"id": alice_account.id},
    )

    with pytest.raises(auth_service.WrongCurrentPasswordError):
        auth_service._lock_account_if_unchanged(session, alice_account, verified)


def test_account_that_was_removed_meanwhile_is_answered_as_not_signed_in(
    client: TestClient, session: Session, alice_account: User
) -> None:
    verified = auth_service._check_current_password(alice_account, PASSWORD)
    session.execute(delete(User).where(User.id == alice_account.id))

    with pytest.raises(auth_service.AccountNoLongerExistsError) as gone:
        auth_service._lock_account_if_unchanged(session, alice_account, verified)

    without_a_session = client.get("/auth/me")
    assert gone.value.status_code == without_a_session.status_code == 401
    assert {"detail": gone.value.detail} == without_a_session.json()
    assert isinstance(gone.value, auth_service.AuthError)


def test_password_change_still_does_what_it_did(
    alice_client: TestClient, make_client, session: Session, alice_account: User
) -> None:
    other = make_client()
    log_in(other)
    before = alice_account.password_hash

    wrong = alice_client.post(
        "/auth/change-password",
        json={"current_password": "not the password", "new_password": NEW_PASSWORD},
    )
    right = alice_client.post(
        "/auth/change-password",
        json={"current_password": PASSWORD, "new_password": NEW_PASSWORD},
    )

    assert (wrong.status_code, right.status_code) == (400, 200)
    session.refresh(alice_account)
    assert alice_account.password_hash != before
    assert alice_client.get("/auth/me").status_code == 200
    assert other.get("/auth/me").status_code == 401
    alive = session.scalars(
        select(UserSession).where(UserSession.revoked_at.is_(None))
    ).all()
    assert len(alive) == 1


def test_wrong_confirmation_is_counted_for_the_account_not_for_the_operation(
    alice_client: TestClient, session: Session, alice_account: User
) -> None:
    alice_client.post(
        "/auth/change-password",
        json={"current_password": "not the password", "new_password": NEW_PASSWORD},
    )

    def counted(scope: str) -> int | None:
        return session.scalar(
            select(RateLimit.count).where(
                RateLimit.key_hash == key_hash(scope, str(alice_account.id))
            )
        )

    assert counted("password-confirmation:account") == 1
    assert counted("change-password:account") is None


def test_confirmation_limit_is_one_counter_keyed_by_the_account() -> None:
    account_id = uuid.uuid4()
    current = types.SimpleNamespace(user_id=account_id)

    [limit] = password_confirmation_limits(current)

    assert limit.scope == "password-confirmation:account"
    assert limit.subject == str(account_id)
    assert limit.maximum == settings.password_confirmation_failures


def test_confirmation_limit_is_a_setting_under_its_own_name(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    for name in Settings.model_fields:
        monkeypatch.delenv(name.upper(), raising=False)
    monkeypatch.setenv("PASSWORD_CONFIRMATION_FAILURES", "3")
    # The name it had while only one operation asked for the password.
    monkeypatch.setenv("PASSWORD_CHANGE_FAILURES", "99")

    configured = Settings(
        _env_file=None, environment="development", database_url="postgresql://unused"
    )

    assert configured.password_confirmation_failures == 3
    assert "password_change_failures" not in Settings.model_fields
    assert Settings.model_fields["password_confirmation_failures"].default == 5


def test_confirmation_limit_is_read_at_the_moment_of_asking(
    alice_client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(settings, "password_confirmation_failures", 2)

    answers = [
        alice_client.post(
            "/auth/change-password",
            json={"current_password": f"guess {number}", "new_password": NEW_PASSWORD},
        ).status_code
        for number in range(3)
    ]

    assert answers == [400, 400, 429]
