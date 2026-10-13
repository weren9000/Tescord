"""Collectible instances, ownership history and avatar administrator role."""
from alembic import op
import sqlalchemy as sa

revision = '20261013_0027'
down_revision = '20261013_0026'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('users', sa.Column('is_avatar_admin', sa.Boolean(), nullable=False, server_default='false'))
    # One-time assignment to an existing account only; never a registration rule.
    op.execute("UPDATE users SET is_avatar_admin=true WHERE lower(email)='weren9000@yandex.ru'")
    op.create_table('inventory_items',
        sa.Column('id', sa.Uuid(), primary_key=True),
        sa.Column('catalog_id', sa.String(64), nullable=False),
        sa.Column('kind', sa.String(16), nullable=False),
        sa.Column('owner_id', sa.Uuid(), sa.ForeignKey('users.id', ondelete='SET NULL')),
        sa.Column('equipped', sa.Boolean(), nullable=False, server_default='false'),
        sa.Column('revoked', sa.Boolean(), nullable=False, server_default='false'),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()))
    op.create_index('ix_inventory_items_owner_id', 'inventory_items', ['owner_id'])
    op.create_index('uq_inventory_equipped', 'inventory_items', ['owner_id', 'kind'], unique=True,
                    postgresql_where=sa.text('equipped AND NOT revoked'))
    op.create_table('inventory_events',
        sa.Column('id', sa.Uuid(), primary_key=True),
        sa.Column('request_id', sa.Uuid(), unique=True, nullable=False),
        sa.Column('item_id', sa.Uuid(), sa.ForeignKey('inventory_items.id'), nullable=False),
        sa.Column('actor_id', sa.Uuid(), sa.ForeignKey('users.id', ondelete='SET NULL')),
        sa.Column('recipient_id', sa.Uuid(), sa.ForeignKey('users.id', ondelete='SET NULL')),
        sa.Column('action', sa.String(16), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column('read_at', sa.DateTime(timezone=True)))
    op.create_index('ix_inventory_events_item_id', 'inventory_events', ['item_id'])
    op.create_index('ix_inventory_events_recipient_id', 'inventory_events', ['recipient_id'])


def downgrade():
    op.drop_table('inventory_events')
    op.drop_table('inventory_items')
    op.drop_column('users', 'is_avatar_admin')
