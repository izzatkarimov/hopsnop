import uuid
from collections.abc import Callable

import pytest
from fastapi.testclient import TestClient
from httpx import Response
from sqlalchemy import select

from app.core.config import settings
from app.db.session import SessionLocal
from app.models import Post, User
from app.services import auth as auth_service
from app.services import erasure
from app.services import export as export_service
from concurrency import (
    Account,
    at_once,
    one_after_the_other,
    signed_in,
    stopped_after,
)
from helpers import PASSWORD, ExportAnswer, log_in, what_is_left_of

NEW_PASSWORD = "an entirely different passphrase"
NOT_AUTHENTICATED = {"detail": "Not authenticated."}
WRONG_PASSWORD = {"detail": "Current password is incorrect."}
TOO_MANY = {"detail": "Too many requests. Try again later."}
POSTS = 5

HAS_CHECKED_THE_PASSWORD = (auth_service, "verify_password")
IS_READING = (export_service, "_posts")
DELETION_STOPS = {
    "holds the account": (auth_service, "_lock_account_if_unchanged"),
    "has removed everything": (erasure, "erase_account"),
}


def export(client: TestClient, password: str = PASSWORD) -> ExportAnswer:
    return ExportAnswer(client.post("/users/me/export", json={"password": password}))


def remove(client: TestClient) -> Response:
    return client.post("/auth/delete-account", json={"password": PASSWORD})


def change(client: TestClient) -> Response:
    return client.post(
        "/auth/change-password",
        json={"current_password": PASSWORD, "new_password": NEW_PASSWORD},
    )


def exists(account: Account) -> bool:
    with SessionLocal() as db:
        return db.scalar(select(User.id).where(User.id == account.id)) is not None


class Scene:
    def __init__(self, account: Callable[[], Account]) -> None:
        self.owner, self.other = account(), account()
        self.exporting = signed_in(self.owner, 0)
        self.elsewhere = signed_in(self.owner, 1)
        self.others = signed_in(self.other)
        self.posts = [self.write(f"The owner's post {n}") for n in range(POSTS)]
        self.others_post = self.others.post(
            "/posts", json={"content": "Somebody else's post"}
        ).json()["id"]
        liked = self.exporting.post(f"/posts/{self.others_post}/like")
        followed = self.exporting.post(f"/users/{self.other.name}/follow")
        followed_back = self.others.post(f"/users/{self.owner.name}/follow")
        for response in (liked, followed, followed_back):
            assert response.status_code == 200

    def write(self, content: str, client: TestClient | None = None) -> str:
        response = (client or self.exporting).post("/posts", json={"content": content})
        assert response.status_code == 201, response.text
        return response.json()["id"]

    def assert_whole(self, response: Response, sessions: int = 2) -> dict:
        assert response.status_code == 200, response.text
        document = response.json()
        assert document["account"]["id"] == str(self.owner.id)
        assert document["account"]["username"] == self.owner.name
        assert [post["id"] for post in document["posts"]] == self.posts
        assert [like["post_id"] for like in document["likes"]] == [self.others_post]
        assert [e["username"] for e in document["following"]] == [self.other.name]
        assert [e["username"] for e in document["followers"]] == [self.other.name]
        assert len(document["sessions"]) == sessions
        assert [s["is_current"] for s in document["sessions"]].count(True) == 1
        assert self.other.email not in response.text
        assert str(self.other.id) not in response.text
        assert "Somebody else's post" not in response.text
        return document

    def assert_nothing_given(self, response: Response) -> None:
        assert "content-disposition" not in response.headers
        for private in (self.owner.email, "The owner's post", self.other.email):
            assert private not in response.text
        assert set(response.json()) == {"detail"}

    def assert_owner_gone(self) -> None:
        with SessionLocal() as db:
            left = what_is_left_of(
                db,
                user_id=self.owner.id,
                texts=[self.owner.name, self.owner.email, "The owner's post"],
            )
        assert left == []


def test_export_that_is_reading_is_finished_before_the_account_is_removed(
    account, monkeypatch: pytest.MonkeyPatch
) -> None:
    scene = Scene(account)
    gate = stopped_after(monkeypatch, *IS_READING)

    exported, deleted, waited = one_after_the_other(
        lambda: export(scene.exporting), lambda: remove(scene.elsewhere), gate
    )

    assert waited
    scene.assert_whole(exported)
    assert deleted.status_code == 204
    scene.assert_owner_gone()


