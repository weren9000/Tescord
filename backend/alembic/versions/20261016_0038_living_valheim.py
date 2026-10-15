"""Collectible Nordic fjord wallpaper."""
from alembic import op
import sqlalchemy as sa

revision = '20261016_0038'
down_revision = '20261016_0037'
branch_labels = None
depends_on = None


def upgrade():
    table = sa.table('inventory_catalog', sa.column('id'), sa.column('name'), sa.column('kind'), sa.column('builtin'), sa.column('hidden'))
    op.bulk_insert(table, [dict(id='wallpaper-living-valheim', name='Valheim · Северный фьорд', kind='wallpaper', builtin=True, hidden=False)])


def downgrade():
    op.execute("DELETE FROM inventory_catalog WHERE id='wallpaper-living-valheim'")
