from fastapi import APIRouter, Depends

from app.api.deps import DbSession, OptionalUser, Pagination, VerifiedUser, no_store
from app.schemas.post import PostPageResponse, PostResponse
from app.services import posts as posts_service

# A post can vanish at any moment; no copy of an answer may outlive that.
router = APIRouter(prefix="/feed", tags=["feed"], dependencies=[Depends(no_store)])


@router.get("", response_model=PostPageResponse)
def get_for_you_feed(
    viewer: OptionalUser,
    page: Pagination,
    db: DbSession,
) -> PostPageResponse:
    """Every shown post, newest first, replies included. No authentication is needed."""
    posts = posts_service.list_for_you_feed(
        db,
        viewer,
        limit=page.limit,
        after=page.after,
    )
    return PostPageResponse(
        items=[PostResponse.model_validate(post) for post in posts.items],
        next_cursor=posts.next_cursor,
    )


@router.get("/following", response_model=PostPageResponse)
def get_following_feed(
    viewer: VerifiedUser,
    page: Pagination,
    db: DbSession,
) -> PostPageResponse:
    """Posts of users the caller follows, newest first, replies included."""
    posts = posts_service.list_following_feed(
        db,
        viewer,
        limit=page.limit,
        after=page.after,
    )
    return PostPageResponse(
        items=[PostResponse.model_validate(post) for post in posts.items],
        next_cursor=posts.next_cursor,
    )
