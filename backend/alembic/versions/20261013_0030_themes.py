"""Five transferable interface themes; default remains available to everyone."""
from alembic import op
import sqlalchemy as sa

revision='20261013_0030'
down_revision='20261013_0029'
branch_labels=None
depends_on=None


def upgrade():
    op.drop_constraint('ck_catalog_kind','inventory_catalog',type_='check')
    op.create_check_constraint('ck_catalog_kind','inventory_catalog',"kind IN ('avatar','frame','wallpaper','theme')")
    table=sa.table('inventory_catalog',sa.column('id'),sa.column('name'),sa.column('kind'),sa.column('builtin'),sa.column('hidden'))
    op.bulk_insert(table,[dict(id=key,name=name,kind='theme',builtin=True,hidden=False) for key,name in
        [('theme-light','Светлая'),('theme-dark','Тёмная'),('theme-space','Космос'),('theme-cyberpunk','Киберпанк'),('theme-viking','Викинг')]])


def downgrade():
    # Fails safely if owned theme instances exist; restore a backup instead of deleting ownership.
    op.execute("DELETE FROM inventory_catalog WHERE kind='theme'")
    op.drop_constraint('ck_catalog_kind','inventory_catalog',type_='check')
    op.create_check_constraint('ck_catalog_kind','inventory_catalog',"kind IN ('avatar','frame','wallpaper')")
