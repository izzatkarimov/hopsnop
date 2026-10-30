import threading
import uuid
from concurrent.futures import ThreadPoolExecutor

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select

from app.db.session import SessionLocal
from app.models import Like, Post, Repost
from app.services import erasure
from app.services import posts as posts_service
from concurrency import TIMEOUT, Account, Gate, at_once, let_run
from helpers import log_in

NOT_FOUND = {"detail": "Post not found."}
PARENT_NOT_FOUND = {"detail": "Parent post not found."}
INTERACTIONS = {"like": Like, "repost": Repost}


def signed_in(account: Account, number: int = 0) -> TestClient:
    client = account.client(number)
    assert log_in(client, account.name).status_code == 200
    return client


def create(client: TestClient, content: str, parent: dict | None = None) -> dict:
    body = {"content": content}
    if parent is not None:
        body["parent_post_id"] = parent["id"]
    response = client.post("/posts", json=body)
    assert response.status_code == 201, response.text
    return response.json()


def row(post: dict) -> dict | None:
    with SessionLocal() as db:
        found = db.execute(
            select(Post.__table__).where(Post.id == uuid.UUID(post["id"]))
        ).one_or_none()
        return dict(found._mapping) if found is not None else None


def rows_of(model: type) -> int:
    with SessionLocal() as db:
        return db.scalar(select(func.count()).select_from(model))


def is_tombstone(post: dict) -> bool:
    stored = row(post)
    return (
        stored is not None
        and stored["author_id"] is None
        and stored["content"] is None
        and stored["deleted_at"] is not None
    )


def stopped_after(monkeypatch: pytest.MonkeyPatch, function: str) -> Gate:
    gate = Gate()
    monkeypatch.setattr(
        posts_service, function, gate.wrap(getattr(posts_service, function))
    )
    return gate


HOLDS_WHAT_IT_REFERS_TO = "_referred_to"
HOLDS_WHAT_IT_CHANGES = "_own_post_for_change"


@pytest.fixture
def people(account):
    owner, other = account(), account()
    return signed_in(owner), signed_in(other)


def test_reply_that_came_first_keeps_the_deleted_post_as_a_tombstone(
    people, monkeypatch: pytest.MonkeyPatch
) -> None:
    owner, replier = people
    post = create(owner, "About to be deleted")
    gate = stopped_after(monkeypatch, HOLDS_WHAT_IT_REFERS_TO)

    with ThreadPoolExecutor(2) as pool:
        gate.close()
        replying = pool.submit(
            lambda: replier.post(
                "/posts", json={"content": "Reply", "parent_post_id": post["id"]}
            )
        )
        assert gate.reached.wait(TIMEOUT), "the reply never got that far"
        deleting = pool.submit(lambda: owner.delete(f"/posts/{post['id']}"))
        let_run(deleting)
        assert not deleting.done()
        gate.open()
        replied, deleted = replying.result(TIMEOUT), deleting.result(TIMEOUT)

    assert (replied.status_code, deleted.status_code) == (201, 204)
    assert is_tombstone(post)
    reply = replied.json()
    assert row(reply)["parent_post_id"] == uuid.UUID(post["id"])
    assert replier.get(f"/posts/{reply['id']}").status_code == 200
    assert replier.get(f"/posts/{post['id']}").status_code == 404
    assert rows_of(Post) == 2


def test_reply_that_came_second_finds_no_post_to_answer(
    people, monkeypatch: pytest.MonkeyPatch
) -> None:
    owner, replier = people
    post = create(owner, "About to be deleted")
    gate = stopped_after(monkeypatch, HOLDS_WHAT_IT_CHANGES)

    with ThreadPoolExecutor(2) as pool:
        gate.close()
        deleting = pool.submit(lambda: owner.delete(f"/posts/{post['id']}"))
        assert gate.reached.wait(TIMEOUT), "the deletion never got that far"
        replying = pool.submit(
            lambda: replier.post(
                "/posts", json={"content": "Reply", "parent_post_id": post["id"]}
            )
        )
        let_run(replying)
        assert not replying.done()
        gate.open()
        deleted, replied = deleting.result(TIMEOUT), replying.result(TIMEOUT)

    assert (deleted.status_code, replied.status_code) == (204, 404)
    assert replied.json() == PARENT_NOT_FOUND
    assert rows_of(Post) == 0


