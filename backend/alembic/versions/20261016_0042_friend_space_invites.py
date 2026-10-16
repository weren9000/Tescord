"""Addressed invitations to existing friends."""
from alembic import op
import sqlalchemy as sa

revision = '20261016_0042'
down_revision = '20261016_0041'
branch_labels = None
depends_on = None

def upgrade():
    op.create_table('friend_space_invites',
        sa.Column('id', sa.Uuid(), primary_key=True),
        sa.Column('server_id', sa.Uuid(), sa.ForeignKey('servers.id', ondelete='CASCADE'), nullable=False),
        sa.Column('sender_user_id', sa.Uuid(), sa.ForeignKey('users.id', ondelete='CASCADE'), nullable=False),
        sa.Column('target_user_id', sa.Uuid(), sa.ForeignKey('users.id', ondelete='CASCADE'), nullable=False),
        sa.Column('status', sa.String(16), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column('expires_at', sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint('server_id', 'target_user_id', name='uq_friend_space_invite_target'))
    op.create_index('ix_friend_space_invites_target_user_id', 'friend_space_invites', ['target_user_id'])

def downgrade():
    op.drop_table('friend_space_invites')
