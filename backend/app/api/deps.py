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
    # Closing rolls back anything uncommitted.
    with SessionLocal() as db:
        yield db


DbSession = Annotated[Session, Depends(get_db)]


def no_store(response: Response) -> None:
    """For private responses: no browser or intermediary may keep a copy."""
    response.headers["Cache-Control"] = "no-store"


def verify_request_origin(request: Request) -> None:
    """CSRF: writes must come from our origins; no header means not a browser."""
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
    # Also refuses the opaque "null" origin of sandboxed documents.
    if source.lower() not in (settings.frontend_origin, own_origin.lower()):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Cross-origin request rejected.",
        )


def client_address(request: Request) -> str:
    """Connection peer, never a client-set header; proxies need --proxy-headers."""
    return request.client.host if request.client else "unknown"


ClientAddress = Annotated[str, Depends(client_address)]


def limit_per_address(scope: str, setting: str):
    """Counts every request against a per-address limit, whatever its outcome."""

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
    """One 401 for all: no cookie, unknown, revoked, expired, deactivated."""
    session = _session_from_cookie(request, db)
    if session is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated.",
        )
    return session


CurrentSession = Annotated[UserSession, Depends(get_current_session)]


def get_current_user(session: CurrentSession) -> User:
    return auth_service.account_of(session)


CurrentUser = Annotated[User, Depends(get_current_user)]


def get_verified_user(user: CurrentUser) -> User:
    """Login already implies verified; this states the requirement where it matters."""
    if user.email_verified_at is None:
        raise auth_service.EmailNotVerifiedError
    return user


VerifiedUser = Annotated[User, Depends(get_verified_user)]


def get_optional_user(request: Request, db: DbSession) -> User | None:
    """A cookie without a usable session counts as anonymous, not as a 401."""
    try:
        session = _session_from_cookie(request, db)
        if session is None:
            return None
        user = auth_service.account_of(session)
        # Last-use commit expired it; reload here, where a gone account can be answered.
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
    limit: int
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
    try:
        after = decode_cursor(cursor) if cursor is not None else None
    except InvalidCursorError:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid cursor.",
        ) from None
    return PageRequest(limit=limit, after=after)


Pagination = Annotated[PageRequest, Depends(get_page_request)]


def image_upload_limit(user_id: object) -> rate_limit.Limit:
    """Per account: redrawing is the costliest work a request can ask for."""
    return rate_limit.Limit(
        "image-upload:account", str(user_id), settings.image_uploads_per_account
    )


def read_picture_upload(db: Session, user: User, file: UploadFile) -> bytes:
    """Counted first, on a clean session; the client's name and type are ignored."""
    rate_limit.count(db, image_upload_limit(user.id))
    data = file.file.read(settings.max_image_upload_bytes + 1)
    if len(data) > settings.max_image_upload_bytes:
        raise images.ImageTooLargeError
    return data


def picture_response(
    request: Request, data: bytes, *, etag_of: object, cache_control: str
) -> Response:
    """Same-site embedding only; ``etag_of`` gives 304 after the same checks."""
    etag = f'"{etag_of}"'
    headers = {
        "Cache-Control": cache_control,
        "ETag": etag,
        "Cross-Origin-Resource-Policy": "same-site",
    }
    if etag in (part.strip() for part in request.headers.get("if-none-match", "").split(",")):
        return Response(status_code=status.HTTP_304_NOT_MODIFIED, headers=headers)
    return Response(content=data, media_type="image/webp", headers=headers)
