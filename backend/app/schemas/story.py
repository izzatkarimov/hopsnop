"""Fields are listed in full, so a new model column is never exposed by accident."""

import uuid
from datetime import datetime
from typing import Annotated

from pydantic import (
    AfterValidator,
    BaseModel,
    ConfigDict,
    Field,
    StringConstraints,
)

# Matches the stories.caption column.
CAPTION_MAX_LENGTH = 150


def _reject_nul(value: str) -> str:
    # PostgreSQL can't store this character in text.
    if "\x00" in value:
        raise ValueError("Must not contain null characters.")
    return value


def _empty_to_none(value: str | None) -> str | None:
    return value or None


# Too long is rejected, never cut.
Caption = Annotated[
    Annotated[
        str,
        StringConstraints(strip_whitespace=True, max_length=CAPTION_MAX_LENGTH),
        AfterValidator(_reject_nul),
    ]
    | None,
    AfterValidator(_empty_to_none),
]


# A publish request is a multipart form, declared in ``app.api.stories``.


class StoryAuthorResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    username: str
    display_name: str
    avatar_url: str | None


class StoryResponse(BaseModel):
    """An expired or deleted story is not returned at all."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    author: StoryAuthorResponse
    media_url: str
    media_width: int
    media_height: int
    media_type: str
    caption: str | None
    created_at: datetime
    expires_at: datetime
    # Always false for its author, whose own views aren't counted.
    viewed_by_me: bool
    # Author only; null for everyone else. Who viewed it is told to nobody.
    view_count: int | None


class StoryViewResponse(BaseModel):
    viewed: bool


class StoryPageResponse(BaseModel):
    """Newest first."""

    items: list[StoryResponse]
    next_cursor: str | None = Field(
        description=(
            "Pass as `cursor` to get the next page. null when there are no "
            "more stories."
        ),
    )
