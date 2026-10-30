from fastapi import Depends, FastAPI, Request
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from psycopg.errors import ForeignKeyViolation
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm.exc import ObjectDeletedError, StaleDataError

from app.api.auth import router as auth_router
from app.api.deps import verify_request_origin
from app.api.feed import router as feed_router
from app.api.posts import router as posts_router
from app.api.stories import router as stories_router
from app.api.users import router as users_router
from app.core.config import settings
from app.core.middleware import (
    RequestBodyLimitMiddleware,
    SecurityHeadersMiddleware,
    add_security_headers,
)
from app.services.auth import AuthError
from app.services.images import ImageError
from app.services.posts import PostError
from app.services.rate_limit import RateLimitedError
from app.services.stories import StoryError
from app.services.users import UserError

# Every error has the same shape: {"detail": ...}.


async def handle_service_error(
    request: Request, exc: AuthError | ImageError | PostError | StoryError | UserError
) -> JSONResponse:
    return JSONResponse(status_code=exc.status_code, content={"detail": exc.detail})


async def handle_rate_limited(request: Request, exc: RateLimitedError) -> JSONResponse:
    # One answer for every limit; which was reached isn't said.
    return JSONResponse(
        status_code=exc.status_code,
        content={"detail": exc.detail},
        headers={"Retry-After": str(exc.retry_after)},
    )


async def handle_lost_reference(request: Request, exc: IntegrityError) -> JSONResponse:
    """A write whose reference was just removed: a fallback, as services hold theirs."""
    if not isinstance(exc.orig, ForeignKeyViolation):
        raise exc
    return JSONResponse(
        status_code=409,
        content={"detail": "The request could not be completed."},
    )


async def handle_removed_account(
    request: Request, exc: ObjectDeletedError | StaleDataError
) -> JSONResponse:
    """The caller's own rows vanished mid-request: answered as having no session."""
    return JSONResponse(status_code=401, content={"detail": "Not authenticated."})


async def handle_validation_error(
    request: Request, exc: RequestValidationError
) -> JSONResponse:
    # By default errors echo the input, returning submitted passwords and tokens.
    errors = [
        {"loc": error["loc"], "msg": error["msg"], "type": error["type"]}
        for error in exc.errors()
    ]
    return JSONResponse(status_code=422, content={"detail": jsonable_encoder(errors)})


async def handle_unexpected_error(request: Request, exc: Exception) -> JSONResponse:
    # The client learns nothing of what went wrong; the exception still reaches the log.
    response = JSONResponse(
        status_code=500, content={"detail": "Internal server error."}
    )
    # Sent from outside every middleware, so these headers must be added here.
    add_security_headers(response.headers)
    return response


# Part boundaries and headers, plus a caption of a few hundred bytes.
_FORM_OVERHEAD_BYTES = 64 * 1024


async def health_check():
    return {"status": "ok"}


def create_app() -> FastAPI:
    """A function so environment-dependent parts can be rebuilt for another one."""
    docs_enabled = settings.api_docs_enabled
    app = FastAPI(
        title="Hopsnop API",
        version="0.1.0",
        # CSRF defence for every route, present and future.
        dependencies=[Depends(verify_request_origin)],
        # They describe every route, so only development serves them.
        docs_url="/docs" if docs_enabled else None,
        redoc_url="/redoc" if docs_enabled else None,
        openapi_url="/openapi.json" if docs_enabled else None,
    )

    # Listed inside out: the last added is the first to see a request.

    # Innermost, so a body refused for size still gets the headers the two below add.
    upload_body_bytes = settings.max_image_upload_bytes + _FORM_OVERHEAD_BYTES
    app.add_middleware(
        RequestBodyLimitMiddleware,
        max_bytes=settings.max_request_body_bytes,
        larger={
            ("PUT", "/users/me/avatar"): upload_body_bytes,
            ("POST", "/stories"): upload_body_bytes,
        },
    )

    # Exactly one origin; a wildcard is never used with credentials.
    app.add_middleware(
        CORSMiddleware,
        allow_origins=[settings.frontend_origin],
        allow_credentials=True,
        allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE"],
        allow_headers=["Content-Type"],
        # Scripts can't read these by default: retry time after a 429, export file name.
        expose_headers=["Retry-After", "Content-Disposition"],
    )

    # Outermost: every response gets these, whatever produced it.
    app.add_middleware(SecurityHeadersMiddleware)

    app.include_router(auth_router)
    app.include_router(users_router)
    app.include_router(posts_router)
    app.include_router(feed_router)
    app.include_router(stories_router)

    for service_error in (AuthError, ImageError, PostError, StoryError, UserError):
        app.add_exception_handler(service_error, handle_service_error)
    app.add_exception_handler(RateLimitedError, handle_rate_limited)
    app.add_exception_handler(IntegrityError, handle_lost_reference)
    for removed in (ObjectDeletedError, StaleDataError):
        app.add_exception_handler(removed, handle_removed_account)
    app.add_exception_handler(RequestValidationError, handle_validation_error)
    app.add_exception_handler(Exception, handle_unexpected_error)

    app.add_api_route("/health", health_check, methods=["GET"])
    return app


app = create_app()
