"""The client supplies only text and post ids, never an author or a timestamp."""

import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

from sqlalchemy import (
    ColumnElement,
    ScalarSelect,
    Select,
    delete,
    exists,
    false,
    func,
    select,
)
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session, contains_eager, with_expression

from app.core.pagination import Cursor, Page, paginate
from app.models import Like, Post, Repost, User
from app.services import erasure
from app.services.auth import hold_account
from app.services.users import ACCOUNT_IS_SHOWN, is_followed_by

EDIT_WINDOW_MINUTES = 60
# From created_at, never stored, so editing doesn't move the deadline.
EDIT_WINDOW = timedelta(minutes=EDIT_WINDOW_MINUTES)


class PostError(Exception):
    status_code = 400
    detail = "The request could not be completed."


class PostNotFoundError(PostError):
    status_code = 404
    detail = "Post not found."


class ParentPostNotFoundError(PostError):
    status_code = 404
    detail = "Parent post not found."


class NotPostAuthorError(PostError):
    status_code = 403
    detail = "You are not the author of this post."


class EditWindowExpiredError(PostError):
    status_code = 409
    detail = (
        f"A post can only be edited within {EDIT_WINDOW_MINUTES} minutes of "
        "being created."
    )


class UserNotFoundError(PostError):
    status_code = 404
    detail = "User not found."


def _now() -> datetime:
    return datetime.now(timezone.utc)


# Which posts are shown is decided here, through ``_visible_posts``, and nowhere else.


# To the database, both are a row saying "this user, this post".
_Interaction = type[Like] | type[Repost]


def _count_of(
    kind: _Interaction, post_id: ColumnElement[uuid.UUID] | uuid.UUID
) -> ScalarSelect[int]:
    """Counted from the rows every time, so no stored counter can drift."""
    return (
        select(func.count())
        .select_from(kind)
        .where(kind.post_id == post_id)
        .scalar_subquery()
    )


def _made_by(
    kind: _Interaction,
    post_id: ColumnElement[uuid.UUID] | uuid.UUID,
    viewer: User | None,
) -> ColumnElement[bool]:
    if viewer is None:
        return false()
    return exists().where(kind.user_id == viewer.id, kind.post_id == post_id)


def _visible_posts(viewer: User | None) -> Select[tuple[Post]]:
    """Computed values are gone after a commit, so read the post again to return it."""
    return (
        select(Post)
        .join(Post.author)
        .options(
            contains_eager(Post.author).load_only(
                User.username,
                User.display_name,
                User.avatar_id,
            ),
            with_expression(Post.like_count, _count_of(Like, Post.id)),
            with_expression(Post.liked_by_me, _made_by(Like, Post.id, viewer)),
            with_expression(Post.repost_count, _count_of(Repost, Post.id)),
            with_expression(Post.reposted_by_me, _made_by(Repost, Post.id, viewer)),
        )
        .where(Post.deleted_at.is_(None), *ACCOUNT_IS_SHOWN)
    )


def get_post(db: Session, post_id: uuid.UUID, viewer: User | None) -> Post:
    """Missing, deleted and hidden are one "not found": same answer, same work."""
    post = db.scalar(_visible_posts(viewer).where(Post.id == post_id))
    if post is None:
        raise PostNotFoundError
    return post


def list_user_posts(
    db: Session,
    username: str,
    viewer: User | None,
    *,
    limit: int,
    after: Cursor | None = None,
) -> Page[Post]:
    account_id = db.scalar(
        select(User.id).where(User.username == username, *ACCOUNT_IS_SHOWN)
    )
    if account_id is None:
        raise UserNotFoundError

    return paginate(
        db,
        _visible_posts(viewer).where(Post.author_id == account_id),
        Post,
        limit=limit,
        after=after,
    )


def list_for_you_feed(
    db: Session,
    viewer: User | None,
    *,
    limit: int,
    after: Cursor | None = None,
) -> Page[Post]:
    """Not a recommendation: every shown post, newest first, replies included."""
    return paginate(
        db,
        _visible_posts(viewer),
        Post,
        limit=limit,
        after=after,
    )


def list_following_feed(
    db: Session,
    viewer: User,
    *,
    limit: int,
    after: Cursor | None = None,
) -> Page[Post]:
    """Worked out from ``follows`` per query, so unfollowing takes effect at once."""
    return paginate(
        db,
        _visible_posts(viewer).where(is_followed_by(viewer, Post.author_id)),
        Post,
        limit=limit,
        after=after,
    )


