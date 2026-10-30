from __future__ import annotations

import uuid
from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import CheckConstraint, String, func, true
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.media_urls import avatar_url
from app.db.base import Base

if TYPE_CHECKING:
    from app.models.email_verification_token import EmailVerificationToken
    from app.models.follow import Follow
    from app.models.like import Like
    from app.models.password_reset_token import PasswordResetToken
    from app.models.post import Post
    from app.models.repost import Repost
    from app.models.story import Story
    from app.models.user_session import UserSession


class User(Base):
    __tablename__ = "users"
    __table_args__ = (
        # Lowercase normalization makes the unique constraints case-insensitive.
        CheckConstraint("username = lower(username)", name="username_lowercase"),
        CheckConstraint("email = lower(email)", name="email_lowercase"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    username: Mapped[str] = mapped_column(String(30), unique=True)
    email: Mapped[str] = mapped_column(String(255), unique=True)
    password_hash: Mapped[str] = mapped_column(String)
    display_name: Mapped[str] = mapped_column(String(50))
    bio: Mapped[str | None] = mapped_column(String(160))
    # A new picture replaces the old one, whose file is removed.
    avatar_id: Mapped[uuid.UUID | None] = mapped_column(unique=True)
    is_active: Mapped[bool] = mapped_column(server_default=true())
    email_verified_at: Mapped[datetime | None] = mapped_column()
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        server_default=func.now(),
        onupdate=func.now(),
    )

    @property
    def avatar_url(self) -> str | None:
        """Names the picture too, so it changes whenever the picture does."""
        if self.avatar_id is None:
            return None
        return avatar_url(self.username, self.avatar_id)

    # RESTRICT, passive_deletes="all": the ORM leaves these; erasure removes them first.
    posts: Mapped[list[Post]] = relationship(
        back_populates="author",
        passive_deletes="all",
    )
    stories: Mapped[list[Story]] = relationship(
        back_populates="author",
        passive_deletes="all",
    )

    likes: Mapped[list[Like]] = relationship(
        back_populates="user",
        cascade="all, delete-orphan",
        passive_deletes=True,
    )
    reposts: Mapped[list[Repost]] = relationship(
        back_populates="user",
        cascade="all, delete-orphan",
        passive_deletes=True,
    )

    # Rows where this user is the follower.
    following: Mapped[list[Follow]] = relationship(
        foreign_keys="Follow.follower_id",
        back_populates="follower",
        cascade="all, delete-orphan",
        passive_deletes=True,
    )
    # Rows where this user is being followed.
    followers: Mapped[list[Follow]] = relationship(
        foreign_keys="Follow.following_id",
        back_populates="following",
        cascade="all, delete-orphan",
        passive_deletes=True,
    )

    sessions: Mapped[list[UserSession]] = relationship(
        back_populates="user",
        cascade="all, delete-orphan",
        passive_deletes=True,
    )
    email_verification_tokens: Mapped[list[EmailVerificationToken]] = relationship(
        back_populates="user",
        cascade="all, delete-orphan",
        passive_deletes=True,
    )
    password_reset_tokens: Mapped[list[PasswordResetToken]] = relationship(
        back_populates="user",
        cascade="all, delete-orphan",
        passive_deletes=True,
    )
