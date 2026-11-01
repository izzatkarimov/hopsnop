"""add two factor login: new, empty tables, so existing accounts start with it off

Downgrading drops them, which turns two-factor login off for every account.

Revision ID: 2c3270706eaa
Revises: a56671a0b2b7
Create Date: 2026-11-01 22:29:36.635153

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '2c3270706eaa'
down_revision: Union[str, Sequence[str], None] = 'a56671a0b2b7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table('login_challenges',
    sa.Column('id', sa.Uuid(), nullable=False),
    sa.Column('user_id', sa.Uuid(), nullable=False),
    sa.Column('token_hash', sa.String(length=64), nullable=False),
    sa.Column('failed_attempts', sa.Integer(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('expires_at', sa.DateTime(timezone=True), nullable=False),
    sa.CheckConstraint('expires_at > created_at', name=op.f('ck_login_challenges_expires_after_created')),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], name=op.f('fk_login_challenges_user_id_users'), ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_login_challenges')),
    sa.UniqueConstraint('token_hash', name=op.f('uq_login_challenges_token_hash')),
    sa.UniqueConstraint('user_id', name=op.f('uq_login_challenges_user_id'))
    )
    op.create_index('ix_login_challenges_expires_at', 'login_challenges', ['expires_at'], unique=False)
    op.create_table('recovery_codes',
    sa.Column('id', sa.Uuid(), nullable=False),
    sa.Column('user_id', sa.Uuid(), nullable=False),
    sa.Column('code_hash', sa.String(length=64), nullable=False),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], name=op.f('fk_recovery_codes_user_id_users'), ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_recovery_codes')),
    sa.UniqueConstraint('user_id', 'code_hash', name='uq_recovery_codes_user_id_code_hash')
    )
    op.create_table('two_factor_credentials',
    sa.Column('user_id', sa.Uuid(), nullable=False),
    sa.Column('secret_ciphertext', sa.LargeBinary(), nullable=False),
    sa.Column('pending_until', sa.DateTime(timezone=True), nullable=True),
    sa.Column('enabled_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('last_used_step', sa.BigInteger(), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], name=op.f('fk_two_factor_credentials_user_id_users'), ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('user_id', name=op.f('pk_two_factor_credentials'))
    )


def downgrade() -> None:
    op.drop_table('two_factor_credentials')
    op.drop_table('recovery_codes')
    op.drop_index('ix_login_challenges_expires_at', table_name='login_challenges')
    op.drop_table('login_challenges')
