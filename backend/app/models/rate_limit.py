from __future__ import annotations

from datetime import datetime

from sqlalchemy import CheckConstraint, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class RateLimit(Base):
    """One row per counter, not per window, so the table grows with keys, not time."""

    __tablename__ = "rate_limits"
    __table_args__ = (CheckConstraint("count >= 0", name="count_not_negative"),)

    # Keyed HMAC-SHA256 of what is counted: no address or identifier is stored.
    key_hash: Mapped[str] = mapped_column(String(64), primary_key=True)
    window_start: Mapped[datetime] = mapped_column()
    count: Mapped[int] = mapped_column()
