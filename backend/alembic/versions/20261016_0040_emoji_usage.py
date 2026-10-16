"""Per-account frequent emoji choices."""
from alembic import op
import sqlalchemy as sa

revision = '20261016_0040'
down_revision = '20261016_0039'
branch_labels = None
depends_on = None

def upgrade():
    op.create_table('user_emoji_usage',
        sa.Column('user_id', sa.Uuid(), sa.ForeignKey('users.id', ondelete='CASCADE'), primary_key=True),
        sa.Column('emoji', sa.String(32), primary_key=True),
        sa.Column('uses', sa.Integer(), nullable=False),
        sa.Column('last_used', sa.DateTime(timezone=True), nullable=False))

def downgrade():
    op.drop_table('user_emoji_usage')
