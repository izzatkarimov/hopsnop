from __future__ import annotations

import uuid
from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import CheckConstraint, ForeignKey, Index, String, func
from sqlalchemy.orm import Mapped, mapped_column, query_expression, relationship

from app.core.media_urls import story_media_url
from app.db.base import Base

if TYPE_CHECKING:
    from app.models.story_view import StoryView
    from app.models.user import User


class Story(Base):
    """``expires_at`` has no database default: the application decides the lifetime."""

    __tablename__ = "stories"
    __table_args__ = (
        CheckConstraint("media_type IN ('image', 'video')", name="media_type_valid"),
        CheckConstraint("expires_at > created_at", name="expires_after_created"),
        CheckConstraint(
            "media_width > 0 AND media_height > 0", name="media_dimensions_positive"
        ),
        Index("ix_stories_author_id_expires_at", "author_id", "expires_at"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    author_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="RESTRICT"),
    )
    # The file is made by this server and removed with the story.
    media_id: Mapped[uuid.UUID] = mapped_column(unique=True)
    media_width: Mapped[int]
    media_height: Mapped[int]
    media_type: Mapped[str] = mapped_column(String)
    caption: Mapped[str | None] = mapped_column(String(150))
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())
    expires_at: Mapped[datetime]

    # Not stored: computed by ``_visible_stories``; the count is for the author only.
    view_count: Mapped[int | None] = query_expression()
    viewed_by_me: Mapped[bool] = query_expression()

    @property
    def media_url(self) -> str:
        return story_media_url(self.id)

    author: Mapped[User] = relationship(back_populates="stories")

    views: Mapped[list[StoryView]] = relationship(
        back_populates="story",
        cascade="all, delete-orphan",
        passive_deletes=True,
    )
