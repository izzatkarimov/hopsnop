import uuid
from typing import Annotated

from fastapi import (
    APIRouter,
    Depends,
    File,
    HTTPException,
    Request,
    Response,
    UploadFile,
    status,
)

from app.api.auth import data_export_limit, password_confirmation_limits
from app.api.deps import (
    CurrentSession,
    CurrentUser,
    DbSession,
    OptionalUser,
    Pagination,
    VerifiedUser,
    no_store,
    picture_response,
    read_picture_upload,
)
from app.schemas.export import ExportRequest
from app.schemas.post import PostPageResponse, PostResponse
from app.schemas.user import (
    FollowResponse,
    MyProfileResponse,
    PublicProfileResponse,
    UpdateProfileRequest,
    UserPageResponse,
    UserSummaryResponse,
    canonical_username,
)
from app.services import auth as auth_service
from app.services import export as export_service
from app.services import posts as posts_service
from app.services import rate_limit
from app.services import users as users_service
from app.services.users import OwnProfile

router = APIRouter(prefix="/users", tags=["users"])


def _my_profile_response(profile: OwnProfile) -> MyProfileResponse:
    # Field by field, so the response holds exactly what is listed.
    user = profile.user
    return MyProfileResponse(
        id=user.id,
        username=user.username,
        email=user.email,
        display_name=user.display_name,
        bio=user.bio,
        avatar_url=user.avatar_url,
        email_verified_at=user.email_verified_at,
        followers_count=profile.followers_count,
        following_count=profile.following_count,
        created_at=user.created_at,
    )


@router.get(
    "/me",
    response_model=MyProfileResponse,
    dependencies=[Depends(no_store)],
)
def get_my_profile(user: CurrentUser, db: DbSession) -> MyProfileResponse:
    return _my_profile_response(users_service.get_own_profile(db, user))


@router.patch(
    "/me",
    response_model=MyProfileResponse,
    dependencies=[Depends(no_store)],
)
def update_my_profile(
    data: UpdateProfileRequest,
    user: CurrentUser,
    db: DbSession,
) -> MyProfileResponse:
    """Only the fields that are sent are changed; always the caller's profile."""
    profile = users_service.update_profile(db, user, data.changes())
    return _my_profile_response(profile)


@router.put(
    "/me/avatar",
    response_model=MyProfileResponse,
    dependencies=[Depends(no_store)],
)
def set_my_avatar(
    image: Annotated[
        UploadFile,
        File(description="The picture: a JPEG, PNG or WebP file."),
    ],
    user: VerifiedUser,
    db: DbSession,
) -> MyProfileResponse:
    """Multipart form; redrawn as a 400x400 centre crop, no metadata kept."""
    upload = read_picture_upload(db, user, image)
    return _my_profile_response(users_service.set_avatar(db, user, upload))


@router.delete(
    "/me/avatar",
    response_model=MyProfileResponse,
    dependencies=[Depends(no_store)],
)
def remove_my_avatar(user: CurrentUser, db: DbSession) -> MyProfileResponse:
    """Removing a picture that is not there is not an error."""
    return _my_profile_response(users_service.remove_avatar(db, user))


@router.post(
    "/me/export",
    response_class=Response,
    responses={
        200: {
            "content": {"application/zip": {}},
            "description": "The archive: export.json and the pictures it names.",
        }
    },
)
def export_my_data(
    data: ExportRequest,
    current: CurrentSession,
    db: DbSession,
) -> Response:
    """ZIP of data and pictures; needs the password; not a snapshot of one moment."""
    # A place in both counters or neither: the wrong-password one and the exports one.
    limits = [*password_confirmation_limits(current), data_export_limit(current)]
    *confirmed, exported = rate_limit.count_all(db, limits)
    try:
        export = export_service.export_account(
            db, current, password=data.password.get_secret_value()
        )
    except auth_service.AccountNoLongerExistsError:
        # Account removed meanwhile, counters included; don't leave new counts behind.
        rate_limit.forget(db, limits)
        raise
    except auth_service.AuthError:
        # No export came of it, so none is counted.
        rate_limit.uncount_all(db, [exported])
        raise
    # The password was right, so this wasn't a guess.
    rate_limit.uncount_all(db, confirmed)
    name = export_service.archive_name(export)
    return Response(
        content=export_service.archive(export),
        media_type="application/zip",
        headers={
            "Content-Disposition": f'attachment; filename="{name}.zip"',
            "Cache-Control": "no-store",
        },
    )


