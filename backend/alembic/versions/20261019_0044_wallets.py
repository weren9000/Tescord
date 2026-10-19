"""Coins, crystals and immutable wallet operation history."""
from alembic import op
import sqlalchemy as sa

revision = '20261019_0044'
down_revision = '20261019_0043'
branch_labels = None
depends_on = None


def upgrade():
    for name in ('coins', 'crystals'):
        op.add_column('users', sa.Column(name, sa.BigInteger(), nullable=False, server_default='0'))
    op.create_check_constraint('ck_user_wallet_bounds', 'users', 'coins >= 0 AND coins <= 9000000000000 AND crystals >= 0 AND crystals <= 9000000000000')
    op.create_table('wallet_operations',
        sa.Column('id', sa.Uuid(), primary_key=True),
        sa.Column('user_id', sa.Uuid(), sa.ForeignKey('users.id', ondelete='CASCADE'), nullable=False),
        sa.Column('actor_id', sa.Uuid(), sa.ForeignKey('users.id', ondelete='SET NULL')),
        sa.Column('actor_name', sa.String(32), nullable=False),
        sa.Column('currency', sa.String(16), nullable=False),
        sa.Column('delta', sa.BigInteger(), nullable=False),
        sa.Column('balance_after', sa.BigInteger(), nullable=False),
        sa.Column('reason', sa.String(240), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.CheckConstraint("currency IN ('coins', 'crystals') AND delta != 0 AND balance_after >= 0", name='ck_wallet_operation'))
    op.create_index('ix_wallet_operations_user_id', 'wallet_operations', ['user_id'])


def downgrade():
    op.drop_table('wallet_operations')
    op.drop_constraint('ck_user_wallet_bounds', 'users', type_='check')
    op.drop_column('users', 'coins')
    op.drop_column('users', 'crystals')
