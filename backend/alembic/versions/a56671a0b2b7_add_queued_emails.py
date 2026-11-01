"""add queued emails: a new, empty table; existing data is untouched, caps count from zero

Revision ID: a56671a0b2b7
Revises: a3c91e5d7b20
Create Date: 2026-11-01 21:35:27.605687

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'a56671a0b2b7'
down_revision: Union[str, Sequence[str], None] = 'a3c91e5d7b20'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table('queued_emails',
    sa.Column('id', sa.Uuid(), nullable=False),
    sa.Column('address_hash', sa.String(length=64), nullable=True),
    sa.Column('client_hash', sa.String(length=64), nullable=True),
    sa.Column('queued_at', sa.DateTime(timezone=True), nullable=False),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_queued_emails'))
    )
    op.create_index('ix_queued_emails_address_hash', 'queued_emails', ['address_hash'], unique=False)
    op.create_index('ix_queued_emails_queued_at', 'queued_emails', ['queued_at'], unique=False)


def downgrade() -> None:
    op.drop_index('ix_queued_emails_queued_at', table_name='queued_emails')
    op.drop_index('ix_queued_emails_address_hash', table_name='queued_emails')
    op.drop_table('queued_emails')
