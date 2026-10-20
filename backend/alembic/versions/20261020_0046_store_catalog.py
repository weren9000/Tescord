"""Store favorites, optional rarity and editable collections."""
from alembic import op
import sqlalchemy as sa

revision = '20261020_0046'
down_revision = '20261019_0045'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('shop_offers', sa.Column('rarity', sa.String(16), nullable=True))
    op.create_check_constraint('ck_shop_rarity', 'shop_offers', "rarity IS NULL OR rarity IN ('common','rare','epic','legendary')")
    op.create_table('shop_favorites',
        sa.Column('user_id', sa.Uuid(), sa.ForeignKey('users.id', ondelete='CASCADE'), primary_key=True),
        sa.Column('catalog_id', sa.String(64), sa.ForeignKey('inventory_catalog.id', ondelete='CASCADE'), primary_key=True))
    op.create_table('shop_collections',
        sa.Column('id', sa.String(64), primary_key=True),
        sa.Column('name', sa.String(80), nullable=False),
        sa.Column('description', sa.String(180), nullable=False),
        sa.Column('artwork', sa.String(16), nullable=True),
        sa.Column('cover_id', sa.String(64), sa.ForeignKey('inventory_catalog.id', ondelete='CASCADE'), nullable=False),
        sa.Column('published', sa.Boolean(), nullable=False),
        sa.Column('position', sa.Integer(), nullable=False),
        sa.Column('version', sa.Integer(), nullable=False))
    op.create_table('shop_collection_items',
        sa.Column('collection_id', sa.String(64), sa.ForeignKey('shop_collections.id', ondelete='CASCADE'), primary_key=True),
        sa.Column('catalog_id', sa.String(64), sa.ForeignKey('inventory_catalog.id', ondelete='CASCADE'), primary_key=True))


def downgrade():
    op.drop_table('shop_collection_items')
    op.drop_table('shop_collections')
    op.drop_table('shop_favorites')
    op.drop_constraint('ck_shop_rarity', 'shop_offers', type_='check')
    op.drop_column('shop_offers', 'rarity')
