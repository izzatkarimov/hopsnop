"""Account export; a value gets in only if named by both a query and a schema field."""

import io
import uuid
import zipfile
from dataclasses import dataclass, field
from datetime import datetime, timezone

from sqlalchemy import func, select
from sqlalchemy.orm import InstrumentedAttribute, Session

from app.core.image_store import ImageStore, image_store

from app.models import (
    EmailVerificationToken,
    Follow,
    Like,
    PasswordResetToken,
    Post,
    Repost,
    Story,
    StoryView,
    User,
    UserSession,
)
from app.schemas.export import (
    AVATAR_FILE,
    EXPORT_VERSION,
    AccountExport,
    ExportedAccount,
    ExportedAccountRequests,
    ExportedFollow,
    ExportedInteraction,
    ExportedLinkRequest,
    ExportedPost,
    ExportedSession,
    ExportedStory,
    ExportedStoryView,
    story_media_file,
)
from app.services import auth as auth_service
from app.services.users import ACCOUNT_IS_SHOWN


def _now() -> datetime:
    return datetime.now(timezone.utc)


@dataclass
class Export:
    document: AccountExport
    pictures: dict[str, bytes] = field(default_factory=dict)


def export_account(db: Session, current: UserSession, *, password: str) -> Export:
    """Account locked while read, stories until their pictures are; commit releases."""
    account = auth_service.confirm_password(db, current, password=password)
    store = image_store()
    pictures: dict[str, bytes] = {}
    export = AccountExport(
        export_version=EXPORT_VERSION,
        generated_at=_now(),
        account=_account(account, store, pictures),
        sessions=_sessions(db, account.id, current.id),
        account_requests=ExportedAccountRequests(
            email_verifications=_link_requests(
                db, EmailVerificationToken, account.id
            ),
            password_resets=_link_requests(db, PasswordResetToken, account.id),
        ),
        posts=_posts(db, account.id),
        likes=_interactions(db, Like, account.id),
        reposts=_interactions(db, Repost, account.id),
        following=_follows(
            db, account.id, of=Follow.follower_id, other=Follow.following_id
        ),
        followers=_follows(
            db, account.id, of=Follow.following_id, other=Follow.follower_id
        ),
        stories=_stories(db, account.id, store, pictures),
        story_views=_story_views(db, account.id),
    )
    db.commit()
    return Export(export, pictures)


# Fixed, so the same data makes the same archive, apart from ``generated_at``.
_ENTRY_TIME = (1980, 1, 1, 0, 0, 0)


def archive_name(export: Export) -> str:
    day = export.document.generated_at.strftime("%Y-%m-%d")
    return f"hopsnop-export-{export.document.account.username}-{day}"


def archive(export: Export) -> bytes:
    """The document is compressed; WebP pictures are stored as they are."""
    folder = archive_name(export)
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as zip_file:

        def add(name: str, data: bytes, compression: int) -> None:
            entry = zipfile.ZipInfo(f"{folder}/{name}", date_time=_ENTRY_TIME)
            entry.compress_type = compression
            # A plain file, readable and writable by whoever unpacks it.
            entry.external_attr = 0o644 << 16
            zip_file.writestr(entry, data)

        add(
            "export.json",
            export.document.model_dump_json(indent=2).encode("utf-8") + b"\n",
            zipfile.ZIP_DEFLATED,
        )
        for name, data in export.pictures.items():
            add(name, data, zipfile.ZIP_STORED)
    return buffer.getvalue()


# A row key breaks ties, so the order is always the same.


def _account(
    account: User, store: ImageStore, pictures: dict[str, bytes]
) -> ExportedAccount:
    # Field by field: the row holds the password hash, which has no field to go into.
    avatar_file = None
    if account.avatar_id is not None:
        avatar_file = _add_picture(store, pictures, AVATAR_FILE, account.avatar_id)
    return ExportedAccount(
        id=account.id,
        username=account.username,
        email=account.email,
        display_name=account.display_name,
        bio=account.bio,
        avatar_file=avatar_file,
        is_active=account.is_active,
        email_verified_at=account.email_verified_at,
        created_at=account.created_at,
        updated_at=account.updated_at,
    )