@pytest.mark.parametrize("kind", INTERACTIONS)
@pytest.mark.parametrize("answered", [False, True])
def test_interaction_that_came_first_is_removed_with_the_post(
    people, monkeypatch: pytest.MonkeyPatch, kind: str, answered: bool
) -> None:
    owner, other = people
    post = create(owner, "About to be deleted")
    if answered:
        create(other, "A reply that keeps the row", post)
    gate = stopped_after(monkeypatch, HOLDS_WHAT_IT_REFERS_TO)

    with ThreadPoolExecutor(2) as pool:
        gate.close()
        interacting = pool.submit(lambda: other.post(f"/posts/{post['id']}/{kind}"))
        assert gate.reached.wait(TIMEOUT)
        deleting = pool.submit(lambda: owner.delete(f"/posts/{post['id']}"))
        let_run(deleting)
        assert not deleting.done()
        gate.open()
        interacted, deleted = interacting.result(TIMEOUT), deleting.result(TIMEOUT)

    assert (interacted.status_code, deleted.status_code) == (200, 204)
    assert interacted.json()[f"{kind}_count"] == 1
    assert rows_of(INTERACTIONS[kind]) == 0
    if answered:
        assert is_tombstone(post)
    else:
        assert row(post) is None


@pytest.mark.parametrize("kind", INTERACTIONS)
@pytest.mark.parametrize("method", ["POST", "DELETE"])
def test_interaction_that_came_second_finds_no_post(
    people, monkeypatch: pytest.MonkeyPatch, kind: str, method: str
) -> None:
    owner, other = people
    post = create(owner, "About to be deleted")
    gate = stopped_after(monkeypatch, HOLDS_WHAT_IT_CHANGES)

    with ThreadPoolExecutor(2) as pool:
        gate.close()
        deleting = pool.submit(lambda: owner.delete(f"/posts/{post['id']}"))
        assert gate.reached.wait(TIMEOUT)
        interacting = pool.submit(
            lambda: other.request(method, f"/posts/{post['id']}/{kind}")
        )
        let_run(interacting)
        assert not interacting.done()
        gate.open()
        deleted, interacted = deleting.result(TIMEOUT), interacting.result(TIMEOUT)

    assert (deleted.status_code, interacted.status_code) == (204, 404)
    assert interacted.json() == NOT_FOUND
    assert rows_of(INTERACTIONS[kind]) == 0
    assert rows_of(Post) == 0


def test_edit_that_came_first_is_made_and_then_erased(
    people, monkeypatch: pytest.MonkeyPatch
) -> None:
    owner, _ = people
    post = create(owner, "Original")
    gate = stopped_after(monkeypatch, HOLDS_WHAT_IT_CHANGES)
    elsewhere = signed_in_again(owner)

    with ThreadPoolExecutor(2) as pool:
        gate.close()
        editing = pool.submit(
            lambda: owner.patch(f"/posts/{post['id']}", json={"content": "Edited"})
        )
        assert gate.reached.wait(TIMEOUT)
        deleting = pool.submit(lambda: elsewhere.delete(f"/posts/{post['id']}"))
        let_run(deleting)
        assert not deleting.done()
        gate.open()
        edited, deleted = editing.result(TIMEOUT), deleting.result(TIMEOUT)

    assert (edited.status_code, deleted.status_code) == (200, 204)
    assert rows_of(Post) == 0


def test_edit_that_came_second_finds_no_post(
    people, monkeypatch: pytest.MonkeyPatch
) -> None:
    owner, _ = people
    post = create(owner, "Original")
    gate = stopped_after(monkeypatch, HOLDS_WHAT_IT_CHANGES)
    elsewhere = signed_in_again(owner)

    with ThreadPoolExecutor(2) as pool:
        gate.close()
        deleting = pool.submit(lambda: owner.delete(f"/posts/{post['id']}"))
        assert gate.reached.wait(TIMEOUT)
        editing = pool.submit(
            lambda: elsewhere.patch(f"/posts/{post['id']}", json={"content": "Edited"})
        )
        let_run(editing)
        assert not editing.done()
        gate.open()
        deleted, edited = deleting.result(TIMEOUT), editing.result(TIMEOUT)

    assert (deleted.status_code, edited.status_code) == (204, 404)
    assert edited.json() == NOT_FOUND
    assert rows_of(Post) == 0


def signed_in_again(client: TestClient) -> TestClient:
    second = TestClient(client.app, base_url="https://testserver")
    second.cookies.update(client.cookies)
    return second


def test_same_post_deleted_twice_at_once_is_deleted_once(people) -> None:
    owner, other = people
    post = create(owner, "Deleted from two tabs")
    create(other, "Reply", post)
    tabs = [owner, signed_in_again(owner)]

    answers = at_once(2, lambda number: tabs[number].delete(f"/posts/{post['id']}"))

    assert sorted(answer.status_code for answer in answers) == [204, 404]
    assert is_tombstone(post)
    assert rows_of(Post) == 2


