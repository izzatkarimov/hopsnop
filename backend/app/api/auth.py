import uuid
from datetime import datetime, timezone
from typing import Annotated

from fastapi import (
    APIRouter,
    BackgroundTasks,
    Depends,
    HTTPException,
    Request,
    Response,
    status,
)

from app.api.deps import (
    ClientAddress,
    CurrentSession,
    CurrentUser,
    DbSession,
    VerifiedUser,
    image_upload_limit,
    limit_per_address,
)
from app.core.config import settings
from app.models import UserSession
from app.schemas.auth import (
    AccountResponse,
    ChangePasswordRequest,
    DeleteAccountRequest,
    ForgotPasswordRequest,
    LoginRequest,
    MessageResponse,
    RegisterRequest,
    ResendVerificationRequest,
    ResetPasswordRequest,
    RevokedSessionsResponse,
    SessionResponse,
    VerifyEmailRequest,
)
from app.services import auth as auth_service
from app.services import rate_limit
from app.services.email import (
    EmailSender,
    email_verification_url,
    get_email_sender,
    password_reset_url,
)


def _no_store(response: Response) -> None:
    # Carries account data or the session cookie; nothing may keep a copy.
    response.headers["Cache-Control"] = "no-store"


router = APIRouter(prefix="/auth", tags=["auth"], dependencies=[Depends(_no_store)])

EmailSenderDep = Annotated[EmailSender, Depends(get_email_sender)]


def _set_session_cookie(
    response: Response, raw_token: str, *, max_age: int | None = None
) -> None:
    if max_age is None:
        max_age = int(settings.session_lifetime.total_seconds())
    response.set_cookie(
        key=settings.session_cookie,
        value=raw_token,
        max_age=max_age,
        path="/",
        # No Domain attribute: the cookie is only sent back to this host.
        httponly=True,
        secure=settings.session_cookie_secure,
        samesite=settings.session_cookie_samesite,
    )


def _clear_session_cookie(response: Response) -> None:
    response.delete_cookie(
        key=settings.session_cookie,
        path="/",
        httponly=True,
        secure=settings.session_cookie_secure,
        samesite=settings.session_cookie_samesite,
    )


def _login_limits(identifier: str, address: str) -> list[rate_limit.Limit]:
    """Keyed by what was typed, so an unknown identifier behaves like a real account."""
    return [
        rate_limit.Limit(
            "login:identifier+address",
            f"{identifier}\x00{address}",
            settings.login_failures_per_identifier_and_ip,
        ),
        rate_limit.Limit("login:address", address, settings.login_failures_per_ip),
        rate_limit.Limit(
            "login:identifier", identifier, settings.login_failures_per_identifier
        ),
    ]


def password_confirmation_limits(current: UserSession) -> list[rate_limit.Limit]:
    """One counter per account, shared by every password-confirming operation."""
    return [
        rate_limit.Limit(
            "password-confirmation:account",
            str(current.user_id),
            settings.password_confirmation_failures,
        )
    ]


def data_export_limit(current: UserSession) -> rate_limit.Limit:
    """Counts exports per account; a request refused for its password isn't one."""
    return rate_limit.Limit(
        "data-export:account",
        str(current.user_id),
        settings.data_exports_per_account,
    )


@router.post(
    "/register",
    response_model=AccountResponse,
    status_code=status.HTTP_201_CREATED,
    dependencies=[limit_per_address("register", "registrations_per_ip")],
)
def register(
    data: RegisterRequest,
    db: DbSession,
    email_sender: EmailSenderDep,
    background_tasks: BackgroundTasks,
) -> AccountResponse:
    user, raw_token = auth_service.register_user(
        db,
        username=data.username,
        email=data.email,
        password=data.password.get_secret_value(),
        display_name=data.display_name,
    )
    background_tasks.add_task(
        email_sender.send_email_verification,
        to=user.email,
        url=email_verification_url(raw_token),
    )
    return AccountResponse.model_validate(user)


