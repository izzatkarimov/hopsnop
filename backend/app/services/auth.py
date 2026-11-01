"""Every writer commits once, at the end; raw tokens are never stored or logged."""

import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

from sqlalchemy import Select, delete, exists, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, contains_eager
from sqlalchemy.orm.exc import ObjectDeletedError

from app.core.config import settings
from app.core.image_store import image_store
from app.core.security import (
    DUMMY_PASSWORD_HASH,
    generate_token,
    hash_password,
    hash_token,
    password_needs_rehash,
    verify_password,
)
from app.models import EmailVerificationToken, PasswordResetToken, User, UserSession
from app.services import email_caps, erasure


class AuthError(Exception):
    status_code = 400
    detail = "The request could not be completed."


class UsernameTakenError(AuthError):
    status_code = 409
    detail = "Username already in use."


class InvalidCredentialsError(AuthError):
    status_code = 401
    detail = "Invalid username/email or password."


class EmailNotVerifiedError(AuthError):
    status_code = 403
    detail = "Email address is not verified."


class InvalidVerificationTokenError(AuthError):
    detail = "Invalid or expired verification token."


class InvalidPasswordResetTokenError(AuthError):
    detail = "Invalid or expired password reset token."


class WrongCurrentPasswordError(AuthError):
    # Not a 401: the session is fine, and a client mustn't take this as a logout.
    detail = "Current password is incorrect."


class AccountNoLongerExistsError(AuthError):
    """Answered as a request without a session, which is what it has become."""

    status_code = 401
    detail = "Not authenticated."


def _now() -> datetime:
    return datetime.now(timezone.utc)


@dataclass(frozen=True)
class AddressHolder:
    id: uuid.UUID
    is_active: bool


@dataclass(frozen=True)
class Registration:
    """A new account's raw link token; or who holds the address, if anyone does."""

    raw_token: str | None = None
    holder: AddressHolder | None = None


def register_user(
    db: Session,
    *,
    username: str,
    email: str,
    password: str,
    display_name: str,
    client: str,
) -> Registration:
    """A taken address creates nothing; the caller must respond identically."""
    if _username_is_taken(db, username):
        raise UsernameTakenError
    holder = _address_holder(db, email)
    # Either way: this is most of the response's time, which mustn't tell the two apart.
    password_hash = hash_password(password)
    if holder is not None:
        return Registration(holder=holder)

    user = User(
        username=username,
        email=email,
        password_hash=password_hash,
        display_name=display_name,
    )
    db.add(user)
    try:
        db.flush()
    except IntegrityError as exc:
        # Lost a race for the name or email; the unique constraints are the guarantee.
        db.rollback()
        constraint = getattr(getattr(exc.orig, "diag", None), "constraint_name", None)
        if constraint == "uq_users_username":
            raise UsernameTakenError from None
        if constraint == "uq_users_email":
            # Postgres names one constraint; a username that collided too still decides.
            if _username_is_taken(db, username):
                raise UsernameTakenError from None
            return Registration(holder=_address_holder(db, email))
        raise

    # After the insert, which can wait on another's: the caps' lock isn't held for that.
    if not _place_taken(db, email, client):
        # The account stands; a link can be asked for once places free up.
        return Registration()
    raw_token = _issue_token(
        db,
        EmailVerificationToken,
        user,
        settings.email_verification_token_lifetime,
    )
    db.commit()
    return Registration(raw_token=raw_token)


def _place_taken(db: Session, email: str, client: str) -> bool:
    """Before any token: issuing withdraws the link in the mailbox. A skip commits."""
    if email_caps.take_place(db, email=email, client=client):
        return True
    # Else the caps' lock would be held until the response has gone out.
    db.commit()
    return False


def take_place_for_notice(db: Session, *, email: str, client: str) -> bool:
    """Commits either way, which gives the caps' lock back."""
    taken = email_caps.take_place(db, email=email, client=client)
    db.commit()
    return taken


def _username_is_taken(db: Session, username: str) -> bool:
    return db.scalar(select(User.id).where(User.username == username)) is not None