@pytest.mark.parametrize("round_", range(4))
def test_reply_and_what_it_answers_deleted_at_once_leave_nothing(
    people, round_: int
) -> None:
    owner, other = people
    post = create(owner, "Parent")
    reply = create(other, "Its only reply", post)
    clients, posts = (owner, other), (post, reply)

    answers = at_once(
        2, lambda number: clients[number].delete(f"/posts/{posts[number]['id']}")
    )

    assert [answer.status_code for answer in answers] == [204, 204]
    assert rows_of(Post) == 0


def test_all_replies_of_a_tombstone_deleted_at_once_take_it_with_them(
    account,
) -> None:
    owner = signed_in(account())
    repliers = [signed_in(account()) for _ in range(6)]
    post = create(owner, "Parent")
    replies = [create(client, f"Reply {n}", post) for n, client in enumerate(repliers)]
    assert owner.delete(f"/posts/{post['id']}").status_code == 204
    assert is_tombstone(post)

    answers = at_once(
        6, lambda number: repliers[number].delete(f"/posts/{replies[number]['id']}")
    )

    assert [answer.status_code for answer in answers] == [204] * 6
    assert rows_of(Post) == 0


def test_deletions_happen_one_at_a_time(
    account, monkeypatch: pytest.MonkeyPatch
) -> None:
    first, second = signed_in(account()), signed_in(account())
    posts = [create(first, "First user's"), create(second, "Second user's")]
    gate = stopped_after(monkeypatch, HOLDS_WHAT_IT_CHANGES)

    with ThreadPoolExecutor(2) as pool:
        gate.close()
        one = pool.submit(lambda: first.delete(f"/posts/{posts[0]['id']}"))
        assert gate.reached.wait(TIMEOUT)
        other = pool.submit(lambda: second.delete(f"/posts/{posts[1]['id']}"))
        let_run(other)
        assert not other.done()
        gate.open()
        answers = [one.result(TIMEOUT), other.result(TIMEOUT)]

    assert [answer.status_code for answer in answers] == [204, 204]
    assert rows_of(Post) == 0


def test_nothing_else_waits_for_a_deletion(
    account, monkeypatch: pytest.MonkeyPatch
) -> None:
    owner, other = signed_in(account()), signed_in(account())
    doomed = create(owner, "Being deleted")
    elsewhere = create(owner, "Another post of the same user")
    gate = stopped_after(monkeypatch, HOLDS_WHAT_IT_CHANGES)

    def use_the_application() -> list[int]:
        written = other.post("/posts", json={"content": "Meanwhile"})
        answers = [written.status_code]
        answers += [
            other.post(
                "/posts", json={"content": "Reply", "parent_post_id": elsewhere["id"]}
            ).status_code,
            other.post(f"/posts/{elsewhere['id']}/like").status_code,
            other.post(f"/posts/{elsewhere['id']}/repost").status_code,
            other.patch(
                f"/posts/{written.json()['id']}", json={"content": "Edited"}
            ).status_code,
            other.get("/feed").status_code,
            other.get(f"/posts/{elsewhere['id']}/replies").status_code,
            other.get(f"/posts/{doomed['id']}").status_code,
        ]
        return answers

    with ThreadPoolExecutor(2) as pool:
        gate.close()
        deleting = pool.submit(lambda: owner.delete(f"/posts/{doomed['id']}"))
        assert gate.reached.wait(TIMEOUT)
        answers = pool.submit(use_the_application).result(TIMEOUT)
        assert not deleting.done()
        gate.open()
        deleted = deleting.result(TIMEOUT)

    assert answers == [201, 201, 200, 200, 200, 200, 200, 200]
    assert deleted.status_code == 204
    assert other.get(f"/posts/{doomed['id']}").status_code == 404


class ErasingEverythingOf:
    def __init__(self, account: Account) -> None:
        self.account = account
        self.holds_everything = threading.Event()
        self.may_finish = threading.Event()
        self.may_finish.set()

    def stop_when_it_holds_everything(self) -> None:
        self.may_finish.clear()

    def __call__(self) -> int:
        with SessionLocal() as db:
            erasure.lock_erasure(db)
            post_ids = db.scalars(
                select(Post.id)
                .where(Post.author_id == self.account.id)
                .order_by(Post.id)
                .with_for_update()
            ).all()
            self.holds_everything.set()
            assert self.may_finish.wait(TIMEOUT), "never let go"
            erasure.erase_posts(db, post_ids, posts_service._now())
            db.commit()
            return len(post_ids)