@router.post("/login", response_model=AccountResponse)
def login(
    data: LoginRequest,
    request: Request,
    response: Response,
    address: ClientAddress,
    db: DbSession,
) -> AccountResponse:
    # Counted before the password check, so simultaneous attempts can't beat the limit.
    counted = rate_limit.count_all(db, _login_limits(data.identifier, address))
    try:
        session, raw_token = auth_service.log_in(
            db,
            identifier=data.identifier,
            password=data.password.get_secret_value(),
            replaced_token=request.cookies.get(settings.session_cookie),
        )
    except auth_service.EmailNotVerifiedError:
        # The password was right, so this wasn't a guess.
        rate_limit.uncount_all(db, counted)
        raise
    # Only failures are limited.
    rate_limit.uncount_all(db, counted)
    # The account may have gone since the commit; no cookie for a session that's gone.
    account = auth_service.account_of(session)
    # The token leaves the server only in this cookie, never in the body.
    _set_session_cookie(response, raw_token)
    return AccountResponse.model_validate(account)


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
def logout(request: Request, response: Response, db: DbSession) -> None:
    """Succeeds whether or not the request carried a usable session."""
    raw_token = request.cookies.get(settings.session_cookie)
    if raw_token:
        auth_service.log_out(db, raw_token)
    _clear_session_cookie(response)


@router.get("/me", response_model=AccountResponse)
def me(user: CurrentUser) -> AccountResponse:
    return AccountResponse.model_validate(user)


@router.post(
    "/verify-email",
    response_model=MessageResponse,
    dependencies=[limit_per_address("verify-email", "token_redemptions_per_ip")],
)
def verify_email(data: VerifyEmailRequest, db: DbSession) -> MessageResponse:
    auth_service.verify_email(db, data.token.get_secret_value())
    return MessageResponse(message="Email address verified.")


@router.post(
    "/resend-verification",
    response_model=MessageResponse,
    status_code=status.HTTP_202_ACCEPTED,
    dependencies=[limit_per_address("resend-verification", "email_requests_per_ip")],
)
def resend_verification(
    data: ResendVerificationRequest,
    db: DbSession,
    email_sender: EmailSenderDep,
    background_tasks: BackgroundTasks,
) -> MessageResponse:
    raw_token = auth_service.request_email_verification(db, data.email)
    if raw_token is not None:
        # After the response, so its timing doesn't reveal that an account was found.
        background_tasks.add_task(
            email_sender.send_email_verification,
            to=data.email,
            url=email_verification_url(raw_token),
        )
    # Same answer whether or not the account exists or a link was just issued.
    return MessageResponse(
        message=(
            "If that email address belongs to an account that still needs "
            "verification, a verification email has been sent."
        )
    )


@router.post(
    "/forgot-password",
    response_model=MessageResponse,
    status_code=status.HTTP_202_ACCEPTED,
    dependencies=[limit_per_address("forgot-password", "email_requests_per_ip")],
)
def forgot_password(
    data: ForgotPasswordRequest,
    db: DbSession,
    email_sender: EmailSenderDep,
    background_tasks: BackgroundTasks,
) -> MessageResponse:
    raw_token = auth_service.request_password_reset(db, data.email)
    if raw_token is not None:
        # After the response, so its timing doesn't reveal that an account was found.
        background_tasks.add_task(
            email_sender.send_password_reset,
            to=data.email,
            url=password_reset_url(raw_token),
        )
    # Same answer whether or not the account exists or a link was just issued.
    return MessageResponse(
        message=(
            "If that email address belongs to an account, a password reset "
            "email has been sent."
        )
    )


@router.post(
    "/reset-password",
    response_model=MessageResponse,
    dependencies=[limit_per_address("reset-password", "token_redemptions_per_ip")],
)
def reset_password(data: ResetPasswordRequest, db: DbSession) -> MessageResponse:
    auth_service.reset_password(
        db,
        data.token.get_secret_value(),
        data.new_password.get_secret_value(),
    )
    return MessageResponse(message="Password has been reset.")


