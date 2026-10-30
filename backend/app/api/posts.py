import uuid

from fastapi import APIRouter, Depends, status

from app.api.deps import DbSession, OptionalUser, Pagination, VerifiedUser, no_store
from app.schemas.post import (
    CreatePostRequest,
    LikeResponse,
    PostPageResponse,
    PostResponse,
    RepostResponse,
    UpdatePostRequest,
)
from app.services import posts as posts_service

# Answers depend on the caller and can change at any moment; nothing may keep them.
router = APIRouter(prefix="/posts", tags=["posts"], dependencies=[Depends(no_store)])


@router.post("", response_model=PostResponse, status_code=status.HTTP_201_CREATED)
def create_post(
    data: CreatePostRequest,
    user: VerifiedUser,
    db: DbSession,
) -> PostResponse:
    """A reply if `parent_post_id` is given; the author is always the signed-in user."""
    post = posts_service.create_post(
        db,
        user,
        content=data.content,
        parent_post_id=data.parent_post_id,
    )
    return PostResponse.model_validate(post)


@router.get("/{post_id}", response_model=PostResponse)
def get_post(post_id: uuid.UUID, viewer: OptionalUser, db: DbSession) -> PostResponse:
    """No authentication needed; 404 if deleted or its author's account isn't shown."""
    return PostResponse.model_validate(posts_service.get_post(db, post_id, viewer))


@router.get("/{post_id}/replies", response_model=PostPageResponse)
def list_replies(
    post_id: uuid.UUID,
    viewer: OptionalUser,
    page: Pagination,
    db: DbSession,
) -> PostPageResponse:
    """Direct replies, newest first. No authentication; 404 if the post isn't shown."""
    posts = posts_service.list_replies(
        db,
        post_id,
        viewer,
        limit=page.limit,
        after=page.after,
    )
    return PostPageResponse(
        items=[PostResponse.model_validate(post) for post in posts.items],
        next_cursor=posts.next_cursor,
    )


@router.patch("/{post_id}", response_model=PostResponse)
def update_post(
    post_id: uuid.UUID,
    data: UpdatePostRequest,
    user: VerifiedUser,
    db: DbSession,
) -> PostResponse:
    """Possible for 60 minutes after the post was created."""
    post = posts_service.update_post(db, user, post_id, content=data.content)
    return PostResponse.model_validate(post)


@router.delete("/{post_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_post(post_id: uuid.UUID, user: VerifiedUser, db: DbSession) -> None:
    """Only the caller's own post."""
    posts_service.delete_post(db, user, post_id)


@router.post("/{post_id}/like", response_model=LikeResponse)
def like_post(post_id: uuid.UUID, user: VerifiedUser, db: DbSession) -> LikeResponse:
    """Only for a post the caller can see; any other is not found."""
    state = posts_service.set_like(db, user, post_id, liked=True)
    return LikeResponse(liked=state.active, like_count=state.count)


@router.delete("/{post_id}/like", response_model=LikeResponse)
def unlike_post(post_id: uuid.UUID, user: VerifiedUser, db: DbSession) -> LikeResponse:
    """Only for a post the caller can see; any other is not found."""
    state = posts_service.set_like(db, user, post_id, liked=False)
    return LikeResponse(liked=state.active, like_count=state.count)


@router.post("/{post_id}/repost", response_model=RepostResponse)
def repost_post(
    post_id: uuid.UUID, user: VerifiedUser, db: DbSession
) -> RepostResponse:
    """Only for a post the caller can see; any other is not found."""
    state = posts_service.set_repost(db, user, post_id, reposted=True)
    return RepostResponse(reposted=state.active, repost_count=state.count)


@router.delete("/{post_id}/repost", response_model=RepostResponse)
def unrepost_post(
    post_id: uuid.UUID, user: VerifiedUser, db: DbSession
) -> RepostResponse:
    """Only for a post the caller can see; any other is not found."""
    state = posts_service.set_repost(db, user, post_id, reposted=False)
    return RepostResponse(reposted=state.active, repost_count=state.count)
