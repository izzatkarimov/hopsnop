"""Dependencies shared by the API routers."""

from collections.abc import Iterator
from dataclasses import dataclass
from typing import Annotated
from urllib.parse import urlsplit

from fastapi import Depends, HTTPException, Query, Request, Response, UploadFile, status
from sqlalchemy.orm import Session
from sqlalchemy.orm.exc import ObjectDeletedError, StaleDataError

from app.core.config import settings
from app.core.pagination import (
    DEFAULT_PAGE_SIZE,
    MAX_PAGE_SIZE,
    Cursor,
    InvalidCursorError,
    decode_cursor,
)
from app.db.session import SessionLocal
from app.models import User, UserSession
from app.services import auth as auth_service
from app.services import images, rate_limit

_SAFE_METHODS = frozenset({"GET", "HEAD", "OPTIONS", "TRACE"})


def get_db() -> Iterator[Session]:
    # Closing the session rolls back anything that was not committed.
    with SessionLocal() as db:
        yield db


DbSession = Annotated[Session, Depends(get_db)]


def no_store(response: Response) -> None:
    """For responses that carry private account data.

    Neither a browser nor an intermediary should keep a copy of them.
    """
    response.headers["Cache-Control"] = "no-store"


def verify_request_origin(request: Request) -> None:
    """CSRF defence: reject state-changing requests sent by another website.

    The session cookie is attached by the browser automatically, so a request
    is not proven to be intended by the user just because it carries one.
    Browsers state where a request comes from in the Origin header (older
    ones in Referer), and a page cannot forge either. A request that changes
    state is accepted only if that origin is the configured frontend or this
    API itself.

    A request with neither header does not come from a browser acting for
    another site, which is the only way CSRF can happen, so it is let
    through. Safe methods never change state and are not checked.

    Applied to the whole application in ``app.main``, so it also covers every
    route added later.
    """
    if request.method in _SAFE_METHODS:
        return

    source = request.headers.get("origin")
    if source is None:
        referer = request.headers.get("referer")
        if referer is None:
            return
        parts = urlsplit(referer)
        source = f"{parts.scheme}://{parts.netloc}"

    own_origin = f"{request.url.scheme}://{request.url.netloc}"
    # Anything else is refused, including the opaque origin "null" that
    # browsers send from sandboxed documents.
    if source.lower() not in (settings.frontend_origin, own_origin.lower()):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Cross-origin request rejected.",
        )


def client_address(request: Request) -> str:
    """The address a request comes from, as the server sees it.

    Used only to count requests, and only in hashed form (see
    ``app.services.rate_limit``). It is the peer of the connection. Behind a
    reverse proxy that is the proxy, unless the server is started so that it
    takes the address from the proxy's headers (uvicorn's
    ``--proxy-headers`` and ``--forwarded-allow-ips``). A header that any
    client can set is deliberately not read here.
    """
    return request.client.host if request.client else "unknown"


ClientAddress = Annotated[str, Depends(client_address)]


def limit_per_address(scope: str, setting: str):
    """Dependency: count this request against a per-address limit.

    ``setting`` names the setting that holds the limit. It is read on every
    request, so the limit is whatever is configured at that moment. Every
    request is counted, whatever its outcome, and before anything else about
    it is looked at.
    """

    def count_request(address: ClientAddress, db: DbSession) -> None:
        rate_limit.count(
            db,
            rate_limit.Limit(scope, address, getattr(settings, setting)),
        )

    return Depends(count_request)


def _session_from_cookie(request: Request, db: Session) -> UserSession | None:
    raw_token = request.cookies.get(settings.session_cookie)
    return auth_service.authenticate_session(db, raw_token) if raw_token else None


def get_current_session(request: Request, db: DbSession) -> UserSession:
    """The session the request's cookie belongs to.

    Every way of not having a usable session gives the same 401: no cookie,
    unknown token, revoked, expired, or deactivated user.
    """
    session = _session_from_cookie(request, db)
    if session is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated.",
        )
    return session


CurrentSession = Annotated[UserSession, Depends(get_current_session)]


def get_current_user(session: CurrentSession) -> User:
    """The authenticated user. Endpoints that need one depend on this.

    A session whose account has been removed since it was found is not
    authenticated any more (``account_of``).
    """
    return auth_service.account_of(session)


