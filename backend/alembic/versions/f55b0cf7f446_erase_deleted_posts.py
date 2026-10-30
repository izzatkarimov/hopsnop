"""erase deleted posts

Revision ID: f55b0cf7f446
Revises: 7f984c985213
Create Date: 2026-10-09 10:12:41.000000

"""
from typing import Sequence, Union

from alembic import op
from alembic.util import CommandError
import sqlalchemy as sa


revision: str = 'f55b0cf7f446'
down_revision: Union[str, Sequence[str], None] = '7f984c985213'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


# A row is a post, or what is left of one; nothing in between.
_LIVE_OR_ERASED = (
    "(deleted_at IS NULL AND author_id IS NOT NULL AND content IS NOT NULL)"
    " OR "
    "(deleted_at IS NOT NULL AND author_id IS NULL AND content IS NULL)"
)


def upgrade() -> None:
    connection = op.get_bind()

    # Repeated: removing one can leave the deleted post it answered without a reply.
    remove_unanswered = sa.text(
        "DELETE FROM posts AS post "
        "WHERE post.deleted_at IS NOT NULL "
        "AND NOT EXISTS ("
        "SELECT 1 FROM posts AS reply WHERE reply.parent_post_id = post.id)"
    )
    while connection.execute(remove_unanswered).rowcount:
        pass

    for interactions in ("likes", "reposts"):
        connection.execute(
            sa.text(
                f"DELETE FROM {interactions} WHERE post_id IN "
                "(SELECT id FROM posts WHERE deleted_at IS NOT NULL)"
            )
        )
    op.alter_column('posts', 'author_id', existing_type=sa.Uuid(), nullable=True)
    op.alter_column('posts', 'content', existing_type=sa.Text(), nullable=True)
    connection.execute(
        sa.text(
            "UPDATE posts SET author_id = NULL, content = NULL "
            "WHERE deleted_at IS NOT NULL"
        )
    )

    op.create_check_constraint(
        op.f('ck_posts_live_or_erased'), 'posts', _LIVE_OR_ERASED
    )


def downgrade() -> None:
    # A tombstone's author and text are gone for good, so this refuses while one exists.
    tombstones = op.get_bind().scalar(
        sa.text(
            "SELECT count(*) FROM posts "
            "WHERE deleted_at IS NOT NULL OR author_id IS NULL OR content IS NULL"
        )
    )
    if tombstones:
        raise CommandError(
            f"Cannot downgrade: {tombstones} erased post(s) are kept as "
            "tombstones, without author and text. Erasure cannot be undone, "
            "and the previous schema has no place for them."
        )

    op.drop_constraint(op.f('ck_posts_live_or_erased'), 'posts', type_='check')
    op.alter_column('posts', 'content', existing_type=sa.Text(), nullable=False)
    op.alter_column('posts', 'author_id', existing_type=sa.Uuid(), nullable=False)
