"""Follower counts are always computed from ``follows``, never stored."""

import uuid
from collections.abc import Mapping
from dataclasses import dataclass
from datetime import datetime

from sqlalchemy import (
    ColumnElement,
    ScalarSelect,
    delete,
    exists,
    false,
    func,
    select,
)
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import InstrumentedAttribute, Session, contains_eager

from app.core.image_store import image_store
from app.core.media_urls import avatar_url
from app.core.pagination import Cursor, Page, paginate
from app.models import Follow, User
from app.services import auth as auth_service
from app.services import images
from app.services.auth import hold_account

# The only columns the profile API may write; the picture changes only by upload.
EDITABLE_FIELDS = frozenset({"display_name", "bio"})

# Deactivated and unverified accounts can't log in, so neither is shown anywhere.
ACCOUNT_IS_SHOWN = (
    User.is_active.is_(True),
    User.email_verified_at.is_not(None),
)


class UserError(Exception):
    status_code = 400
    detail = "The request could not be completed."


class UserNotFoundError(UserError):
    status_code = 404
    detail = "User not found."


class SelfFollowError(UserError):
    detail = "You cannot follow yourself."


@dataclass(frozen=True)
class PublicProfile:
    """Has no private fields at all."""

    id: uuid.UUID
    username: str
    display_name: str
    bio: str | None
    avatar_url: str | None
    created_at: datetime
    followers_count: int
    following_count: int
    # False for an anonymous reader; the one value here that depends on who asks.
    following: bool


@dataclass(frozen=True)
class OwnProfile:
    user: User
    followers_count: int
    following_count: int


def get_public_profile(
    db: Session, username: str, viewer: User | None
) -> PublicProfile | None:
    """Only public columns are selected; private ones never leave the database here."""
    followers_count, following_count = _follow_counts(User.id)
    row = db.execute(
        select(
            User.id,
            User.username,
            User.display_name,
            User.bio,
            User.avatar_id,
            User.created_at,
            followers_count.label("followers_count"),
            following_count.label("following_count"),
            is_followed_by(viewer, User.id).label("following"),
        ).where(User.username == username, *ACCOUNT_IS_SHOWN)
    ).one_or_none()
    if row is None:
        return None
    fields = dict(row._mapping)
    avatar_id = fields.pop("avatar_id")
    return PublicProfile(
        **fields,
        avatar_url=avatar_url(row.username, avatar_id) if avatar_id else None,
    )


def get_own_profile(db: Session, user: User) -> OwnProfile:
    followers_count, following_count = db.execute(
        select(*_follow_counts(user.id))
    ).one()
    return OwnProfile(user, followers_count, following_count)


def update_profile(
    db: Session,
    user: User,
    changes: Mapping[str, str | None],
) -> OwnProfile:
    """A missing field keeps its value; one mapped to None is cleared."""
    not_editable = changes.keys() - EDITABLE_FIELDS
    if not_editable:
        # A caller bug, not bad input: the request schema has no such fields.
        raise ValueError(f"Not editable through the profile: {sorted(not_editable)}")
    for name, value in changes.items():
        setattr(user, name, value)
    db.commit()
    return get_own_profile(db, user)


# File written before the row commits, old one removed after (see ``image_store``).


def set_avatar(db: Session, user: User, upload: bytes) -> OwnProfile:
    """Redrawn before locking (slow); the lock stops two uploads both keeping a file."""
    picture = images.make_picture(upload, "avatar")
    store = image_store()
    new_id = uuid.uuid4()
    store.save(new_id, picture.data)
    try:
        account = auth_service.lock_own_account(db, user)
        old_id = account.avatar_id
        account.avatar_id = new_id
        db.commit()
    except BaseException:
        db.rollback()
        store.delete([new_id])
        raise
    if old_id is not None:
        store.delete([old_id])
    return get_own_profile(db, user)


def remove_avatar(db: Session, user: User) -> OwnProfile:
    """Removing none is not an error."""
    account = auth_service.lock_own_account(db, user)
    old_id = account.avatar_id
    account.avatar_id = None
    db.commit()
    if old_id is not None:
        image_store().delete([old_id])
    return get_own_profile(db, user)


