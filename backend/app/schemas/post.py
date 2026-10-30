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
    computed_field,
)

# Matches the posts.content check; both count code points, so they agree on every text.
POST_MAX_LENGTH = 300


def _reject_nul(value: str) -> str:
    # PostgreSQL can't store this character in text.
    if "\x00" in value:
        raise ValueError("Must not contain null characters.")
    return value


# Whitespace-only text is empty; too long is rejected, never cut.
PostContent = Annotated[
    str,
    StringConstraints(strip_whitespace=True, min_length=1, max_length=POST_MAX_LENGTH),
    AfterValidator(_reject_nul),
]


class CreatePostRequest(BaseModel):
    content: PostContent = Field(
        description=f"1 to {POST_MAX_LENGTH} characters of plain text.",
    )
    parent_post_id: uuid.UUID | None = Field(
        default=None,
        description="The post this one replies to. null or absent for a new post.",
    )


class UpdatePostRequest(BaseModel):
    """The text is all that can change."""

    content: PostContent = Field(
        description=f"1 to {POST_MAX_LENGTH} characters of plain text.",
    )


class PostAuthorResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    username: str
    display_name: str
    avatar_url: str | None


class PostResponse(BaseModel):
    """No deletion field: a deleted post is not returned at all."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    author: PostAuthorResponse
    content: str
    parent_post_id: uuid.UUID | None
    created_at: datetime
    updated_at: datetime
    # Of those users, the caller only learns about themselves.
    like_count: int
    liked_by_me: bool
    repost_count: int
    reposted_by_me: bool

    @computed_field
    @property
    def is_reply(self) -> bool:
        return self.parent_post_id is not None


class LikeResponse(BaseModel):
    liked: bool
    like_count: int


class RepostResponse(BaseModel):
    reposted: bool
    repost_count: int


class PostPageResponse(BaseModel):
    """Newest first."""

    items: list[PostResponse]
    next_cursor: str | None = Field(
        description=(
            "Pass as `cursor` to get the next page. null when there are no "
            "more posts."
        ),
    )