def _address_holder(db: Session, email: str) -> AddressHolder | None:
    # Plain values: the caller's counting commits, which would expire a loaded User.
    row = db.execute(
        select(User.id, User.is_active).where(User.email == email)
    ).one_or_none()
    return AddressHolder(row.id, row.is_active) if row is not None else None


def log_in(
    db: Session,
    *,
    identifier: str,
    password: str,
    replaced_token: str | None = None,
) -> tuple[UserSession, str]:
    """``replaced_token`` is the browser's session, ended as its cookie is replaced."""
    column = User.email if "@" in identifier else User.username
    user = db.scalar(select(User).where(column == identifier))

    # Indistinguishable to the client; a dummy hash keeps timing from revealing it.
    password_ok = verify_password(
        password,
        user.password_hash if user is not None else DUMMY_PASSWORD_HASH,
    )
    if user is None or not password_ok or not user.is_active:
        raise InvalidCredentialsError

    # Only after the password is proven, so it tells an outsider nothing.
    if user.email_verified_at is None:
        raise EmailNotVerifiedError

    # The slow check ran on an older read: re-read the hash under lock, so a password
    # just changed or reset opens no session. The session is created under that lock.
    verified_hash = user.password_hash
    account = _lock_account(db, user.id)
    if account is None or account.password_hash != verified_hash:
        raise InvalidCredentialsError

    now = _now()
    if password_needs_rehash(user.password_hash):
        # The one moment the plaintext is available to upgrade the hash.
        user.password_hash = hash_password(password)
    if replaced_token:
        _revoke_session_by_token(db, replaced_token, now)

    # Always fresh: a client-supplied value is never adopted as a session token.
    raw_token = generate_token()
    session = UserSession(
        user=user,
        token_hash=hash_token(raw_token),
        created_at=now,
        expires_at=now + settings.session_lifetime,
        last_used_at=now,
    )
    db.add(session)
    db.commit()
    return session, raw_token


def authenticate_session(db: Session, raw_token: str) -> UserSession | None:
    """The single place that decides whether a session is valid."""
    now = _now()
    session = db.scalar(
        select(UserSession)
        .join(UserSession.user)
        .options(contains_eager(UserSession.user))
        .where(
            UserSession.token_hash == hash_token(raw_token),
            UserSession.revoked_at.is_(None),
            UserSession.expires_at > now,
            User.is_active.is_(True),
        )
    )
    if session is None:
        return None

    # Can lag by up to the interval; in exchange most requests don't write.
    if now - session.last_used_at >= settings.session_last_used_interval:
        session.last_used_at = now
        db.commit()
    return session


def log_out(db: Session, raw_token: str) -> None:
    _revoke_session_by_token(db, raw_token, _now())
    db.commit()


def list_sessions(db: Session, user: User) -> list[UserSession]:
    return list(
        db.scalars(
            select(UserSession)
            .where(*_active_sessions_of(user.id, _now()))
            .order_by(UserSession.last_used_at.desc(), UserSession.created_at.desc())
        )
    )


def revoke_session(db: Session, user: User, session_id: uuid.UUID) -> bool:
    now = _now()
    result = db.execute(
        update(UserSession)
        .where(UserSession.id == session_id, *_active_sessions_of(user.id, now))
        .values(revoked_at=now)
    )
    db.commit()
    return result.rowcount == 1


def revoke_other_sessions(db: Session, current: UserSession) -> int:
    now = _now()
    result = db.execute(
        update(UserSession)
        .where(
            UserSession.id != current.id,
            *_active_sessions_of(current.user_id, now),
        )
        .values(revoked_at=now)
    )
    db.commit()
    return result.rowcount


def _active_sessions_of(user_id: uuid.UUID, now: datetime) -> tuple:
    # The user_id scope is the authorization: this can't reach other users' sessions.
    return (
        UserSession.user_id == user_id,
        UserSession.revoked_at.is_(None),
        UserSession.expires_at > now,
    )


