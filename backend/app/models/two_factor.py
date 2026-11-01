from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import (
    BigInteger,
    CheckConstraint,
    ForeignKey,
    Index,
    LargeBinary,
    String,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class TwoFactorCredential(Base):
    """One per account: pending until confirmed, on from then until turned off."""

    __tablename__ = "two_factor_credentials"

    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    # AES-256-GCM, bound to the account; a code can't be checked against a hash.
    secret_ciphertext: Mapped[bytes] = mapped_column(LargeBinary)
    # Null once on, so the purge can't take an active secret.
    pending_until: Mapped[datetime | None] = mapped_column()
    enabled_at: Mapped[datetime | None] = mapped_column()
    # The newest time step a code was accepted for; it and older ones are refused.
    last_used_step: Mapped[int | None] = mapped_column(BigInteger)
    created_at: Mapped[datetime] = mapped_column()


class RecoveryCode(Base):
    """A used code's row is removed, so what's here is what's left."""

    __tablename__ = "recovery_codes"
    __table_args__ = (
        UniqueConstraint("user_id", "code_hash", name="uq_recovery_codes_user_id_code_hash"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE")
    )
    # Keyed HMAC-SHA256; the code itself is shown once and never stored.
    code_hash: Mapped[str] = mapped_column(String(64))


class LoginChallenge(Base):
    """One open per account; removed when used or voided, so a row is always live."""

    __tablename__ = "login_challenges"
    __table_args__ = (
        CheckConstraint("expires_at > created_at", name="expires_after_created"),
        Index("ix_login_challenges_expires_at", "expires_at"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), unique=True
    )
    # SHA-256 of the token; the raw token is never stored.
    token_hash: Mapped[str] = mapped_column(String(64), unique=True)
    failed_attempts: Mapped[int] = mapped_column(default=0)
    created_at: Mapped[datetime] = mapped_column()
    expires_at: Mapped[datetime] = mapped_column()
