from __future__ import annotations

import uuid
from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import CheckConstraint, ForeignKey, Index, String, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base

if TYPE_CHECKING:
    from app.models.user import User


class PasswordResetToken(Base):
    __tablename__ = "password_reset_tokens"
    __table_args__ = (
        CheckConstraint("expires_at > created_at", name="expires_after_created"),
        Index("ix_password_reset_tokens_user_id", "user_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"),
    )
    # SHA-256 of the emailed token; the raw token is never stored.
    token_hash: Mapped[str] = mapped_column(String(64), unique=True)
    expires_at: Mapped[datetime] = mapped_column()
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())
    # Superseded tokens are deleted, so a timestamp here always means used.
    used_at: Mapped[datetime | None] = mapped_column()

    user: Mapped[User] = relationship(back_populates="password_reset_tokens")
