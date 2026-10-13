"""Personal chat wallpapers and transferable wallpaper items."""
from alembic import op
import sqlalchemy as sa

revision = '20261013_0029'
down_revision = '20261013_0028'
branch_labels = None
depends_on = None


def upgrade():
    op.drop_constraint('ck_catalog_kind', 'inventory_catalog', type_='check')
    op.create_check_constraint('ck_catalog_kind', 'inventory_catalog', "kind IN ('avatar', 'frame', 'wallpaper')")
    op.add_column('users', sa.Column('chat_wallpaper', sa.String(64), nullable=True))
    op.add_column('users', sa.Column('personal_wallpaper', sa.String(36), nullable=True))
    op.add_column('users', sa.Column('wallpaper_scale', sa.Integer(), nullable=False, server_default='100'))
    op.add_column('users', sa.Column('wallpaper_dim', sa.Integer(), nullable=False, server_default='35'))


def downgrade():
    # Wallpaper items must be explicitly removed before downgrading the catalog.
    op.drop_constraint('ck_catalog_kind', 'inventory_catalog', type_='check')
    op.create_check_constraint('ck_catalog_kind', 'inventory_catalog', "kind IN ('avatar', 'frame')")
    for column in ('chat_wallpaper', 'personal_wallpaper', 'wallpaper_scale', 'wallpaper_dim'):
        op.drop_column('users', column)
