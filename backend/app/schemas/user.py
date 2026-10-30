"""Public and owner views are separate schemas, listed in full, so no column leaks."""

import uuid
from datetime import datetime
from typing import Annotated, Self

from pydantic import (
    AfterValidator,
    BaseModel,
    ConfigDict,
    Field,
    StringConstraints,
    TypeAdapter,
    ValidationError,
    field_validator,
    model_validator,
)

from app.schemas.auth import DisplayName, Username

_USERNAME = TypeAdapter(Username)


def canonical_username(value: str) -> str | None:
    """Same rules as registration, so a lookup agrees with the stored value."""
    try:
        return _USERNAME.validate_python(value)
    except ValidationError:
        return None


def _reject_nul(value: str) -> str:
    # PostgreSQL can't store this character in text.
    if "\x00" in value:
        raise ValueError("Must not contain null characters.")
    return value


def _empty_to_none(value: str | None) -> str | None:
    return value or None


ProfileDisplayName = DisplayName
Bio = Annotated[
    Annotated[
        str,
        StringConstraints(strip_whitespace=True, max_length=160),
        AfterValidator(_reject_nul),
    ]
    | None,
    AfterValidator(_empty_to_none),
]


class UpdateProfileRequest(BaseModel):
    """Only sent fields change; ``null`` clears ``bio``; other fields are ignored."""

    display_name: ProfileDisplayName | None = Field(
        default=None,
        description="1 to 50 characters. Cannot be null.",
    )
    bio: Bio = Field(
        default=None,
        description="Up to 160 characters of plain text. null or blank clears it.",
    )

    @field_validator("display_name")
    @classmethod
    def _not_null(cls, value: object) -> object:
        # NOT NULL column: it can be changed but not cleared.
        if value is None:
            raise ValueError("This field cannot be null.")
        return value

    @model_validator(mode="after")
    def _has_changes(self) -> Self:
        if not self.model_fields_set:
            raise ValueError(
                "At least one of display_name or bio must be provided."
            )
        return self

    def changes(self) -> dict[str, str | None]:
        return self.model_dump(exclude_unset=True, mode="json")


class PublicProfileResponse(BaseModel):
    """Shown to anyone, signed in or not."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    username: str
    display_name: str
    bio: str | None
    avatar_url: str | None
    followers_count: int
    following_count: int
    # The caller's own follow only; false when anonymous.
    following: bool
    created_at: datetime


class FollowResponse(BaseModel):
    following: bool


class UserSummaryResponse(BaseModel):
    """Linked by username, so there is no id."""

    model_config = ConfigDict(from_attributes=True)

    username: str
    display_name: str
    avatar_url: str | None


class UserPageResponse(BaseModel):
    items: list[UserSummaryResponse]
    next_cursor: str | None = Field(
        description=(
            "Pass as `cursor` to get the next page. null when there are no "
            "more users."
        ),
    )


class MyProfileResponse(BaseModel):
    """Has private fields such as the email address: only for the account's owner."""

    id: uuid.UUID
    username: str
    email: str
    display_name: str
    bio: str | None
    avatar_url: str | None
    email_verified_at: datetime | None
    followers_count: int
    following_count: int
    created_at: datetime