def test_reply_being_written_is_waited_for_by_an_erasure_of_everything(
    account, monkeypatch: pytest.MonkeyPatch
) -> None:
    author, replier_account = account(), account()
    owner, replier = signed_in(author), signed_in(replier_account)
    answered = create(owner, "This one is being answered")
    others = [create(owner, f"Post {number}") for number in range(4)]
    gate = stopped_after(monkeypatch, HOLDS_WHAT_IT_REFERS_TO)
    erase_everything = ErasingEverythingOf(author)

    with ThreadPoolExecutor(2) as pool:
        gate.close()
        replying = pool.submit(lambda: create(replier, "Reply", answered))
        assert gate.reached.wait(TIMEOUT)
        erasing = pool.submit(erase_everything)
        let_run(erasing)
        assert not erasing.done()
        gate.open()
        reply, erased = replying.result(TIMEOUT), erasing.result(TIMEOUT)

    assert erased == 5
    assert is_tombstone(answered)
    assert row(reply)["parent_post_id"] == uuid.UUID(answered["id"])
    assert [row(post) for post in others] == [None] * 4
    assert rows_of(Post) == 2


def test_reply_that_comes_during_an_erasure_of_everything_finds_no_post(
    account,
) -> None:
    author, replier_account = account(), account()
    owner, replier = signed_in(author), signed_in(replier_account)
    post = create(owner, "About to go with all the others")
    create(owner, "Another")
    erase_everything = ErasingEverythingOf(author)
    erase_everything.stop_when_it_holds_everything()

    with ThreadPoolExecutor(2) as pool:
        erasing = pool.submit(erase_everything)
        assert erase_everything.holds_everything.wait(TIMEOUT)
        replying = pool.submit(
            lambda: replier.post(
                "/posts", json={"content": "Reply", "parent_post_id": post["id"]}
            )
        )
        liking = pool.submit(lambda: replier.post(f"/posts/{post['id']}/like"))
        let_run(replying)
        assert not replying.done() and not liking.done()
        erase_everything.may_finish.set()
        erasing.result(TIMEOUT)
        replied, liked = replying.result(TIMEOUT), liking.result(TIMEOUT)

    assert (replied.status_code, liked.status_code) == (404, 404)
    assert replied.json() == PARENT_NOT_FOUND
    assert rows_of(Post) == 0
    assert rows_of(Like) == 0


@pytest.mark.parametrize("first", ["the deletion of one post", "the erasure of all"])
def test_author_deleting_one_post_while_all_are_erased_blocks_nothing_for_good(
    account, monkeypatch: pytest.MonkeyPatch, first: str
) -> None:
    author = account()
    owner = signed_in(author)
    post = create(owner, "Deleted on its own, and with all the others")
    for number in range(3):
        create(owner, f"Post {number}")
    erase_everything = ErasingEverythingOf(author)

    with ThreadPoolExecutor(2) as pool:
        if first == "the deletion of one post":
            gate = stopped_after(monkeypatch, HOLDS_WHAT_IT_CHANGES)
            gate.close()
            deleting = pool.submit(lambda: owner.delete(f"/posts/{post['id']}"))
            assert gate.reached.wait(TIMEOUT)
            erasing = pool.submit(erase_everything)
            let_run(erasing)
            assert not erasing.done()
            gate.open()
        else:
            erase_everything.stop_when_it_holds_everything()
            erasing = pool.submit(erase_everything)
            assert erase_everything.holds_everything.wait(TIMEOUT)
            deleting = pool.submit(lambda: owner.delete(f"/posts/{post['id']}"))
            let_run(deleting)
            assert not deleting.done()
            erase_everything.may_finish.set()
        deleted, erased = deleting.result(TIMEOUT), erasing.result(TIMEOUT)

    if first == "the deletion of one post":
        assert (deleted.status_code, erased) == (204, 3)
    else:
        assert (deleted.status_code, erased) == (404, 4)
    assert rows_of(Post) == 0


def test_two_erasures_of_everything_in_threads_they_share(account) -> None:
    first, second = account(), account()
    one, two = signed_in(first), signed_in(second)
    for start, then in ((one, two), (two, one)):
        post = create(start, "Top of a thread")
        for depth in range(3):
            post = create(then if depth % 2 == 0 else start, f"Level {depth}", post)
    assert rows_of(Post) == 8
    erasures = [ErasingEverythingOf(first), ErasingEverythingOf(second)]

    erased = at_once(2, lambda number: erasures[number]())

    assert sorted(erased) == [4, 4]
    assert rows_of(Post) == 0