CurrentUser = Annotated[User, Depends(get_current_user)]


def get_verified_user(user: CurrentUser) -> User:
    """The authenticated user, whose email address must be verified.

    For endpoints that publish something under the user's name. Logging in
    already requires a verified address, so a session normally implies one;
    this states the requirement where it matters instead of relying on that.
    """
    if user.email_verified_at is None:
        raise auth_service.EmailNotVerifiedError
    return user


VerifiedUser = Annotated[User, Depends(get_verified_user)]


def get_optional_user(request: Request, db: DbSession) -> User | None:
    """The authenticated user, or None if the request is anonymous.

    For endpoints that anyone may call but whose answer depends on who is
    asking. A cookie that does not belong to a usable session counts as no
    cookie: the request is answered as an anonymous one, not refused.

    That includes a session whose account is removed just as it is found.
    The rows that were read a moment ago are then gone, which shows when
    they are written to or read again (see ``account_of``). Where a session
    is required that is answered with 401; here it is one more cookie that
    belongs to nobody.
    """
    try:
        session = _session_from_cookie(request, db)
        if session is None:
            return None
        user = auth_service.account_of(session)
        # Noting when the session was used ends a transaction, and the
        # account is then read again by whatever first asks for something
        # of it. That is done here, where its absence can still be answered.
        _ = user.is_active
    except (
        auth_service.AccountNoLongerExistsError,
        ObjectDeletedError,
        StaleDataError,
    ):
        db.rollback()
        return None
    return user


OptionalUser = Annotated[User | None, Depends(get_optional_user)]


@dataclass(frozen=True)
class PageRequest:
    """Which page of a list a request asks for."""

    limit: int
    # The position after which the page starts; None for the first page.
    after: Cursor | None


def get_page_request(
    limit: Annotated[
        int,
        Query(ge=1, le=MAX_PAGE_SIZE, description="How many items to return."),
    ] = DEFAULT_PAGE_SIZE,
    cursor: Annotated[
        str | None,
        Query(description="The `next_cursor` of the previous page."),
    ] = None,
) -> PageRequest:
    """The page parameters shared by every paginated list."""
    try:
        after = decode_cursor(cursor) if cursor is not None else None
    except InvalidCursorError:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid cursor.",
        ) from None
    return PageRequest(limit=limit, after=after)


Pagination = Annotated[PageRequest, Depends(get_page_request)]


# --- pictures --------------------------------------------------------------


def image_upload_limit(user_id: object) -> rate_limit.Limit:
    """The counter of the pictures an account uploads, avatars and stories
    together. Each is decoded and drawn again, which is the most work one
    request can ask for, so it is the account's uploads that are limited,
    wherever its sessions are."""
    return rate_limit.Limit(
        "image-upload:account", str(user_id), settings.image_uploads_per_account
    )


def read_picture_upload(db: Session, user: User, file: UploadFile) -> bytes:
    """The bytes of an uploaded picture, counted against the account's limit.

    Every upload is counted, whatever becomes of it: a file that is refused
    has cost the decoding all the same. The count is taken first, before the
    file is looked at, while the request's database session holds nothing
    (``rate_limit`` commits it).

    The file's name and the content type the client declared for it are not
    looked at. What it is, is found out from its bytes
    (``app.services.images``).
    """
    rate_limit.count(db, image_upload_limit(user.id))
    data = file.file.read(settings.max_image_upload_bytes + 1)
    if len(data) > settings.max_image_upload_bytes:
        raise images.ImageTooLargeError
    return data


def picture_response(
    request: Request, data: bytes, *, etag_of: object, cache_control: str
) -> Response:
    """A picture as the API serves it.

    It may be embedded by pages of the same site only
    (``Cross-Origin-Resource-Policy``): the frontend, not anybody else's
    pages. ``etag_of`` names the picture; a browser that has it already gets
    ``304`` without the bytes, after the same checks as for the picture.
    """
    etag = f'"{etag_of}"'
    headers = {
        "Cache-Control": cache_control,
        "ETag": etag,
        "Cross-Origin-Resource-Policy": "same-site",
    }
    if etag in (part.strip() for part in request.headers.get("if-none-match", "").split(",")):
        return Response(status_code=status.HTTP_304_NOT_MODIFIED, headers=headers)
    return Response(content=data, media_type="image/webp", headers=headers)
