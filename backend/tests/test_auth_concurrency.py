from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select, update

from app.core.config import settings
from app.core.security import hash_token
from app.db.session import SessionLocal
from app.models import EmailVerificationToken, PasswordResetToken, User
from app.services import auth as auth_service
from concurrency import TIMEOUT, Gate, let_run
from helpers import PASSWORD, log_in

NEW_PASSWORD = "an entirely different passphrase"


STOPS = {
    "after the password was checked": "verify_password",
    "while the session is being created": "generate_token",
}


@pytest.mark.parametrize("stopped", STOPS)
@pytest.mark.parametrize("replaced_by", ["change", "reset"])
def test_login_with_the_old_password_does_not_outlive_its_replacement(
    account,
    issued: list[str],
    monkeypatch: pytest.MonkeyPatch,
    replaced_by: str,
    stopped: str,
) -> None:
    owner_account = account()
    owner = owner_account.client(0)
    intruder = owner_account.client(1)
    elsewhere = owner_account.client(2)
    name = owner_account.name
    assert log_in(owner, name).status_code == 200
    if replaced_by == "reset":
        assert (
            elsewhere.post(
                "/auth/forgot-password", json={"email": owner_account.email}
            ).status_code
            == 202
        )
    reset_token = issued[-1]

    def replace_the_password() -> int:
        if replaced_by == "change":
            response = owner.post(
                "/auth/change-password",
                json={"current_password": PASSWORD, "new_password": NEW_PASSWORD},
            )
        else:
            response = elsewhere.post(
                "/auth/reset-password",
                json={"token": reset_token, "new_password": NEW_PASSWORD},
            )
        return response.status_code

    gate = Gate()
    function = STOPS[stopped]
    monkeypatch.setattr(
        auth_service, function, gate.wrap(getattr(auth_service, function))
    )

    with ThreadPoolExecutor(2) as pool:
        gate.close()
        login = pool.submit(lambda: log_in(intruder, name).status_code)
        assert gate.reached.wait(TIMEOUT), "the login never got that far"
        replacement = pool.submit(replace_the_password)
        let_run(replacement)
        gate.open()
        login_status = login.result(TIMEOUT)
        replacement_status = replacement.result(TIMEOUT)

    assert replacement_status == 200
    assert login_status in (200, 401)
    assert intruder.get("/auth/me").status_code == 401
    with SessionLocal() as db:
        alive = [s for s in owner_account.sessions(db) if s.revoked_at is None]
        if replaced_by == "change":
            assert [s.token_hash for s in alive] == [
                hash_token(owner.cookies.get(settings.session_cookie))
            ]
        else:
            assert alive == []
    if replaced_by == "change":
        assert owner.get("/auth/me").status_code == 200
    assert log_in(owner_account.client(3), name).status_code == 401
    assert log_in(owner_account.client(4), name, NEW_PASSWORD).status_code == 200


@pytest.mark.parametrize("replaced_by", ["change", "reset"])
def test_login_that_checked_the_old_password_before_the_change_is_refused(
    account, issued: list[str], monkeypatch: pytest.MonkeyPatch, replaced_by: str
) -> None:
    owner_account = account()
    owner = owner_account.client(0)
    intruder = owner_account.client(1)
    elsewhere = owner_account.client(2)
    assert log_in(owner, owner_account.name).status_code == 200
    if replaced_by == "reset":
        elsewhere.post("/auth/forgot-password", json={"email": owner_account.email})
    reset_token = issued[-1]
    gate = Gate()
    monkeypatch.setattr(
        auth_service, "verify_password", gate.wrap(auth_service.verify_password)
    )

    with ThreadPoolExecutor(1) as pool:
        gate.close()
        login = pool.submit(lambda: log_in(intruder, owner_account.name))
        assert gate.reached.wait(TIMEOUT)
        if replaced_by == "change":
            replaced = owner.post(
                "/auth/change-password",
                json={"current_password": PASSWORD, "new_password": NEW_PASSWORD},
            )
        else:
            replaced = elsewhere.post(
                "/auth/reset-password",
                json={"token": reset_token, "new_password": NEW_PASSWORD},
            )
        assert replaced.status_code == 200
        gate.open()
        response = login.result(TIMEOUT)

    assert response.status_code == 401
    assert response.json() == {"detail": "Invalid username/email or password."}
    assert "set-cookie" not in response.headers
    with SessionLocal() as db:
        sessions = owner_account.sessions(db)
    assert len(sessions) == 1
    assert (sessions[0].revoked_at is None) == (replaced_by == "change")


