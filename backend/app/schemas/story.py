"""Request and response bodies of the stories API.

A request names only what a client may decide: the picture, uploaded, and
what the caption says. Who the author is, what kind of media it is, and when the
story was created and expires are the server's to determine, so the request
schema has no field for them, and anything else in a body is ignored, like
everywhere else in the API.

A response lists its fields in full, and so does the author inside it, so a
column added to the ``Story`` or ``User`` model is never exposed until someone
adds it here deliberately.
"""

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

# The same limit as the stories.caption column.
CAPTION_MAX_LENGTH = 150


def _reject_nul(value: str) -> str:
    # PostgreSQL cannot store this character in text.
    if "\x00" in value:
        raise ValueError("Must not contain null characters.")
    return value


def _empty_to_none(value: str | None) -> str | None:
    return value or None


# Plain text. A caption that is empty once trimmed is no caption at all. One
# that is too long is rejected; it is never cut to fit.
Caption = Annotated[
    Annotated[
        str,
        StringConstraints(strip_whitespace=True, max_length=CAPTION_MAX_LENGTH),
        AfterValidator(_reject_nul),
    ]
    | None,
    AfterValidator(_empty_to_none),
]


# A request to publish a story is a form (multipart/form-data), with the
# picture as a file and the caption as a field. Their declarations are in
# ``app.api.stories``; the caption is the ``Caption`` above.


# --- responses -----------------------------------------------------------


class StoryAuthorResponse(BaseModel):
    """What a story shows of its author: enough to render it and to link to
    the profile, which is addressed by the username."""

    model_config = ConfigDict(from_attributes=True)

    username: str
    display_name: str
    avatar_url: str | None


class StoryResponse(BaseModel):
    """An active story as shown to someone who may see it.

    A story that has expired or was deleted is not returned at all.
    """

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    author: StoryAuthorResponse
    # Where the API serves the picture: a path on the API, served to whoever
    # may see the story. Its size in pixels is given so that a client can
    # make room for it before it has loaded.
    media_url: str
    media_width: int
    media_height: int
    media_type: str
    caption: str | None
    created_at: datetime
    # From this moment on the story is no longer returned.
    expires_at: datetime
    # Whether the caller has recorded a view of the story. Always false for
    # its author, whose own views are not counted.
    viewed_by_me: bool
    # How many other users have viewed the story. Only its author is told;
    # for everyone else it is null. Who viewed it is told to nobody.
    view_count: int | None


class StoryViewResponse(BaseModel):
    """Where a story stands with the caller's view after a request."""

    viewed: bool


class StoryPageResponse(BaseModel):
    """One page of a list of stories, newest first."""

    items: list[StoryResponse]
    next_cursor: str | None = Field(
        description=(
            "Pass as `cursor` to get the next page. null when there are no "
            "more stories."
        ),
    )