@pytest.mark.parametrize("stopped", DELETION_STOPS)
def test_export_during_the_deletion_waits_and_is_given_nothing(
    account, monkeypatch: pytest.MonkeyPatch, stopped: str
) -> None:
    scene = Scene(account)
    gate = stopped_after(monkeypatch, *DELETION_STOPS[stopped])

    deleted, exported, waited = one_after_the_other(
        lambda: remove(scene.elsewhere), lambda: export(scene.exporting), gate
    )

    assert waited
    assert deleted.status_code == 204
    assert exported.status_code == 401
    assert exported.json() == NOT_AUTHENTICATED
    scene.assert_nothing_given(exported)
    scene.assert_owner_gone()


def test_export_that_had_only_checked_the_password_finds_no_account(
    account, monkeypatch: pytest.MonkeyPatch
) -> None:
    scene = Scene(account)
    gate = stopped_after(monkeypatch, *HAS_CHECKED_THE_PASSWORD)

    exported, deleted, waited = one_after_the_other(
        lambda: export(scene.exporting), lambda: remove(scene.elsewhere), gate
    )

    assert not waited
    assert deleted.status_code == 204
    assert exported.status_code == 401
    assert exported.json() == NOT_AUTHENTICATED
    scene.assert_nothing_given(exported)
    scene.assert_owner_gone()


@pytest.mark.parametrize("attempt", range(4))
def test_export_and_deletion_at_once_give_a_whole_export_or_none(
    account, attempt: int
) -> None:
    scene = Scene(account)

    exported, deleted = at_once(
        2, lambda n: export(scene.exporting) if n == 0 else remove(scene.elsewhere)
    )

    assert deleted.status_code == 204
    if exported.status_code == 200:
        scene.assert_whole(exported)
    else:
        assert exported.status_code == 401
        scene.assert_nothing_given(exported)
    scene.assert_owner_gone()


def test_export_after_a_change_of_password_is_refused(
    account, monkeypatch: pytest.MonkeyPatch
) -> None:
    scene = Scene(account)
    gate = stopped_after(monkeypatch, auth_service, "_lock_account_if_unchanged")

    changed, exported, waited = one_after_the_other(
        lambda: change(scene.elsewhere), lambda: export(scene.exporting), gate
    )

    assert waited
    assert changed.status_code == 200
    assert exported.status_code == 400
    assert exported.json() == WRONG_PASSWORD
    scene.assert_nothing_given(exported)
    assert scene.exporting.get("/auth/me").status_code == 401
    assert export(scene.elsewhere, NEW_PASSWORD).status_code == 200


def test_export_that_had_only_checked_the_old_password_is_refused(
    account, monkeypatch: pytest.MonkeyPatch
) -> None:
    scene = Scene(account)
    gate = stopped_after(monkeypatch, *HAS_CHECKED_THE_PASSWORD)

    exported, changed, waited = one_after_the_other(
        lambda: export(scene.exporting), lambda: change(scene.elsewhere), gate
    )

    assert not waited
    assert changed.status_code == 200
    assert exported.status_code == 400
    assert exported.json() == WRONG_PASSWORD
    scene.assert_nothing_given(exported)


def test_export_that_is_reading_is_finished_before_the_password_is_changed(
    account, monkeypatch: pytest.MonkeyPatch
) -> None:
    scene = Scene(account)
    gate = stopped_after(monkeypatch, *IS_READING)

    exported, changed, waited = one_after_the_other(
        lambda: export(scene.exporting), lambda: change(scene.elsewhere), gate
    )

    assert waited
    scene.assert_whole(exported)
    assert changed.status_code == 200
    assert scene.exporting.get("/auth/me").status_code == 401
    newcomer = scene.owner.client(8)
    assert log_in(newcomer, scene.owner.name, NEW_PASSWORD).status_code == 200


def test_export_after_a_reset_of_the_password_is_refused(
    account, issued: list[str], monkeypatch: pytest.MonkeyPatch
) -> None:
    scene = Scene(account)
    mailbox = scene.owner.client(2)
    asked = mailbox.post("/auth/forgot-password", json={"email": scene.owner.email})
    assert asked.status_code == 202
    token = issued[-1]
    gate = stopped_after(monkeypatch, auth_service, "_usable_token")

    was_reset, exported, waited = one_after_the_other(
        lambda: mailbox.post(
            "/auth/reset-password", json={"token": token, "new_password": NEW_PASSWORD}
        ),
        lambda: export(scene.exporting),
        gate,
    )

    assert waited
    assert was_reset.status_code == 200
    assert exported.status_code == 400
    assert exported.json() == WRONG_PASSWORD
    scene.assert_nothing_given(exported)


def test_login_during_an_export_waits_for_it(
    account, monkeypatch: pytest.MonkeyPatch
) -> None:
    scene = Scene(account)
    gate = stopped_after(monkeypatch, *IS_READING)
    newcomer = scene.owner.client(5)

    exported, logged_in, waited = one_after_the_other(
        lambda: export(scene.exporting),
        lambda: log_in(newcomer, scene.owner.name),
        gate,
    )

    assert waited
    assert logged_in.status_code == 200
    scene.assert_whole(exported, sessions=2)


