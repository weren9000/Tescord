"""Persist wallet batch confirmations and results."""
from alembic import op
import sqlalchemy as sa

revision = '20261020_0048'
down_revision = '20261020_0047'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table('wallet_batches',
        sa.Column('id', sa.Uuid(), primary_key=True),
        sa.Column('actor_id', sa.Uuid(), sa.ForeignKey('users.id', ondelete='SET NULL')),
        sa.Column('payload', sa.JSON(), nullable=False),
        sa.Column('result', sa.JSON(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()))
    op.create_index('ix_wallet_batches_actor_id', 'wallet_batches', ['actor_id'])
    op.add_column('wallet_operations', sa.Column('batch_id', sa.Uuid(), sa.ForeignKey('wallet_batches.id', ondelete='SET NULL'), nullable=True))
    op.create_index('ix_wallet_operations_batch_id', 'wallet_operations', ['batch_id'])


def downgrade():
    op.drop_index('ix_wallet_operations_batch_id', table_name='wallet_operations')
    op.drop_column('wallet_operations', 'batch_id')
    op.drop_table('wallet_batches')
