from __future__ import annotations

import uuid
from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import ForeignKey, Index, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base

if TYPE_CHECKING:
    from app.models.post import Post
    from app.models.user import User


class Repost(Base):
    __tablename__ = "reposts"
    __table_args__ = (
        # Reposts of a post and the derived count; the key covers lookups by user.
        Index("ix_reposts_post_id", "post_id"),
    )

    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"),
        primary_key=True,
    )
    post_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("posts.id", ondelete="CASCADE"),
        primary_key=True,
    )
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())

    user: Mapped[User] = relationship(back_populates="reposts")
    post: Mapped[Post] = relationship(back_populates="reposts")