def _sessions(
    db: Session, user_id: uuid.UUID, current_id: uuid.UUID
) -> list[ExportedSession]:
    """The session id is compared in the database and never read."""
    rows = db.execute(
        select(
            UserSession.created_at,
            UserSession.last_used_at,
            UserSession.expires_at,
            UserSession.revoked_at,
            (UserSession.id == current_id).label("is_current"),
        )
        .where(UserSession.user_id == user_id)
        .order_by(UserSession.created_at, UserSession.id)
    )
    return [
        ExportedSession(
            created_at=row.created_at,
            last_used_at=row.last_used_at,
            expires_at=row.expires_at,
            revoked_at=row.revoked_at,
            is_current=row.is_current,
        )
        for row in rows
    ]


def _link_requests(
    db: Session,
    model: type[EmailVerificationToken] | type[PasswordResetToken],
    user_id: uuid.UUID,
) -> list[ExportedLinkRequest]:
    rows = db.execute(
        select(model.created_at, model.expires_at, model.used_at)
        .where(model.user_id == user_id)
        .order_by(model.created_at, model.id)
    )
    return [
        ExportedLinkRequest(
            requested_at=row.created_at,
            expires_at=row.expires_at,
            used_at=row.used_at,
        )
        for row in rows
    ]


def _posts(db: Session, user_id: uuid.UUID) -> list[ExportedPost]:
    """An erased post has no author, so this doesn't find it."""
    rows = db.execute(
        select(
            Post.id,
            Post.content,
            Post.parent_post_id,
            Post.created_at,
            Post.updated_at,
        )
        .where(Post.author_id == user_id, Post.deleted_at.is_(None))
        .order_by(Post.created_at, Post.id)
    )
    return [
        ExportedPost(
            id=row.id,
            content=row.content,
            parent_post_id=row.parent_post_id,
            created_at=row.created_at,
            updated_at=row.updated_at,
        )
        for row in rows
    ]


def _interactions(
    db: Session, model: type[Like] | type[Repost], user_id: uuid.UUID
) -> list[ExportedInteraction]:
    rows = db.execute(
        select(model.post_id, model.created_at)
        .where(model.user_id == user_id)
        .order_by(model.created_at, model.post_id)
    )
    return [
        ExportedInteraction(post_id=row.post_id, created_at=row.created_at)
        for row in rows
    ]


def _follows(
    db: Session,
    user_id: uuid.UUID,
    *,
    of: InstrumentedAttribute[uuid.UUID],
    other: InstrumentedAttribute[uuid.UUID],
) -> list[ExportedFollow]:
    """Only accounts that are shown are listed, as in the public follower lists."""
    rows = db.execute(
        select(User.username, Follow.created_at)
        .join(User, User.id == other)
        .where(of == user_id, *ACCOUNT_IS_SHOWN)
        .order_by(Follow.created_at, other)
    )
    return [
        ExportedFollow(username=row.username, created_at=row.created_at)
        for row in rows
    ]


def _add_picture(
    store: ImageStore, pictures: dict[str, bytes], name: str, image_id: uuid.UUID
) -> str | None:
    """Returns the name, or None if the file isn't in the store."""
    data = store.read(image_id)
    if data is None:
        return None
    pictures[name] = data
    return name


def _stories(
    db: Session, user_id: uuid.UUID, store: ImageStore, pictures: dict[str, bytes]
) -> list[ExportedStory]:
    """Held FOR KEY SHARE until commit, so a story's picture stays until it's read."""
    view_count = (
        select(func.count())
        .select_from(StoryView)
        .where(StoryView.story_id == Story.id)
        .scalar_subquery()
    )
    rows = db.execute(
        select(
            Story.id,
            Story.media_id,
            Story.media_width,
            Story.media_height,
            Story.media_type,
            Story.caption,
            Story.created_at,
            Story.expires_at,
            view_count.label("view_count"),
        )
        .where(Story.author_id == user_id)
        .order_by(Story.created_at, Story.id)
        .with_for_update(read=True, key_share=True, of=Story)
    )
    return [
        ExportedStory(
            id=row.id,
            media_file=_add_picture(
                store, pictures, story_media_file(row.id), row.media_id
            ),
            media_width=row.media_width,
            media_height=row.media_height,
            media_type=row.media_type,
            caption=row.caption,
            created_at=row.created_at,
            expires_at=row.expires_at,
            view_count=row.view_count,
        )
        for row in rows
    ]


def _story_views(db: Session, user_id: uuid.UUID) -> list[ExportedStoryView]:
    rows = db.execute(
        select(StoryView.story_id, StoryView.viewed_at)
        .where(StoryView.viewer_id == user_id)
        .order_by(StoryView.viewed_at, StoryView.story_id)
    )
    return [
        ExportedStoryView(story_id=row.story_id, viewed_at=row.viewed_at)
        for row in rows
    ]
