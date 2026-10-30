"""The export document; every field is listed, so no new column leaks by default."""

import uuid
from datetime import datetime, timezone
from typing import Annotated, Literal

from pydantic import BaseModel, Field, PlainSerializer, SecretStr, WithJsonSchema

from app.core.security import PASSWORD_MAX_LENGTH

EXPORT_VERSION = 2

# Relative to the folder the document is in.
AVATAR_FILE = "images/avatar.webp"


def story_media_file(story_id: uuid.UUID) -> str:
    return f"images/stories/{story_id}.webp"


def _in_utc(value: datetime) -> str:
    return (
        value.astimezone(timezone.utc)
        .isoformat(timespec="microseconds")
        .replace("+00:00", "Z")
    )


# RFC 3339 UTC to the microsecond, always 27 characters, so texts sort as moments do.
Timestamp = Annotated[
    datetime,
    PlainSerializer(_in_utc, return_type=str, when_used="json"),
    WithJsonSchema({"type": "string", "format": "date-time"}, mode="serialization"),
]


class ExportRequest(BaseModel):
    """Only the password: the session says whose data."""

    # Checked against the account, not the policy for choosing one.
    password: Annotated[SecretStr, Field(min_length=1, max_length=PASSWORD_MAX_LENGTH)]


class ExportedAccount(BaseModel):
    """The password isn't here in any form."""

    id: uuid.UUID
    username: str
    email: str
    display_name: str
    bio: str | None
    # Null for none, or if the file is missing from the store.
    avatar_file: str | None
    is_active: bool
    email_verified_at: Timestamp | None
    created_at: Timestamp
    updated_at: Timestamp


class ExportedSession(BaseModel):
    """No session id or token: with them a session could be addressed or used."""

    created_at: Timestamp
    last_used_at: Timestamp
    expires_at: Timestamp
    revoked_at: Timestamp | None
    is_current: bool


class ExportedLinkRequest(BaseModel):
    """The link itself is not kept anywhere."""

    requested_at: Timestamp
    expires_at: Timestamp
    used_at: Timestamp | None


class ExportedAccountRequests(BaseModel):
    email_verifications: list[ExportedLinkRequest]
    password_resets: list[ExportedLinkRequest]


class ExportedPost(BaseModel):
    """Only the id of the answered post: the rest of that post is its author's."""

    id: uuid.UUID
    content: str
    parent_post_id: uuid.UUID | None
    created_at: Timestamp
    updated_at: Timestamp


class ExportedInteraction(BaseModel):
    post_id: uuid.UUID
    created_at: Timestamp


class ExportedFollow(BaseModel):
    username: str
    created_at: Timestamp


class ExportedStory(BaseModel):
    id: uuid.UUID
    # Null if the file is missing from the store, like ``avatar_file``.
    media_file: str | None
    media_width: int
    media_height: int
    media_type: str
    caption: str | None
    created_at: Timestamp
    expires_at: Timestamp
    # Who viewed it is their data, and is told to nobody.
    view_count: int


class ExportedStoryView(BaseModel):
    story_id: uuid.UUID
    viewed_at: Timestamp


class AccountExport(BaseModel):
    """Every collection is always present, oldest entry first."""

    export_version: Literal[2]
    generated_at: Timestamp
    account: ExportedAccount
    sessions: list[ExportedSession]
    account_requests: ExportedAccountRequests
    posts: list[ExportedPost]
    likes: list[ExportedInteraction]
    reposts: list[ExportedInteraction]
    following: list[ExportedFollow]
    followers: list[ExportedFollow]
    stories: list[ExportedStory]
    story_views: list[ExportedStoryView]
