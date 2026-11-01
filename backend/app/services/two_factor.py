"""The rows of two-factor login; callers hold the account's row and do the commit."""

import uuid
from datetime import datetime, timedelta

from sqlalchemy import delete, exists, func, select
from sqlalchemy.orm import Session

from app.core import two_factor as codes
from app.core.config import settings
from app.core.security import generate_token, hash_token
from app.models import LoginChallenge, RecoveryCode, TwoFactorCredential

# Long enough to scan a code and type it; the purge removes what's left behind.
PENDING_LIFETIME = timedelta(hours=1)


def status(db: Session, user_id: uuid.UUID) -> tuple[bool, int]:
    """Whether it's on, and how many recovery codes are left."""
    return db.execute(
        select(
            exists().where(
                TwoFactorCredential.user_id == user_id,
                TwoFactorCredential.enabled_at.is_not(None),
            ),
            select(func.count())
            .select_from(RecoveryCode)
            .where(RecoveryCode.user_id == user_id)
            .scalar_subquery(),
        )
    ).one()


def credential_of(db: Session, user_id: uuid.UUID) -> TwoFactorCredential | None:
    return db.scalar(
        select(TwoFactorCredential)
        .where(TwoFactorCredential.user_id == user_id)
        .execution_options(populate_existing=True)
    )


def is_on(credential: TwoFactorCredential | None) -> bool:
    return credential is not None and credential.enabled_at is not None


def is_pending(credential: TwoFactorCredential | None, now: datetime) -> bool:
    return (
        credential is not None
        and credential.enabled_at is None
        and credential.pending_until is not None
        and credential.pending_until > now
    )


def set_pending(
    db: Session,
    credential: TwoFactorCredential | None,
    user_id: uuid.UUID,
    secret: bytes,
    now: datetime,
) -> None:
    """Replaces a pending secret, which stops working from here."""
    if credential is None:
        credential = TwoFactorCredential(user_id=user_id)
        db.add(credential)
    credential.secret_ciphertext = codes.encrypt_secret(secret, user_id)
    credential.pending_until = now + PENDING_LIFETIME
    credential.enabled_at = None
    credential.last_used_step = None
    credential.created_at = now
    db.flush()


def replace_recovery_codes(db: Session, user_id: uuid.UUID) -> list[str]:
    db.execute(delete(RecoveryCode).where(RecoveryCode.user_id == user_id))
    new_codes = codes.new_recovery_codes()
    db.add_all(
        RecoveryCode(user_id=user_id, code_hash=codes.recovery_code_hash(user_id, code))
        for code in new_codes
    )
    db.flush()
    return new_codes


def accept_totp(credential: TwoFactorCredential, code: str, now: datetime) -> bool:
    """Notes the step on the credential, so the same code can't be used twice."""
    code = codes.tidied(code)
    if not codes.is_totp_code(code):
        return False
    secret = codes.decrypt_secret(credential.secret_ciphertext, credential.user_id)
    step = codes.matching_step(secret, code, now, after=credential.last_used_step)
    if step is None:
        return False
    credential.last_used_step = step
    return True


def accept_recovery_code(db: Session, user_id: uuid.UUID, code: str) -> bool:
    """Removes it on the way, so it works once."""
    used = db.scalar(
        delete(RecoveryCode)
        .where(
            RecoveryCode.user_id == user_id,
            RecoveryCode.code_hash == codes.recovery_code_hash(user_id, code),
        )
        .returning(RecoveryCode.id)
    )
    return used is not None


def remove_challenges(db: Session, user_id: uuid.UUID) -> None:
    db.execute(delete(LoginChallenge).where(LoginChallenge.user_id == user_id))


def remove_all(db: Session, user_id: uuid.UUID) -> None:
    db.execute(
        delete(TwoFactorCredential).where(TwoFactorCredential.user_id == user_id)
    )
    db.execute(delete(RecoveryCode).where(RecoveryCode.user_id == user_id))
    remove_challenges(db, user_id)


def issue_challenge(
    db: Session, user_id: uuid.UUID, now: datetime
) -> tuple[str, datetime]:
    """Replaces an open one, so an account has one at most."""
    remove_challenges(db, user_id)
    raw_challenge = generate_token()
    expires_at = now + settings.login_challenge_lifetime
    db.add(
        LoginChallenge(
            user_id=user_id,
            token_hash=hash_token(raw_challenge),
            created_at=now,
            expires_at=expires_at,
        )
    )
    db.flush()
    return raw_challenge, expires_at


def challenge_owner(db: Session, raw_challenge: str) -> uuid.UUID | None:
    """No lock: only to learn which account to count and lock."""
    return db.scalar(
        select(LoginChallenge.user_id).where(
            LoginChallenge.token_hash == hash_token(raw_challenge)
        )
    )


def live_challenge(
    db: Session, user_id: uuid.UUID, raw_challenge: str, now: datetime
) -> LoginChallenge | None:
    return db.scalar(
        select(LoginChallenge)
        .where(
            LoginChallenge.user_id == user_id,
            LoginChallenge.token_hash == hash_token(raw_challenge),
            LoginChallenge.expires_at > now,
        )
        .with_for_update()
        .execution_options(populate_existing=True)
    )
