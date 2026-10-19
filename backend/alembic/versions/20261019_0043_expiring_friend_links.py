"""Expiring friend links and informational friendship notices."""
from alembic import op
import sqlalchemy as sa

revision = '20261019_0043'
down_revision = '20261016_0042'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('users', sa.Column('friend_invite_code', sa.Uuid(), nullable=True))
    op.add_column('users', sa.Column('friend_invite_expires_at', sa.DateTime(timezone=True), nullable=True))
    op.create_unique_constraint('uq_users_friend_invite_code', 'users', ['friend_invite_code'])
    op.create_table('friend_notices',
        sa.Column('id', sa.Uuid(), primary_key=True),
        sa.Column('user_id', sa.Uuid(), sa.ForeignKey('users.id', ondelete='CASCADE'), nullable=False),
        sa.Column('peer_id', sa.Uuid(), sa.ForeignKey('users.id', ondelete='CASCADE'), nullable=False),
        sa.Column('reason', sa.String(16), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False))
    op.create_index('ix_friend_notices_user_id', 'friend_notices', ['user_id'])


def downgrade():
    op.drop_table('friend_notices')
    op.drop_constraint('uq_users_friend_invite_code', 'users', type_='unique')
    op.drop_column('users', 'friend_invite_expires_at')
    op.drop_column('users', 'friend_invite_code')
