"""Allow catalogue emoji while retaining all legacy reaction codes."""
from alembic import op

revision = '20261016_0041'
down_revision = '20261016_0040'
branch_labels = None
depends_on = None

def upgrade():
    op.execute('ALTER TABLE message_reactions ALTER COLUMN reaction TYPE varchar(32) USING reaction::text')

def downgrade():
    # Refuse a lossy downgrade when Unicode reactions exist.
    op.execute('ALTER TABLE message_reactions ALTER COLUMN reaction TYPE messagereactionkind USING reaction::messagereactionkind')