def _revoke_session_by_token(db: Session, raw_token: str, now: datetime) -> None:
    db.execute(
        update(UserSession)
        .where(
            UserSession.token_hash == hash_token(raw_token),
            UserSession.revoked_at.is_(None),
        )
        .values(revoked_at=now)
    )


def verify_email(db: Session, raw_token: str) -> None:
    now = _now()
    token = _usable_token(db, EmailVerificationToken, raw_token, now)
    if token is None:
        raise InvalidVerificationTokenError
    token.used_at = now
    token.user.email_verified_at = now
    db.commit()


def request_email_verification(db: Session, email: str, *, client: str) -> str | None:
    """None if there's nothing to send; the caller must respond identically."""
    user = db.scalar(_for_issuing_a_token(email))
    if user is None or not user.is_active or user.email_verified_at is not None:
        return None
    if _issued_recently(db, EmailVerificationToken, user):
        return None
    if not _place_taken(db, email, client):
        return None
    raw_token = _issue_token(
        db,
        EmailVerificationToken,
        user,
        settings.email_verification_token_lifetime,
    )
    db.commit()
    return raw_token


def request_password_reset(db: Session, email: str, *, client: str) -> str | None:
    """None if there's nothing to send; the caller must respond identically."""
    user = db.scalar(_for_issuing_a_token(email))
    if user is None or not user.is_active:
        return None
    if _issued_recently(db, PasswordResetToken, user):
        return None
    if not _place_taken(db, email, client):
        return None
    raw_token = _issue_token(
        db,
        PasswordResetToken,
        user,
        settings.password_reset_token_lifetime,
    )
    db.commit()
    return raw_token


def reset_password(db: Session, raw_token: str, new_password: str) -> None:
    now = _now()
    # Account locked from here (``_usable_token``), so no login can slip a session in.
    token = _usable_token(db, PasswordResetToken, raw_token, now)
    if token is None:
        raise InvalidPasswordResetTokenError
    token.used_at = now
    token.user.password_hash = hash_password(new_password)
    # After a reset the only way in is the new password.
    db.execute(
        update(UserSession)
        .where(
            UserSession.user_id == token.user_id,
            UserSession.revoked_at.is_(None),
        )
        .values(revoked_at=now)
    )
    db.commit()


def change_password(
    db: Session,
    current: UserSession,
    *,
    current_password: str,
    new_password: str,
) -> str:
    """Returns the session's new token; other sessions and pending reset links end."""
    user = account_of(current)
    verified_hash = _check_current_password(user, current_password)
    # Hashed before locking, so the lock isn't held for as long as hashing takes.
    new_hash = hash_password(new_password)

    # Locked from here: no login, change or reset until this commits.
    _lock_account_if_unchanged(db, user, verified_hash)

    now = _now()
    user.password_hash = new_hash
    raw_token = generate_token()
    current.token_hash = hash_token(raw_token)
    db.execute(
        update(UserSession)
        .where(
            UserSession.id != current.id,
            *_active_sessions_of(user.id, now),
        )
        .values(revoked_at=now)
    )
    db.execute(
        delete(PasswordResetToken).where(
            PasswordResetToken.user_id == user.id,
            PasswordResetToken.used_at.is_(None),
        )
    )
    db.commit()
    return raw_token


def delete_account(db: Session, current: UserSession, *, password: str) -> None:
    """At once and for good; the row is locked exclusively until the commit."""
    user = account_of(current)
    verified_hash = _check_current_password(user, password)
    _lock_account_if_unchanged(db, user, verified_hash, exclusive=True)
    email = user.email
    pictures = erasure.erase_account(db, user.id, _now())
    email_caps.forget_address(db, email)
    db.commit()
    # Now that no row names them.
    image_store().delete(pictures)


_TokenModel = type[EmailVerificationToken] | type[PasswordResetToken]


