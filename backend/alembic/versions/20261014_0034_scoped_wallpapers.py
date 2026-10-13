"""Shared and personal conversation wallpapers; existing user choices remain intact."""
from alembic import op
import sqlalchemy as sa

revision = '20261014_0034'
down_revision = '20261014_0033'
branch_labels = None
depends_on = None

def upgrade():
    for table in ('servers', 'server_members'):
        op.add_column(table, sa.Column('chat_wallpaper', sa.String(64), nullable=True))
        op.add_column(table, sa.Column('wallpaper_scale', sa.Integer(), nullable=False, server_default='100'))
        op.add_column(table, sa.Column('wallpaper_dim', sa.Integer(), nullable=False, server_default='35'))
    op.add_column('server_members', sa.Column('wallpaper_override', sa.Boolean(), nullable=False, server_default=sa.false()))

def downgrade():
    op.drop_column('server_members', 'wallpaper_override')
    for table in ('servers', 'server_members'):
        for column in ('chat_wallpaper', 'wallpaper_scale', 'wallpaper_dim'):
            op.drop_column(table, column)
