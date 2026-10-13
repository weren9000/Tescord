"""Personal conversation pins."""
from alembic import op
import sqlalchemy as sa

revision = '20261014_0033'
down_revision = '20261014_0032'
branch_labels = None
depends_on = None

def upgrade():
    op.add_column('server_members', sa.Column('conversation_pinned', sa.Boolean(), nullable=False, server_default=sa.false()))

def downgrade():
    op.drop_column('server_members', 'conversation_pinned')