def read_avatar(db: Session, username: str, avatar_id: uuid.UUID) -> bytes:
    """Replaced, foreign or hidden pictures are not found, as a hidden profile is."""
    found = db.scalar(
        select(User.avatar_id).where(
            User.username == username, User.avatar_id == avatar_id, *ACCOUNT_IS_SHOWN
        )
    )
    # Ends the transaction; the file is read after it.
    db.commit()
    data = image_store().read(avatar_id) if found is not None else None
    if data is None:
        raise UserNotFoundError
    return data


def _follow_counts(
    user_id: ColumnElement[uuid.UUID] | uuid.UUID,
) -> tuple[ScalarSelect[int], ScalarSelect[int]]:
    followers_count = (
        select(func.count())
        .select_from(Follow)
        .where(Follow.following_id == user_id)
        .scalar_subquery()
    )
    following_count = (
        select(func.count())
        .select_from(Follow)
        .where(Follow.follower_id == user_id)
        .scalar_subquery()
    )
    return followers_count, following_count


def is_followed_by(
    viewer: User | None, user_id: ColumnElement[uuid.UUID] | uuid.UUID
) -> ColumnElement[bool]:
    if viewer is None:
        return false()
    return exists().where(
        Follow.follower_id == viewer.id, Follow.following_id == user_id
    )


def _shown_user_id(db: Session, username: str, *, hold: bool = False) -> uuid.UUID:
    """``hold`` locks FOR KEY SHARE until commit, for a row about to refer to it."""
    found = select(User.id).where(User.username == username, *ACCOUNT_IS_SHOWN)
    if hold:
        found = found.with_for_update(read=True, key_share=True)
    user_id = db.scalar(found)
    if user_id is None:
        raise UserNotFoundError
    return user_id


def set_follow(db: Session, user: User, username: str, *, following: bool) -> bool:
    """Idempotent; both accounts are held until the row is written, the user's first."""
    hold_account(db, user)
    target_id = _shown_user_id(db, username, hold=True)

    if following:
        # The database refuses this too, but here it's an answer to the client.
        if target_id == user.id:
            raise SelfFollowError
        # The primary key rules out a second row, so racing inserts can't both land.
        db.execute(
            insert(Follow)
            .values(follower_id=user.id, following_id=target_id)
            .on_conflict_do_nothing()
        )
    else:
        db.execute(
            delete(Follow).where(
                Follow.follower_id == user.id, Follow.following_id == target_id
            )
        )

    # Read after the change, in its transaction.
    now_following = db.scalar(select(is_followed_by(user, target_id)))
    db.commit()
    return now_following


def get_follow_status(db: Session, viewer: User | None, username: str) -> bool:
    """One query, so a hidden account is not found here either."""
    following = db.scalar(
        select(is_followed_by(viewer, User.id)).where(
            User.username == username, *ACCOUNT_IS_SHOWN
        )
    )
    if following is None:
        raise UserNotFoundError
    return following


def list_followers(
    db: Session, username: str, *, limit: int, after: Cursor | None = None
) -> Page[User]:
    return _list_follows(
        db,
        username,
        account=Follow.following_id,
        listed=Follow.follower,
        listed_id="follower_id",
        limit=limit,
        after=after,
    )


def list_following(
    db: Session, username: str, *, limit: int, after: Cursor | None = None
) -> Page[User]:
    return _list_follows(
        db,
        username,
        account=Follow.follower_id,
        listed=Follow.following,
        listed_id="following_id",
        limit=limit,
        after=after,
    )


def _list_follows(
    db: Session,
    username: str,
    *,
    account: InstrumentedAttribute[uuid.UUID],
    listed: InstrumentedAttribute[User],
    listed_id: str,
    limit: int,
    after: Cursor | None,
) -> Page[User]:
    """A follow has no id: the other account's id breaks ties and goes in the cursor."""
    account_id = _shown_user_id(db, username)
    page = paginate(
        db,
        select(Follow)
        .join(listed)
        .options(
            contains_eager(listed).load_only(
                User.username,
                User.display_name,
                User.avatar_id,
            )
        )
        .where(account == account_id, *ACCOUNT_IS_SHOWN),
        Follow,
        limit=limit,
        after=after,
        tiebreaker=listed_id,
    )
    return Page(
        items=[getattr(follow, listed.key) for follow in page.items],
        next_cursor=page.next_cursor,
    )
