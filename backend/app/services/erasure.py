"""Removes posts and accounts for good; one lock serializes every erasure."""

import uuid
from collections.abc import Collection
from datetime import datetime

from sqlalchemy import ColumnElement, Uuid, any_, delete, exists, func, literal
from sqlalchemy import select, update
from sqlalchemy.dialects.postgresql import ARRAY
from sqlalchemy.orm import InstrumentedAttribute, Session, aliased

from app.models import Like, Post, Repost, Story, User

# Lock order: the acting account's row, this lock, the request's posts or stories,
# tokens and sessions. Nothing takes two in reverse, so requests can't deadlock.
ERASURE_LOCK_KEY = 0x686F70736E6F70


def lock_erasure(db: Session) -> None:
    """Held until the transaction ends; take after the account's row, before posts."""
    db.execute(select(func.pg_advisory_xact_lock(ERASURE_LOCK_KEY)))


def _one_of(
    column: InstrumentedAttribute[uuid.UUID] | InstrumentedAttribute[uuid.UUID | None],
    ids: Collection[uuid.UUID],
) -> ColumnElement[bool]:
    """One array parameter: listed ids would hit the statement limit of 65,535."""
    return column == any_(literal(list(ids), ARRAY(Uuid)))


# In bulk: session objects aren't synced; the caller's commit expires them.
_IN_BULK = {"synchronize_session": False}


def erase_posts(db: Session, post_ids: Collection[uuid.UUID], now: datetime) -> None:
    """Caller holds the erasure lock and posts FOR UPDATE; writers are waited for."""
    post_ids = list(post_ids)
    if not post_ids:
        return
    # Explicitly: a tombstone keeps its row and must not keep these.
    for kind in (Like, Repost):
        db.execute(
            delete(kind).where(_one_of(kind.post_id, post_ids)),
            execution_options=_IN_BULK,
        )
    db.execute(
        update(Post)
        .where(_one_of(Post.id, post_ids), Post.deleted_at.is_(None))
        .values(author_id=None, content=None, deleted_at=now),
        execution_options=_IN_BULK,
    )
    prune_tombstones(db, post_ids)


def prune_tombstones(db: Session, candidate_ids: Collection[uuid.UUID]) -> int:
    """Removes childless tombstones upwards; locks wait out replies being written."""
    reply = aliased(Post)
    candidates = set(candidate_ids)
    removed = 0
    while candidates:
        tombstones = db.scalars(
            select(Post.id)
            .where(_one_of(Post.id, candidates), Post.deleted_at.is_not(None))
            .order_by(Post.id)
            .with_for_update()
        ).all()
        if not tombstones:
            break
        # Own statement, begun after the locks: it sees replies committed while waiting.
        answered_posts = db.scalars(
            delete(Post)
            .where(
                _one_of(Post.id, tombstones),
                ~exists().where(reply.parent_post_id == Post.id),
            )
            .returning(Post.parent_post_id),
            execution_options=_IN_BULK,
        ).all()
        removed += len(answered_posts)
        # What they answered may now be without a reply itself.
        candidates = {post_id for post_id in answered_posts if post_id is not None}
    return removed


def erase_account(db: Session, user_id: uuid.UUID, now: datetime) -> list[uuid.UUID]:
    """Returns picture ids to delete after commit; caller holds the row FOR UPDATE."""
    lock_erasure(db)
    # Locked first: a reply or like being written is waited for (see ``erase_posts``).
    post_ids = db.scalars(
        select(Post.id)
        .where(Post.author_id == user_id)
        .order_by(Post.id)
        .with_for_update()
    ).all()
    erase_posts(db, post_ids, now)
    # Views cascade; a view being recorded is waited for the same way.
    pictures = db.scalars(
        delete(Story).where(Story.author_id == user_id).returning(Story.media_id),
        execution_options=_IN_BULK,
    ).all()
    avatar_ids = db.scalars(
        delete(User).where(User.id == user_id).returning(User.avatar_id),
        execution_options=_IN_BULK,
    ).all()
    return [*pictures, *(avatar_id for avatar_id in avatar_ids if avatar_id)]