def test_what_the_user_does_during_an_export_is_not_held_up_by_it(
    account, monkeypatch: pytest.MonkeyPatch
) -> None:
    scene = Scene(account)
    third = signed_in(account())
    gate = stopped_after(monkeypatch, *IS_READING)
    done: list[Response] = []

    def meanwhile() -> Response:
        written = {"content": "Written meanwhile"}
        done.append(scene.elsewhere.post("/posts", json=written))
        done.append(scene.elsewhere.delete(f"/posts/{scene.others_post}/like"))
        done.append(scene.elsewhere.post(f"/posts/{scene.posts[0]}/like"))
        done.append(scene.elsewhere.delete(f"/users/{scene.other.name}/follow"))
        done.append(third.post(f"/users/{scene.owner.name}/follow"))
        return done[-1]

    exported, _, waited = one_after_the_other(
        lambda: export(scene.exporting), meanwhile, gate
    )

    assert not waited
    assert [response.status_code for response in done] == [201, 200, 200, 200, 200]
    assert exported.status_code == 200
    document = exported.json()
    assert [post["id"] for post in document["posts"]] == scene.posts
    assert "Written meanwhile" not in exported.text
    assert [like["post_id"] for like in document["likes"]] == [scene.posts[0]]
    assert document["following"] == []
    assert len(document["followers"]) == 2


def test_post_deleted_during_an_export_is_not_held_up_and_not_put_back(
    account, monkeypatch: pytest.MonkeyPatch
) -> None:
    scene = Scene(account)
    gate = stopped_after(monkeypatch, export_service, "_sessions")

    exported, deleted, waited = one_after_the_other(
        lambda: export(scene.exporting),
        lambda: scene.elsewhere.delete(f"/posts/{scene.posts[2]}"),
        gate,
    )

    assert not waited
    assert deleted.status_code == 204
    assert exported.status_code == 200
    assert [post["id"] for post in exported.json()["posts"]] == [
        post for post in scene.posts if post != scene.posts[2]
    ]
    erased = uuid.UUID(scene.posts[2])
    with SessionLocal() as db:
        assert db.scalar(select(Post.id).where(Post.id == erased)) is None


def test_two_exports_of_one_account_take_turns_and_agree(
    account, monkeypatch: pytest.MonkeyPatch
) -> None:
    scene = Scene(account)
    gate = stopped_after(monkeypatch, *IS_READING)

    first, second, waited = one_after_the_other(
        lambda: export(scene.exporting), lambda: export(scene.elsewhere), gate
    )

    assert waited
    here, there = scene.assert_whole(first), scene.assert_whole(second)
    for document in (here, there):
        document.pop("generated_at")
    assert [s["is_current"] for s in here["sessions"]] == [True, False]
    assert [s["is_current"] for s in there["sessions"]] == [False, True]
    for document in (here, there):
        document.pop("sessions")
    assert here == there


def test_exports_asked_for_all_at_once_do_not_outnumber_the_limit(account) -> None:
    scene = Scene(account)
    allowed = settings.data_exports_per_account
    clients = [scene.exporting, scene.elsewhere] + [
        signed_in(scene.owner, number) for number in range(2, 8)
    ]

    answers = at_once(len(clients), lambda number: export(clients[number]))

    given = [answer for answer in answers if answer.status_code == 200]
    refused = [answer for answer in answers if answer.status_code != 200]
    assert len(given) == allowed
    for answer in given:
        scene.assert_whole(answer, sessions=len(clients))
    for answer in refused:
        assert answer.status_code == 429
        assert answer.json() == TOO_MANY
        scene.assert_nothing_given(answer)
    assert exists(scene.owner)


def test_guesses_made_all_at_once_do_not_outnumber_the_limit(account) -> None:
    scene = Scene(account)
    allowed = settings.password_confirmation_failures
    clients = [scene.exporting, scene.elsewhere] + [
        signed_in(scene.owner, number) for number in range(2, 9)
    ]

    answers = at_once(
        len(clients), lambda number: export(clients[number], f"guess number {number}")
    )

    statuses = [answer.status_code for answer in answers]
    assert set(statuses) <= {400, 429}
    for answer in answers:
        scene.assert_nothing_given(answer)
    looked_at = statuses.count(400)
    assert 1 <= looked_at <= allowed
    for _ in range(allowed - looked_at):
        assert export(scene.exporting, "one more guess").status_code == 400
    assert export(scene.exporting).status_code == 429
    assert exists(scene.owner)
