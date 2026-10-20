"""The export of an account's data.

``export_account`` gathers what Hopsnop holds that is the account's own into
one document (``app.schemas.export.AccountExport``) and the account's
pictures, for the account's user, who has to give the password again to get
them. ``archive`` puts both into one ZIP file to download.

What is in it
-------------

Each part of the document is read by one function below, with one statement
that names the columns it reads. No row is read whole and no object is handed
on as it is: a value gets into the document by being named twice, in a query
here and in a field of the schema.

- What the account is and what it wrote: its profile and its picture, its
  posts and replies, its stories and their pictures. The pictures are the
  files the server stores, as it serves them.
- What it did: its likes and reposts, whom it follows, which stories it
  viewed.
- What was done about it, as far as that is about the account and not about
  somebody else: who follows it, and how often each of its stories was
  viewed.
- Its logins and the links emailed for it, by their times.

What is not in it
-----------------

- Anything that proves who someone is. The password hash, the hashes of
  session tokens and of emailed links, and the ids of sessions: none of
  these is read by any statement here.
- Other people's data. Of a post the account answered or liked there is its
  id; of an account it follows or is followed by, the username, and only if
  that account is one that is shown to anyone. Who viewed its stories is not
  told, only how many did.
- What was erased. A post that was deleted has no author any more, so it is
  nobody's, and it is in nobody's export. Nothing is put back together from
  what is left of it.
- The counters of the rate limiter, which are kept under keyed hashes and
  belong to no account.

What it is a picture of
-----------------------

The document is not a snapshot of one moment. It is read one part after the
other, each by a statement of its own, and each sees what was committed when
it ran. Something the user does while the export is being made can therefore
be in a later part and missing from an earlier one. Every part by itself is
whole and in order.

What does stand still is the account. Its row is locked from the moment the
password is confirmed until the document is complete, in the way a password
change locks it: the account cannot be removed and its password cannot be
replaced while its data is being read out. An export is either made in full
for an account that is there, with the password it has, or not at all.

The pictures stand still with what names them. The account's picture can
only be replaced under the same lock, so it waits. The stories are held as
they are read (FOR KEY SHARE), so one that is deleted meanwhile waits until
the export has its picture, and the purge passes it over. Every picture the
document names is therefore in the archive.
"""

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
    """An export: the document, and the pictures it names, by their place."""

    document: AccountExport
    pictures: dict[str, bytes] = field(default_factory=dict)


def export_account(db: Session, current: UserSession, *, password: str) -> Export:
    """The data of the session's account, whose user must know the password.

    The account is locked while it is read, and its stories while their
    pictures are (see the module's notes). Nothing is changed; committing at
    the end is what lets them go again.
    """
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


# The time every entry of the archive is given. The archive says nothing of
# when its files were written, and the same data always makes the same
# archive, apart from ``generated_at`` in the document.
_ENTRY_TIME = (1980, 1, 1, 0, 0, 0)


def archive_name(export: Export) -> str:
    """The name of the archive, and of the folder inside it: whose it is
    and the day (in UTC) it was put together."""
    day = export.document.generated_at.strftime("%Y-%m-%d")
    return f"hopsnop-export-{export.document.account.username}-{day}"


def archive(export: Export) -> bytes:
    """The export as one ZIP file.

    One folder, named like the file, with the document (``export.json``)
    and the pictures it names, in the order the document names them. The
    document is compressed; the pictures are WebP files already and are
    stored as they are.
    """
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


# --- the parts -----------------------------------------------------------
#
# One statement each, however much there is to read, and each in the order
# its entries came about. Where two entries came about at the same moment,
# a key of the row decides, so the order is always the same.


def _account(
    account: User, store: ImageStore, pictures: dict[str, bytes]
) -> ExportedAccount:
    # Field by field, from the row as it was locked. The password hash is in
    # that row and has no field to go into.
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
    """Every session of the account that is still stored, ended or not.

    Which of them is the current one is decided in the database. The id of
    a session is compared there and is never read.
    """
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
    """The emailed links of one kind that are still on record, by their times."""
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
    """The posts and replies the account wrote.

    A post that was erased has no author, and is not found by this.
    """
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
    """The likes, or the reposts, the account made."""
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
    """The accounts on the other side of the account's follows.

    ``of`` is the column of ``follows`` that holds the account, ``other``
    the one that holds the accounts that are listed. Only accounts that are
    shown are listed, as in the lists of followers that anyone can read: an
    account that was deactivated, or never verified, is not named here
    either.
    """
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
    """Put the picture's file into the archive under ``name``.

    Returns the name, or None if the file is not in the store.
    """
    data = store.read(image_id)
    if data is None:
        return None
    pictures[name] = data
    return name


def _stories(
    db: Session, user_id: uuid.UUID, store: ImageStore, pictures: dict[str, bytes]
) -> list[ExportedStory]:
    """The stories of the account that are still stored, expired or not, with
    their pictures.

    With each, how many views it has. The views are counted by the statement
    that reads the stories; who made them is not read. The stories are held
    (FOR KEY SHARE) until the export is committed, so none of them can be
    removed, and its picture with it, before that picture is read.
    """
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
    """The views the account made of other people's stories."""
    rows = db.execute(
        select(StoryView.story_id, StoryView.viewed_at)
        .where(StoryView.viewer_id == user_id)
        .order_by(StoryView.viewed_at, StoryView.story_id)
    )
    return [
        ExportedStoryView(story_id=row.story_id, viewed_at=row.viewed_at)
        for row in rows
    ]
