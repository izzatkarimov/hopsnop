"""User profile endpoints.

Like the authentication handlers these are thin: validation is in
``app.schemas.user`` and the rules and queries are in ``app.services.users``.

The list of a user's posts is here as well, because of its path. Its rules
are in ``app.services.posts`` with those of the other post endpoints.

Following a user, and the lists of who follows whom, are here too; their
rules are in ``app.services.users``.

So is the export of the signed-in user's data, which is made by
``app.services.export``, and the signed-in user's picture.
"""

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
    # Field by field, so the response holds exactly what is listed here.
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
    """The signed-in user's own profile, including the fields only they may see."""
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
    """Changes the signed-in user's own profile and returns the result.

    Only the fields that are sent are changed. The profile that is updated is
    always the caller's; there is no way to name another user.
    """
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
    """Makes the uploaded picture the signed-in user's own, in place of the
    one before, and returns the profile.

    Sent as a form (multipart/form-data). The picture is decoded and drawn
    again by the server as a 400 by 400 square cut from its middle, and
    nothing of the uploaded file but its pixels is kept: no location, no
    camera, no other metadata. The previous picture is removed.
    """
    upload = read_picture_upload(db, user, image)
    return _my_profile_response(users_service.set_avatar(db, user, upload))


@router.delete(
    "/me/avatar",
    response_model=MyProfileResponse,
    dependencies=[Depends(no_store)],
)
def remove_my_avatar(user: CurrentUser, db: DbSession) -> MyProfileResponse:
    """Removes the signed-in user's picture, and returns the profile.

    Removing a picture that is not there changes nothing and is not an error.
    """
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
    """Everything Hopsnop holds that is the signed-in user's own, as one ZIP
    archive to download: a JSON document (`export.json`) and the user's
    pictures, which the document names by their place in the archive.

    The password has to be given again: a session alone does not hand out
    all of an account's data. Whose data it is, is always the signed-in
    user's; there is no way to name another.

    The document holds no password, no token and no id of a session, and of
    other people only what the user could already see: the usernames of
    accounts they follow or are followed by, and the ids of posts and
    stories they answered, liked, reposted or viewed.

    It is not a snapshot of one moment. Its parts are read one after the
    other, and each shows the user's data as it was when that part was
    read. What the user does while the export is being made can be in one
    part and not in another.
    """
    # Two counters, and a place is taken in both or in neither: the wrong
    # passwords of the account, whatever asked for the password, and its
    # exports. Which place is kept depends on how the request turns out.
    limits = [*password_confirmation_limits(current), data_export_limit(current)]
    *confirmed, exported = rate_limit.count_all(db, limits)
    try:
        export = export_service.export_account(
            db, current, password=data.password.get_secret_value()
        )
    except auth_service.AccountNoLongerExistsError:
        # The account was removed while this was under way, and its counters
        # with it. What was counted here since is not left behind for an
        # account that is not there.
        rate_limit.forget(db, limits)
        raise
    except auth_service.AuthError:
        # No export came of it, so none is counted. What it was refused
        # for stays counted as that.
        rate_limit.uncount_all(db, [exported])
        raise
    # The password was right, so this was not a guess.
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


# Declared after /users/me, which therefore always takes precedence. No
# account is hidden by that: usernames are at least three characters long.
@router.get(
    "/{username}",
    response_model=PublicProfileResponse,
    # `following` depends on who is asking.
    dependencies=[Depends(no_store)],
)
def get_profile(
    username: str, viewer: OptionalUser, db: DbSession
) -> PublicProfileResponse:
    """A user's public profile. No authentication is needed.

    `following` says whether the caller follows the user. It is false for an
    anonymous request.
    """
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
    """A user's current picture. No authentication is needed: it is part of
    the public profile, and found under the same rules.

    The address names the picture, so it is not reused: once the picture is
    replaced or removed, the address answers `404`. A browser may keep its
    copy for a day (`private`: no shared cache may).
    """
    data = users_service.read_avatar(db, _canonical(username), avatar_id)
    return picture_response(
        request, data, etag_of=avatar_id, cache_control="private, max-age=86400"
    )


@router.get(
    "/{username}/posts",
    response_model=PostPageResponse,
    # The answer depends on who is asking, and a post in it can be deleted at
    # any moment.
    dependencies=[Depends(no_store)],
)
def list_user_posts(
    username: str,
    viewer: OptionalUser,
    page: Pagination,
    db: DbSession,
) -> PostPageResponse:
    """A user's posts, newest first, replies included.

    No authentication is needed.
    """
    canonical = canonical_username(username)
    if canonical is None:
        # No account can have this name; the same answer as for one that
        # does not exist.
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


# --- following -----------------------------------------------------------
#
# Who follows whom can change at any moment, and part of it depends on who is
# asking. No copy of an answer should outlive that.


def _canonical(username: str) -> str:
    canonical = canonical_username(username)
    if canonical is None:
        # No account can have this name; the same answer as for one that
        # does not exist.
        raise users_service.UserNotFoundError
    return canonical


@router.post(
    "/{username}/follow",
    response_model=FollowResponse,
    dependencies=[Depends(no_store)],
)
def follow_user(username: str, user: VerifiedUser, db: DbSession) -> FollowResponse:
    """Makes the caller follow the user. Following takes effect at once.

    Who follows is always the signed-in user; there is no way to name
    another. Following a user who is already followed changes nothing and is
    not an error.
    """
    following = users_service.set_follow(db, user, _canonical(username), following=True)
    return FollowResponse(following=following)


@router.delete(
    "/{username}/follow",
    response_model=FollowResponse,
    dependencies=[Depends(no_store)],
)
def unfollow_user(username: str, user: VerifiedUser, db: DbSession) -> FollowResponse:
    """Makes the caller no longer follow the user.

    Unfollowing a user who is not followed changes nothing and is not an
    error.
    """
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
    """Whether the caller follows the user. No authentication is needed.

    An anonymous caller follows nobody, so the answer is then always false.
    """
    following = users_service.get_follow_status(db, viewer, _canonical(username))
    return FollowResponse(following=following)


@router.get(
    "/{username}/followers",
    response_model=UserPageResponse,
    dependencies=[Depends(no_store)],
)
def list_followers(username: str, page: Pagination, db: DbSession) -> UserPageResponse:
    """The users who follow the user, the most recent follower first.

    No authentication is needed.
    """
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
    """The users the user follows, the most recently followed first.

    No authentication is needed.
    """
    users = users_service.list_following(
        db, _canonical(username), limit=page.limit, after=page.after
    )
    return UserPageResponse(
        items=[UserSummaryResponse.model_validate(user) for user in users.items],
        next_cursor=users.next_cursor,
    )