def list_replies(
    db: Session,
    post_id: uuid.UUID,
    viewer: User | None,
    *,
    limit: int,
    after: Cursor | None = None,
) -> Page[Post]:
    """A post that isn't shown is not found, so its replies can't be listed via it."""
    shown = db.scalar(
        select(Post.id)
        .join(Post.author)
        .where(Post.id == post_id, Post.deleted_at.is_(None), *ACCOUNT_IS_SHOWN)
    )
    if shown is None:
        raise PostNotFoundError

    return paginate(
        db,
        _visible_posts(viewer).where(Post.parent_post_id == post_id),
        Post,
        limit=limit,
        after=after,
    )


def create_post(
    db: Session,
    author: User,
    *,
    content: str,
    parent_post_id: uuid.UUID | None = None,
) -> Post:
    """The author's account, then the parent, are held until the reply is written."""
    hold_account(db, author)
    if parent_post_id is not None:
        _referred_to(db, author, parent_post_id, not_found=ParentPostNotFoundError)

    now = _now()
    post = Post(
        author=author,
        content=content,
        parent_post_id=parent_post_id,
        created_at=now,
        updated_at=now,
    )
    db.add(post)
    # Assigns the id, needed to read the post back.
    db.flush()
    post_id = post.id
    db.commit()
    return get_post(db, post_id, author)


def update_post(db: Session, user: User, post_id: uuid.UUID, *, content: str) -> Post:
    post = _own_post_for_change(db, user, post_id)
    now = _now()
    # Closes at the deadline itself: created 12:00, editable until 12:59:59.
    if now >= post.created_at + EDIT_WINDOW:
        raise EditWindowExpiredError
    # The same text isn't an edit.
    if content != post.content:
        post.content = content
        post.updated_at = now
    db.commit()
    return get_post(db, post_id, user)


def delete_post(db: Session, user: User, post_id: uuid.UUID) -> None:
    """No text or author is kept; a post with replies stays as a tombstone."""
    # Before the post is locked, per the erasure lock order.
    erasure.lock_erasure(db)
    post = _own_post_for_change(db, user, post_id)
    erasure.erase_posts(db, [post.id], _now())
    db.commit()


def _own_post_for_change(db: Session, user: User, post_id: uuid.UUID) -> Post:
    """A post the user can't see is not found, not forbidden; locked until commit."""
    post = db.scalar(
        _visible_posts(user).where(Post.id == post_id).with_for_update(of=Post)
    )
    if post is None:
        raise PostNotFoundError
    if post.author_id != user.id:
        raise NotPostAuthorError
    return post


def _referred_to(
    db: Session,
    user: User,
    post_id: uuid.UUID,
    *,
    not_found: type[PostError],
) -> None:
    """FOR KEY SHARE until commit, so the post can't go before the row is written."""
    found = db.scalar(
        select(Post.id)
        .join(Post.author)
        .where(Post.id == post_id, Post.deleted_at.is_(None), *ACCOUNT_IS_SHOWN)
        .with_for_update(read=True, key_share=True, of=Post)
    )
    if found is None:
        raise not_found


@dataclass(frozen=True)
class InteractionState:
    active: bool
    count: int


def set_like(
    db: Session, user: User, post_id: uuid.UUID, *, liked: bool
) -> InteractionState:
    return _set_interaction(db, Like, user, post_id, wanted=liked)


def set_repost(
    db: Session, user: User, post_id: uuid.UUID, *, reposted: bool
) -> InteractionState:
    return _set_interaction(db, Repost, user, post_id, wanted=reposted)


def _set_interaction(
    db: Session,
    kind: _Interaction,
    user: User,
    post_id: uuid.UUID,
    *,
    wanted: bool,
) -> InteractionState:
    """Idempotent; the user's account, then the post, are held against deletion."""
    hold_account(db, user)
    _referred_to(db, user, post_id, not_found=PostNotFoundError)

    if wanted:
        # The primary key rules out a second row, so racing inserts can't both land.
        db.execute(
            insert(kind)
            .values(user_id=user.id, post_id=post_id)
            .on_conflict_do_nothing()
        )
    else:
        db.execute(
            delete(kind).where(kind.user_id == user.id, kind.post_id == post_id)
        )

    # Read after the change, in its transaction: what the database holds.
    active, count = db.execute(
        select(_made_by(kind, post_id, user), _count_of(kind, post_id))
    ).one()
    db.commit()
    return InteractionState(active=active, count=count)
