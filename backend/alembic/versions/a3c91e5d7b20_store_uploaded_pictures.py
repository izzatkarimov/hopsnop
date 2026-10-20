"""store uploaded pictures

Until now an avatar and the picture of a story were web addresses that the
user typed, on any host. Whoever viewed a profile or a story had their
browser fetch the picture from there, and that host learned who looked and
when. From here on pictures are uploaded, re-encoded by the server and
served by the API itself (``app.services.images``, ``app.core.image_store``).

- ``users.avatar_url`` is replaced by ``users.avatar_id``, the id of the
  account's picture in the image store. The addresses that were stored are
  not kept: they pointed at other hosts, which is exactly what is given up.
  Every account starts without a picture.
- ``stories.media_url`` is replaced by ``stories.media_id``,
  ``media_width`` and ``media_height``. A story cannot be without its
  picture, and the stories there are have none in the store, so they are
  removed, and their views with them. A story lasts a day; none is older
  than its retention period plus that.

Downgrading removes the stories again, for the same reason the other way
round, and leaves every account without an avatar. The files of the
pictures stay in the store until the retention purge finds that nothing
refers to them.

Revision ID: a3c91e5d7b20
Revises: f55b0cf7f446
Create Date: 2026-10-20 01:10:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'a3c91e5d7b20'
down_revision: Union[str, Sequence[str], None] = 'f55b0cf7f446'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column('users', sa.Column('avatar_id', sa.Uuid(), nullable=True))
    op.create_unique_constraint(op.f('uq_users_avatar_id'), 'users', ['avatar_id'])
    op.drop_column('users', 'avatar_url')

    # Their views go with them (ON DELETE CASCADE).
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
    """Downgrade schema."""
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
