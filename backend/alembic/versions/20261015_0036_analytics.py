"""Activity aggregates and server resource history."""
from alembic import op
import sqlalchemy as sa
revision = '20261015_0036'
down_revision = '20261015_0035'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table('analytics_visitors', sa.Column('subject',sa.String(66),primary_key=True), sa.Column('user_id',sa.Uuid(),sa.ForeignKey('users.id',ondelete='CASCADE')),sa.Column('last_seen',sa.DateTime(timezone=True),nullable=False))
    op.create_index('ix_analytics_visitors_user_id','analytics_visitors',['user_id'])
    op.create_index('ix_analytics_visitors_last_seen','analytics_visitors',['last_seen'])
    op.create_table('analytics_days',sa.Column('day',sa.Date(),primary_key=True),sa.Column('subject',sa.String(66),primary_key=True),sa.Column('user_id',sa.Uuid(),sa.ForeignKey('users.id',ondelete='CASCADE')),*[sa.Column(k,sa.Integer(),nullable=False,server_default='0') for k in ['visits','actions','voice_seconds','voice_sessions']])
    op.create_index('ix_analytics_days_user_id','analytics_days',['user_id'])
    op.create_table('resource_samples',sa.Column('at',sa.DateTime(timezone=True),primary_key=True),sa.Column('data',sa.JSON(),nullable=False))
    op.create_table('analytics_settings',sa.Column('key',sa.String(40),primary_key=True),sa.Column('value',sa.String(100),nullable=False))
    op.execute("INSERT INTO analytics_settings (key,value) VALUES ('started_at',CURRENT_TIMESTAMP::text)")
    op.create_index('ix_messages_created_at','messages',['created_at'])


def downgrade():
    op.drop_index('ix_messages_created_at',table_name='messages')
    for name in ['analytics_settings','resource_samples','analytics_days','analytics_visitors']:op.drop_table(name)
