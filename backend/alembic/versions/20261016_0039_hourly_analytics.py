"""Hourly visit counters; no backfill from daily totals."""
from alembic import op
import sqlalchemy as sa

revision = '20261016_0039'
down_revision = '20261016_0038'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table('analytics_hours',
        sa.Column('hour', sa.DateTime(timezone=True), primary_key=True),
        sa.Column('subject', sa.String(66), primary_key=True),
        sa.Column('user_id', sa.Uuid(), sa.ForeignKey('users.id', ondelete='CASCADE')),
        sa.Column('visits', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('actions', sa.Integer(), nullable=False, server_default='0'))
    op.create_index('ix_analytics_hours_user_id', 'analytics_hours', ['user_id'])
    op.execute("INSERT INTO analytics_settings (key,value) VALUES ('hourly_started_at', CURRENT_TIMESTAMP::text) ON CONFLICT DO NOTHING")


def downgrade():
    op.drop_table('analytics_hours')
    op.execute("DELETE FROM analytics_settings WHERE key='hourly_started_at'")
