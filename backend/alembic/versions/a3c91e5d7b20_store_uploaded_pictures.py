"""store uploaded pictures

Revision ID: a3c91e5d7b20
Revises: f55b0cf7f446
Create Date: 2026-10-20 01:10:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'a3c91e5d7b20'
down_revision: Union[str, Sequence[str], None] = 'f55b0cf7f446'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('users', sa.Column('avatar_id', sa.Uuid(), nullable=True))
    op.create_unique_constraint(op.f('uq_users_avatar_id'), 'users', ['avatar_id'])
    op.drop_column('users', 'avatar_url')

    # A story needs a picture and none is in the store; views cascade with it.
    op.execute(sa.text('DELETE FROM stories'))
    op.drop_column('stories', 'media_url')
    op.add_column('stories', sa.Column('media_id', sa.Uuid(), nullable=False))
    op.add_column('stories', sa.Column('media_width', sa.Integer(), nullable=False))
    op.add_column('stories', sa.Column('media_height', sa.Integer(), nullable=False))
    op.create_unique_constraint(op.f('uq_stories_media_id'), 'stories', ['media_id'])
    op.create_check_constraint(
        op.f('ck_stories_media_dimensions_positive'),
        'stories',
        'media_width > 0 AND media_height > 0',
    )


def downgrade() -> None:
    op.execute(sa.text('DELETE FROM stories'))
    op.drop_constraint(
        op.f('ck_stories_media_dimensions_positive'), 'stories', type_='check'
    )
    op.drop_constraint(op.f('uq_stories_media_id'), 'stories', type_='unique')
    op.drop_column('stories', 'media_height')
    op.drop_column('stories', 'media_width')
    op.drop_column('stories', 'media_id')
    op.add_column('stories', sa.Column('media_url', sa.String(), nullable=False))

    op.add_column('users', sa.Column('avatar_url', sa.String(), nullable=True))
    op.drop_constraint(op.f('uq_users_avatar_id'), 'users', type_='unique')
    op.drop_column('users', 'avatar_id')