def _issue_token(
    db: Session,
    model: _TokenModel,
    user: User,
    lifetime: timedelta,
) -> str:
    """Deletes the user's unused token of this kind, so only the latest link works."""
    now = _now()
    db.execute(delete(model).where(model.user_id == user.id, model.used_at.is_(None)))
    raw_token = generate_token()
    db.add(
        model(
            user_id=user.id,
            token_hash=hash_token(raw_token),
            created_at=now,
            expires_at=now + lifetime,
        )
    )
    db.flush()
    return raw_token


def account_of(session: UserSession) -> User:
    """Either row may be gone by now: another request can remove the account."""
    try:
        user = session.user
    except ObjectDeletedError:
        raise AccountNoLongerExistsError from None
    if user is None:
        raise AccountNoLongerExistsError
    return user


def confirm_password(db: Session, current: UserSession, *, password: str) -> User:
    """Re-proves the password; the account can't change or go until the commit."""
    user = account_of(current)
    verified_hash = _check_current_password(user, password)
    return _lock_account_if_unchanged(db, user, verified_hash)


def _check_current_password(user: User, password: str) -> str:
    """Returns the matched hash, for ``_lock_account_if_unchanged``; takes no lock."""
    verified_hash = user.password_hash
    if not verify_password(password, verified_hash):
        raise WrongCurrentPasswordError
    return verified_hash


def _lock_account_if_unchanged(
    db: Session,
    user: User,
    verified_hash: str,
    *,
    exclusive: bool = False,
) -> User:
    """Re-reads the hash under lock: a changed, reset or removed account is refused."""
    account = _lock_account(db, user.id, exclusive=exclusive)
    if account is None:
        raise AccountNoLongerExistsError
    if account.password_hash != verified_hash:
        raise WrongCurrentPasswordError
    return account


def _lock_account(
    db: Session, user_id: uuid.UUID, *, exclusive: bool = False
) -> User | None:
    """Re-reads under lock; taken before tokens. ``exclusive`` is for removal only."""
    return db.scalar(
        select(User)
        .where(User.id == user_id)
        .with_for_update(key_share=not exclusive)
        .execution_options(populate_existing=True)
    )


def lock_own_account(db: Session, user: User) -> User:
    """Locked first, per the lock order; changes based on the old value take turns."""
    account = _lock_account(db, user.id)
    if account is None:
        raise AccountNoLongerExistsError
    return account


def hold_account(db: Session, user: User) -> None:
    """FOR KEY SHARE on the account first, so a writer can't deadlock with removal."""
    held = db.scalar(
        select(User.id)
        .where(User.id == user.id)
        .with_for_update(read=True, key_share=True)
    )
    if held is None:
        raise AccountNoLongerExistsError


def _for_issuing_a_token(email: str) -> Select[tuple[User]]:
    """FOR NO KEY UPDATE, so simultaneous requests for an address issue one link."""
    return select(User).where(User.email == email).with_for_update(key_share=True)


def _issued_recently(db: Session, model: _TokenModel, user: User) -> bool:
    """The cooldown: otherwise anyone knowing an address could keep killing the link."""
    now = _now()
    return db.scalar(
        select(
            exists().where(
                model.user_id == user.id,
                model.used_at.is_(None),
                model.expires_at > now,
                model.created_at > now - settings.email_token_cooldown,
            )
        )
    )


def _usable_token(
    db: Session,
    model: _TokenModel,
    raw_token: str,
    now: datetime,
) -> EmailVerificationToken | PasswordResetToken | None:
    """Locks account then token: no double redemption, no deadlock with a new link."""
    token_hash = hash_token(raw_token)
    # No lock yet: only to learn which account to lock; validity is decided below.
    user_id = db.scalar(select(model.user_id).where(model.token_hash == token_hash))
    if user_id is None or _lock_account(db, user_id) is None:
        return None
    return db.scalar(
        select(model)
        .join(model.user)
        .options(contains_eager(model.user))
        .where(
            model.token_hash == token_hash,
            model.used_at.is_(None),
            model.expires_at > now,
            User.is_active.is_(True),
        )
        .with_for_update(of=model)
    )