@router.post("/change-password", response_model=MessageResponse)
def change_password(
    data: ChangePasswordRequest,
    current: CurrentSession,
    # Only enforces verification; the user comes from the session.
    _verified: VerifiedUser,
    response: Response,
    db: DbSession,
) -> MessageResponse:
    """Needs the current password; other sessions end, this one gets a new cookie."""
    # Read first: counting commits and expires this; the session may be gone by then.
    remaining = current.expires_at - datetime.now(timezone.utc)
    limits = password_confirmation_limits(current)
    counted = rate_limit.count_all(db, limits)
    try:
        raw_token = auth_service.change_password(
            db,
            current,
            current_password=data.current_password.get_secret_value(),
            new_password=data.new_password.get_secret_value(),
        )
    except auth_service.AccountNoLongerExistsError:
        # Account removed meanwhile, counter included; don't leave new counts behind.
        rate_limit.forget(db, limits)
        raise
    rate_limit.uncount_all(db, counted)
    # The session keeps the time it had left, not a new lifetime.
    _set_session_cookie(
        response, raw_token, max_age=max(1, int(remaining.total_seconds()))
    )
    return MessageResponse(message="Password has been changed.")


def _counters_named_after(
    current: UserSession, address: str
) -> list[rate_limit.Limit]:
    """Not the address's counter: removal mustn't refund that address's guesses."""
    account = auth_service.account_of(current)
    limits = [
        *password_confirmation_limits(current),
        data_export_limit(current),
        image_upload_limit(current.user_id),
    ]
    for identifier in (account.username, account.email):
        limits += [
            limit
            for limit in _login_limits(identifier, address)
            if limit.subject != address
        ]
    return limits


@router.post("/delete-account", status_code=status.HTTP_204_NO_CONTENT)
def delete_account(
    data: DeleteAccountRequest,
    current: CurrentSession,
    address: ClientAddress,
    response: Response,
    db: DbSession,
) -> None:
    """Permanent; needs the password. A post with replies stays as an empty place."""
    # Worked out while the account can still be read.
    to_forget = _counters_named_after(current, address)
    rate_limit.count_all(db, password_confirmation_limits(current))
    auth_service.delete_account(
        db, current, password=data.password.get_secret_value()
    )
    # A name's next owner must not inherit its counters.
    rate_limit.forget(db, to_forget)
    _clear_session_cookie(response)


@router.get("/sessions", response_model=list[SessionResponse])
def list_sessions(
    current: CurrentSession,
    db: DbSession,
) -> list[SessionResponse]:
    account = auth_service.account_of(current)
    return [
        SessionResponse(
            id=session.id,
            created_at=session.created_at,
            last_used_at=session.last_used_at,
            expires_at=session.expires_at,
            is_current=session.id == current.id,
        )
        for session in auth_service.list_sessions(db, account)
    ]


@router.post("/sessions/revoke-others", response_model=RevokedSessionsResponse)
def revoke_other_sessions(
    current: CurrentSession,
    db: DbSession,
) -> RevokedSessionsResponse:
    revoked_count = auth_service.revoke_other_sessions(db, current)
    return RevokedSessionsResponse(revoked_count=revoked_count)


@router.delete("/sessions/{session_id}", status_code=status.HTTP_204_NO_CONTENT)
def revoke_session(
    session_id: uuid.UUID,
    current: CurrentSession,
    response: Response,
    db: DbSession,
) -> None:
    is_current = session_id == current.id
    account = auth_service.account_of(current)
    if not auth_service.revoke_session(db, account, session_id):
        # Same answer for someone else's session, so session ids can't be probed.
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Session not found.",
        )
    if is_current:
        _clear_session_cookie(response)
