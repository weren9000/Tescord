"""Add Sakura, Emerald, Ocean, Amber and Lavender theme items."""
from alembic import op
import sqlalchemy as sa

revision='20261013_0031'
down_revision='20261013_0030'
branch_labels=None
depends_on=None


def upgrade():
    table=sa.table('inventory_catalog',sa.column('id'),sa.column('name'),sa.column('kind'),sa.column('builtin'),sa.column('hidden'))
    op.bulk_insert(table,[dict(id=key,name=name,kind='theme',builtin=True,hidden=False) for key,name in
        [('theme-sakura','Сакура'),('theme-emerald','Изумруд'),('theme-ocean','Океан'),('theme-amber','Янтарь'),('theme-lavender','Лаванда')]])


def downgrade():
    # Foreign keys prevent accidental removal of themes already issued to users.
    op.execute("DELETE FROM inventory_catalog WHERE id IN ('theme-sakura','theme-emerald','theme-ocean','theme-amber','theme-lavender')")
