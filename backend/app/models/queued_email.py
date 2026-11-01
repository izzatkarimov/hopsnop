from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import Index, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class QueuedEmail(Base):
    """One row per email handed to the sender, which may still fail; read by the caps."""

    __tablename__ = "queued_emails"
    __table_args__ = (
        Index("ix_queued_emails_queued_at", "queued_at"),
        Index("ix_queued_emails_address_hash", "address_hash"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    # Keyed HMAC-SHA256s, no address is stored. Null once the account is deleted: the
    # email still counts toward the total, and the row no longer says whose it was.
    address_hash: Mapped[str | None] = mapped_column(String(64))
    client_hash: Mapped[str | None] = mapped_column(String(64))
    queued_at: Mapped[datetime] = mapped_column()
