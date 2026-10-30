from __future__ import annotations

import uuid
from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import CheckConstraint, ForeignKey, Index, String, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base

if TYPE_CHECKING:
    from app.models.user import User


class UserSession(Base):
    """Not called ``Session`` to keep it apart from SQLAlchemy's."""

    __tablename__ = "sessions"
    __table_args__ = (
        CheckConstraint("expires_at > created_at", name="expires_after_created"),
        Index("ix_sessions_user_id", "user_id"),
        Index("ix_sessions_expires_at", "expires_at"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"),
    )
    # SHA-256 of the cookie's token; the raw token is never stored.
    token_hash: Mapped[str] = mapped_column(String(64), unique=True)
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())
    expires_at: Mapped[datetime] = mapped_column()
    last_used_at: Mapped[datetime] = mapped_column()
    # Logging out sets this; the row stays until the retention purge.
    revoked_at: Mapped[datetime | None] = mapped_column()

    user: Mapped[User] = relationship(back_populates="sessions")
