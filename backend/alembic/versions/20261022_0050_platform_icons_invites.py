"""Platform icons and addressed friend invitations."""
from alembic import op
import sqlalchemy as sa

revision = '20261022_0050'
down_revision = '20261021_0049'
branch_labels = None
depends_on = None

def upgrade():
    op.add_column('platforms', sa.Column('icon_catalog_id', sa.String(64)))
    op.add_column('platforms', sa.Column('icon_content', sa.LargeBinary()))
    op.add_column('platforms', sa.Column('icon_updated_at', sa.DateTime(timezone=True)))
    op.create_table('platform_friend_invites',
        sa.Column('id', sa.Uuid(), primary_key=True),
        sa.Column('platform_id', sa.Uuid(), sa.ForeignKey('platforms.id', ondelete='CASCADE'), nullable=False),
        sa.Column('target_user_id', sa.Uuid(), sa.ForeignKey('users.id', ondelete='CASCADE'), nullable=False),
        sa.Column('sender_user_id', sa.Uuid(), sa.ForeignKey('users.id', ondelete='CASCADE'), nullable=False),
        sa.Column('status', sa.String(16), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('expires_at', sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint('platform_id', 'target_user_id', name='uq_platform_friend_invite'))
    op.create_index('ix_platform_friend_invites_target_user_id', 'platform_friend_invites', ['target_user_id'])

def downgrade():
    op.drop_table('platform_friend_invites')
    for name in ('icon_updated_at', 'icon_content', 'icon_catalog_id'):
        op.drop_column('platforms', name)