def test_two_changes_of_one_password_at_once_do_not_both_take_effect(
    account, monkeypatch: pytest.MonkeyPatch
) -> None:
    owner_account = account()
    first, second = owner_account.client(0), owner_account.client(1)
    for client in (first, second):
        assert log_in(client, owner_account.name).status_code == 200
    gate = Gate()
    monkeypatch.setattr(
        auth_service, "verify_password", gate.wrap(auth_service.verify_password)
    )

    def change(client: TestClient, new_password: str) -> int:
        return client.post(
            "/auth/change-password",
            json={"current_password": PASSWORD, "new_password": new_password},
        ).status_code

    with ThreadPoolExecutor(1) as pool:
        gate.close()
        waiting = pool.submit(change, first, "the first new passphrase")
        assert gate.reached.wait(TIMEOUT)
        assert change(second, "the second new passphrase") == 200
        gate.open()
        outcome = waiting.result(TIMEOUT)

    assert outcome == 400
    assert second.get("/auth/me").status_code == 200
    assert first.get("/auth/me").status_code == 401
    third, name = owner_account.client(2), owner_account.name
    assert log_in(third, name, "the first new passphrase").status_code == 401
    assert log_in(third, name, "the second new passphrase").status_code == 200


LINKS = {
    "reset": (PasswordResetToken, "/auth/forgot-password"),
    "verification": (EmailVerificationToken, "/auth/resend-verification"),
}


@pytest.mark.parametrize("kind", LINKS)
def test_redeeming_a_link_while_another_is_requested_fails_neither(
    account, issued: list[str], monkeypatch: pytest.MonkeyPatch, kind: str
) -> None:
    model, request_path = LINKS[kind]
    owner_account = account(verified=kind == "reset")
    asking, redeeming = owner_account.client(0), owner_account.client(1)
    asked = asking.post(request_path, json={"email": owner_account.email})
    assert asked.status_code == 202
    old_link = issued[-1]
    # Old enough that asking again issues a new link and withdraws this one.
    with SessionLocal() as db:
        age = timedelta(seconds=settings.email_token_cooldown_seconds + 1)
        db.execute(
            update(model)
            .where(model.user_id == owner_account.id)
            .values(created_at=model.created_at - age)
        )
        db.commit()

    def redeem() -> int:
        if kind == "reset":
            response = redeeming.post(
                "/auth/reset-password",
                json={"token": old_link, "new_password": NEW_PASSWORD},
            )
        else:
            response = redeeming.post("/auth/verify-email", json={"token": old_link})
        return response.status_code

    gate = Gate()
    monkeypatch.setattr(
        auth_service, "_issued_recently", gate.wrap(auth_service._issued_recently)
    )

    with ThreadPoolExecutor(2) as pool:
        gate.close()
        request = pool.submit(
            lambda: asking.post(
                request_path, json={"email": owner_account.email}
            ).status_code
        )
        assert gate.reached.wait(TIMEOUT), "the request never got that far"
        redemption = pool.submit(redeem)
        let_run(redemption)
        gate.open()
        # A deadlock would surface here, as the error of the request given up on.
        request_status = request.result(TIMEOUT)
        redemption_status = redemption.result(TIMEOUT)

    assert request_status == 202
    assert redemption_status == 400
    new_link = issued[-1]
    assert new_link != old_link
    assert owner_account.unused_tokens(model) == [hash_token(new_link)]
    with SessionLocal() as db:
        user = db.get(User, owner_account.id)
        if kind == "reset":
            still = log_in(owner_account.client(2), owner_account.name)
            assert still.status_code == 200
        else:
            assert user.email_verified_at is None
        assert db.scalar(select(func.count()).select_from(model)) == 1
