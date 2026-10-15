"""Durable, idempotent bulk inventory grants."""
from alembic import op
import sqlalchemy as sa

revision = '20261015_0035'
down_revision = '20261014_0034'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table('inventory_batches',
        sa.Column('id', sa.Uuid(), primary_key=True),
        sa.Column('actor_id', sa.Uuid(), sa.ForeignKey('users.id', ondelete='SET NULL')),
        sa.Column('payload', sa.JSON(), nullable=False),
        sa.Column('result', sa.JSON(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False))
    op.create_index('ix_inventory_batches_actor_id', 'inventory_batches', ['actor_id'])


def downgrade():
    op.drop_table('inventory_batches')
