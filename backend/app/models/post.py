from __future__ import annotations

import uuid
from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import CheckConstraint, ForeignKey, Index, Text, func
from sqlalchemy.orm import Mapped, mapped_column, query_expression, relationship

from app.db.base import Base

if TYPE_CHECKING:
    from app.models.like import Like
    from app.models.repost import Repost
    from app.models.user import User


class Post(Base):
    """A post, or the tombstone kept for its replies (``live_or_erased``)."""

    __tablename__ = "posts"
    __table_args__ = (
        CheckConstraint(
            "char_length(content) BETWEEN 1 AND 300",
            name="content_length",
        ),
        CheckConstraint(r"content ~ '\S'", name="content_not_blank"),
        CheckConstraint("parent_post_id != id", name="no_self_reply"),
        CheckConstraint(
            "(deleted_at IS NULL AND author_id IS NOT NULL AND content IS NOT NULL)"
            " OR "
            "(deleted_at IS NOT NULL AND author_id IS NULL AND content IS NULL)",
            name="live_or_erased",
        ),
        Index("ix_posts_author_id_created_at", "author_id", "created_at"),
        Index("ix_posts_created_at", "created_at"),
        # Also serves the foreign key: finding replies would otherwise scan the table.
        Index(
            "ix_posts_parent_post_id_created_at",
            "parent_post_id",
            "created_at",
            postgresql_where="parent_post_id IS NOT NULL",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    # NULL in a tombstone; RESTRICT, so only erasing detaches a post from its author.
    author_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="RESTRICT"),
    )
    # RESTRICT: a post with replies can't be removed, so a reply never loses its parent.
    parent_post_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("posts.id", ondelete="RESTRICT"),
    )
    # NULL in a tombstone; the checks above don't cover a missing text.
    content: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())
    # Set only by edits, so nothing else done to the row looks like one.
    updated_at: Mapped[datetime] = mapped_column(server_default=func.now())
    deleted_at: Mapped[datetime | None] = mapped_column()

    # Not stored: computed by ``_visible_posts``; None on a post loaded any other way.
    like_count: Mapped[int] = query_expression()
    liked_by_me: Mapped[bool] = query_expression()
    repost_count: Mapped[int] = query_expression()
    reposted_by_me: Mapped[bool] = query_expression()

    author: Mapped[User | None] = relationship(back_populates="posts")

    parent: Mapped[Post | None] = relationship(
        remote_side=[id],
        back_populates="replies",
    )
    # Stops the ORM detaching replies, which would silently make them top-level posts.
    replies: Mapped[list[Post]] = relationship(
        back_populates="parent",
        passive_deletes="all",
    )

    likes: Mapped[list[Like]] = relationship(
        back_populates="post",
        cascade="all, delete-orphan",
        passive_deletes=True,
    )
    reposts: Mapped[list[Repost]] = relationship(
        back_populates="post",
        cascade="all, delete-orphan",
        passive_deletes=True,
    )