# After /users/me, which wins; usernames have 3+ characters, so none is hidden.
@router.get(
    "/{username}",
    response_model=PublicProfileResponse,
    # `following` depends on who is asking.
    dependencies=[Depends(no_store)],
)
def get_profile(
    username: str, viewer: OptionalUser, db: DbSession
) -> PublicProfileResponse:
    """No authentication is needed; `following` is false for an anonymous request."""
    canonical = canonical_username(username)
    profile = (
        users_service.get_public_profile(db, canonical, viewer) if canonical else None
    )
    if profile is None:
        # One answer for every reason an account is not shown.
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found.",
        )
    return PublicProfileResponse.model_validate(profile)


@router.get(
    "/{username}/avatar/{avatar_id}",
    response_class=Response,
    responses={200: {"content": {"image/webp": {}}, "description": "The picture."}},
)
def get_avatar(
    username: str, avatar_id: uuid.UUID, request: Request, db: DbSession
) -> Response:
    """No authentication; 404 once replaced or removed; browsers may cache for a day."""
    data = users_service.read_avatar(db, _canonical(username), avatar_id)
    return picture_response(
        request, data, etag_of=avatar_id, cache_control="private, max-age=86400"
    )


@router.get(
    "/{username}/posts",
    response_model=PostPageResponse,
    # Depends on the caller, and a post can be deleted at any moment.
    dependencies=[Depends(no_store)],
)
def list_user_posts(
    username: str,
    viewer: OptionalUser,
    page: Pagination,
    db: DbSession,
) -> PostPageResponse:
    """Newest first, replies included. No authentication is needed."""
    canonical = canonical_username(username)
    if canonical is None:
        # Same answer as for an account that doesn't exist.
        raise posts_service.UserNotFoundError
    posts = posts_service.list_user_posts(
        db,
        canonical,
        viewer,
        limit=page.limit,
        after=page.after,
    )
    return PostPageResponse(
        items=[PostResponse.model_validate(post) for post in posts.items],
        next_cursor=posts.next_cursor,
    )


def _canonical(username: str) -> str:
    canonical = canonical_username(username)
    if canonical is None:
        # Same answer as for an account that doesn't exist.
        raise users_service.UserNotFoundError
    return canonical


@router.post(
    "/{username}/follow",
    response_model=FollowResponse,
    dependencies=[Depends(no_store)],
)
def follow_user(username: str, user: VerifiedUser, db: DbSession) -> FollowResponse:
    """Takes effect at once; following a followed user is not an error."""
    following = users_service.set_follow(db, user, _canonical(username), following=True)
    return FollowResponse(following=following)


@router.delete(
    "/{username}/follow",
    response_model=FollowResponse,
    dependencies=[Depends(no_store)],
)
def unfollow_user(username: str, user: VerifiedUser, db: DbSession) -> FollowResponse:
    """Unfollowing a user who is not followed is not an error."""
    following = users_service.set_follow(
        db, user, _canonical(username), following=False
    )
    return FollowResponse(following=following)


@router.get(
    "/{username}/follow-status",
    response_model=FollowResponse,
    dependencies=[Depends(no_store)],
)
def get_follow_status(
    username: str, viewer: OptionalUser, db: DbSession
) -> FollowResponse:
    """No authentication is needed; always false for an anonymous caller."""
    following = users_service.get_follow_status(db, viewer, _canonical(username))
    return FollowResponse(following=following)


@router.get(
    "/{username}/followers",
    response_model=UserPageResponse,
    dependencies=[Depends(no_store)],
)
def list_followers(username: str, page: Pagination, db: DbSession) -> UserPageResponse:
    """Most recent follower first. No authentication is needed."""
    users = users_service.list_followers(
        db, _canonical(username), limit=page.limit, after=page.after
    )
    return UserPageResponse(
        items=[UserSummaryResponse.model_validate(user) for user in users.items],
        next_cursor=users.next_cursor,
    )


@router.get(
    "/{username}/following",
    response_model=UserPageResponse,
    dependencies=[Depends(no_store)],
)
def list_following(username: str, page: Pagination, db: DbSession) -> UserPageResponse:
    """Most recently followed first. No authentication is needed."""
    users = users_service.list_following(
        db, _canonical(username), limit=page.limit, after=page.after
    )
    return UserPageResponse(
        items=[UserSummaryResponse.model_validate(user) for user in users.items],
        next_cursor=users.next_cursor,
    )
