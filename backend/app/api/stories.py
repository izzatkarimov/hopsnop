import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, File, Form, Request, Response, UploadFile, status

from app.api.deps import (
    DbSession,
    Pagination,
    VerifiedUser,
    no_store,
    picture_response,
    read_picture_upload,
)
from app.schemas.story import (
    CAPTION_MAX_LENGTH,
    Caption,
    StoryPageResponse,
    StoryResponse,
    StoryViewResponse,
)
from app.services import stories as stories_service

# Answers depend on the caller and can change at any moment; nothing may keep them.
router = APIRouter(
    prefix="/stories", tags=["stories"], dependencies=[Depends(no_store)]
)


@router.post("", response_model=StoryResponse, status_code=status.HTTP_201_CREATED)
def create_story(
    image: Annotated[
        UploadFile,
        File(description="The picture: a JPEG, PNG or WebP file."),
    ],
    user: VerifiedUser,
    db: DbSession,
    caption: Annotated[
        Caption,
        Form(
            description=(
                f"Up to {CAPTION_MAX_LENGTH} characters of plain text. Blank "
                "or absent for a story without one."
            )
        ),
    ] = None,
) -> StoryResponse:
    """Multipart form; redrawn at most 1440 px, no metadata kept; shown for 24 hours."""
    upload = read_picture_upload(db, user, image)
    story = stories_service.create_story(db, user, upload=upload, caption=caption)
    return StoryResponse.model_validate(story)


@router.get("", response_model=StoryPageResponse)
def list_stories(
    viewer: VerifiedUser,
    page: Pagination,
    db: DbSession,
) -> StoryPageResponse:
    """Caller's and followed users' active stories, newest first; records no views."""
    stories = stories_service.list_stories(
        db,
        viewer,
        limit=page.limit,
        after=page.after,
    )
    return StoryPageResponse(
        items=[StoryResponse.model_validate(story) for story in stories.items],
        next_cursor=stories.next_cursor,
    )


@router.get("/{story_id}", response_model=StoryResponse)
def get_story(story_id: uuid.UUID, viewer: VerifiedUser, db: DbSession) -> StoryResponse:
    """The caller's own or a followed user's, else not found; records no view."""
    return StoryResponse.model_validate(
        stories_service.get_story(db, story_id, viewer)
    )


@router.get(
    "/{story_id}/media",
    response_class=Response,
    responses={200: {"content": {"image/webp": {}}, "description": "The picture."}},
)
def get_story_media(
    story_id: uuid.UUID, viewer: VerifiedUser, request: Request, db: DbSession
) -> Response:
    """Always a server-made WebP; who may see it is checked per request (`no-cache`)."""
    media_id, data = stories_service.read_media(db, story_id, viewer)
    return picture_response(
        request, data, etag_of=media_id, cache_control="private, no-cache"
    )


@router.delete("/{story_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_story(story_id: uuid.UUID, user: VerifiedUser, db: DbSession) -> None:
    """Only the caller's own; its views and picture go with it."""
    stories_service.delete_story(db, user, story_id)


@router.post("/{story_id}/view", response_model=StoryViewResponse)
def view_story(
    story_id: uuid.UUID, viewer: VerifiedUser, db: DbSession
) -> StoryViewResponse:
    """Repeatable, counted once per user; an author's look at their own isn't a view."""
    viewed = stories_service.record_view(db, viewer, story_id)
    return StoryViewResponse(viewed=viewed)
