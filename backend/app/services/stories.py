"""The client supplies only picture, caption and story id; access is per query."""

import uuid
from datetime import datetime, timedelta, timezone

from sqlalchemy import ColumnElement, Select, case, delete, exists, func, or_, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session, contains_eager, with_expression

from app.core.image_store import image_store
from app.core.pagination import Cursor, Page, paginate
from app.models import Story, StoryView, User
from app.services import images
from app.services.auth import hold_account
from app.services.users import ACCOUNT_IS_SHOWN, is_followed_by

STORY_LIFETIME_HOURS = 24
# Stored with the story when created, and never moved.
STORY_LIFETIME = timedelta(hours=STORY_LIFETIME_HOURS)
MEDIA_TYPE = "image"


class StoryError(Exception):
    status_code = 400
    detail = "The request could not be completed."


class StoryNotFoundError(StoryError):
    status_code = 404
    detail = "Story not found."


class NotStoryAuthorError(StoryError):
    status_code = 403
    detail = "You are not the author of this story."


def _now() -> datetime:
    return datetime.now(timezone.utc)


# Who may see which stories is decided here, through ``_shown_to``, and nowhere else.


def _shown_to(viewer: User, now: datetime) -> tuple[ColumnElement[bool], ...]:
    """Ends at ``expires_at`` itself: created 12:00, shown until 11:59:59 next day."""
    return (
        Story.expires_at > now,
        *ACCOUNT_IS_SHOWN,
        or_(Story.author_id == viewer.id, is_followed_by(viewer, Story.author_id)),
    )


def _visible_stories(viewer: User, now: datetime) -> Select[tuple[Story]]:
    """The count is NULL for all but the author, so it never leaves the database."""
    view_count = (
        select(func.count())
        .select_from(StoryView)
        .where(StoryView.story_id == Story.id)
        .scalar_subquery()
    )
    viewed_by_me = exists().where(
        StoryView.story_id == Story.id, StoryView.viewer_id == viewer.id
    )
    return (
        select(Story)
        .join(Story.author)
        .options(
            contains_eager(Story.author).load_only(
                User.username,
                User.display_name,
                User.avatar_id,
            ),
            with_expression(
                Story.view_count,
                case((Story.author_id == viewer.id, view_count), else_=None),
            ),
            with_expression(Story.viewed_by_me, viewed_by_me),
        )
        .where(*_shown_to(viewer, now))
    )


def get_story(db: Session, story_id: uuid.UUID, viewer: User) -> Story:
    """Missing, expired and hidden are one "not found": same answer, same work."""
    story = db.scalar(_visible_stories(viewer, _now()).where(Story.id == story_id))
    if story is None:
        raise StoryNotFoundError
    return story


def list_stories(
    db: Session,
    viewer: User,
    *,
    limit: int,
    after: Cursor | None = None,
) -> Page[Story]:
    return paginate(
        db,
        _visible_stories(viewer, _now()),
        Story,
        limit=limit,
        after=after,
    )


def create_story(
    db: Session,
    author: User,
    *,
    upload: bytes,
    caption: str | None = None,
) -> Story:
    """Made before locking; if the row doesn't commit, the file is removed again."""
    picture = images.make_picture(upload, "story")
    store = image_store()
    media_id = uuid.uuid4()
    store.save(media_id, picture.data)
    try:
        hold_account(db, author)
        now = _now()
        story = Story(
            author=author,
            media_id=media_id,
            media_width=picture.width,
            media_height=picture.height,
            media_type=MEDIA_TYPE,
            caption=caption,
            created_at=now,
            expires_at=now + STORY_LIFETIME,
        )
        db.add(story)
        # Assigns the id, needed to read the story back.
        db.flush()
        story_id = story.id
        db.commit()
    except BaseException:
        db.rollback()
        store.delete([media_id])
        raise
    return get_story(db, story_id, author)


def delete_story(db: Session, user: User, story_id: uuid.UUID) -> None:
    """An unseen story, expired ones included, is not found rather than forbidden."""
    # Locked until commit, so of two deletes the second waits and then finds none.
    author_id = db.scalar(
        select(Story.author_id)
        .join(Story.author)
        .where(Story.id == story_id, *_shown_to(user, _now()))
        .with_for_update(of=Story)
    )
    if author_id is None:
        raise StoryNotFoundError
    if author_id != user.id:
        raise NotStoryAuthorError
    media_id = db.scalar(
        delete(Story).where(Story.id == story_id).returning(Story.media_id)
    )
    db.commit()
    # Now that no row names it.
    image_store().delete([media_id])


def read_media(db: Session, story_id: uuid.UUID, viewer: User) -> tuple[uuid.UUID, bytes]:
    """FOR KEY SHARE while reading, so a deletion can't pull the file from under it."""
    media_id = db.scalar(
        select(Story.media_id)
        .join(Story.author)
        .where(Story.id == story_id, *_shown_to(viewer, _now()))
        .with_for_update(read=True, key_share=True, of=Story)
    )
    data = image_store().read(media_id) if media_id is not None else None
    db.commit()
    if data is None:
        raise StoryNotFoundError
    return media_id, data


def _referred_to(db: Session, viewer: User, story_id: uuid.UUID) -> uuid.UUID:
    """FOR KEY SHARE until the view is written: a deletion gives not found."""
    author_id = db.scalar(
        select(Story.author_id)
        .join(Story.author)
        .where(Story.id == story_id, *_shown_to(viewer, _now()))
        .with_for_update(read=True, key_share=True, of=Story)
    )
    if author_id is None:
        raise StoryNotFoundError
    return author_id


def record_view(db: Session, viewer: User, story_id: uuid.UUID) -> bool:
    """Idempotent; an author's own look isn't a view, and returns False."""
    # Own account first, then the story: the order an account's removal takes them.
    hold_account(db, viewer)
    author_id = _referred_to(db, viewer, story_id)

    if author_id != viewer.id:
        # The primary key rules out a second row, so racing inserts can't both land.
        db.execute(
            insert(StoryView)
            .values(story_id=story_id, viewer_id=viewer.id)
            .on_conflict_do_nothing()
        )

    # Read after the change, in its transaction.
    viewed = db.scalar(
        select(
            exists().where(
                StoryView.story_id == story_id, StoryView.viewer_id == viewer.id
            )
        )
    )
    db.commit()
    return viewed
