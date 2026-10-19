"""Crystal store and delegated store management."""
from alembic import op
import sqlalchemy as sa

revision = '20261019_0045'
down_revision = '20261019_0044'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('users', sa.Column('is_shop_admin', sa.Boolean(), nullable=False, server_default='false'))
    op.create_table('shop_offers',
        sa.Column('catalog_id', sa.String(64), sa.ForeignKey('inventory_catalog.id', ondelete='CASCADE'), primary_key=True),
        sa.Column('price', sa.BigInteger(), nullable=False),
        sa.Column('status', sa.String(16), nullable=False),
        sa.Column('position', sa.Integer(), nullable=False),
        sa.Column('recommended', sa.Boolean(), nullable=False),
        sa.Column('version', sa.Integer(), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.CheckConstraint("price BETWEEN 1 AND 1000000000 AND status IN ('draft','published','withdrawn')", name='ck_shop_offer'))
    op.create_table('shop_purchases',
        sa.Column('id', sa.Uuid(), primary_key=True),
        sa.Column('user_id', sa.Uuid(), sa.ForeignKey('users.id', ondelete='SET NULL')),
        sa.Column('buyer_name', sa.String(32), nullable=False),
        sa.Column('catalog_id', sa.String(64), nullable=False),
        sa.Column('item_id', sa.Uuid(), sa.ForeignKey('inventory_items.id', ondelete='SET NULL')),
        sa.Column('name', sa.String(80), nullable=False),
        sa.Column('price', sa.BigInteger(), nullable=False),
        sa.Column('offer_version', sa.Integer(), nullable=False),
        sa.Column('balance_after', sa.BigInteger(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.CheckConstraint('price > 0 AND balance_after >= 0', name='ck_shop_purchase'))
    op.create_index('ix_shop_purchases_user_id', 'shop_purchases', ['user_id'])
    op.create_index('ix_shop_purchases_created_at', 'shop_purchases', ['created_at'])
    op.create_table('shop_audit',
        sa.Column('id', sa.Uuid(), primary_key=True),
        sa.Column('actor_id', sa.Uuid(), sa.ForeignKey('users.id', ondelete='SET NULL')),
        sa.Column('actor_name', sa.String(32), nullable=False),
        sa.Column('target', sa.String(64), nullable=False),
        sa.Column('before', sa.JSON(), nullable=False),
        sa.Column('after', sa.JSON(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()))


def downgrade():
    for name in ('shop_audit', 'shop_purchases', 'shop_offers'):
        op.drop_table(name)
    op.drop_column('users', 'is_shop_admin')
