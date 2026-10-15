"""Original collectible living marsh wallpaper, available through inventory only."""
from alembic import op
import sqlalchemy as sa
revision='20261016_0037'
down_revision='20261015_0036'
branch_labels=None
depends_on=None


def upgrade():
    table=sa.table('inventory_catalog',sa.column('id'),sa.column('name'),sa.column('kind'),sa.column('builtin'),sa.column('hidden'))
    op.bulk_insert(table,[dict(id='wallpaper-living-marsh',name='Своё болото · Живые обои',kind='wallpaper',builtin=True,hidden=False)])


def downgrade():
    op.execute("DELETE FROM inventory_catalog WHERE id='wallpaper-living-marsh'")
