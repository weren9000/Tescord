"""Assign a persistent default avatar without changing uploaded photos."""
from alembic import op
import sqlalchemy as sa

revision = '20261013_0026'
down_revision = '20261013_0025'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('users', sa.Column('avatar_preset', sa.String(32), nullable=False, server_default='frog'))
    # PostgreSQL evaluates random() for each row; the result is stored once.
    op.execute("""UPDATE users SET avatar_preset =
        (ARRAY['frog','cat','dog','fox','bear','wolf','panda','rabbit','raccoon','owl'])
        [1 + floor(random() * 10)::integer]""")


def downgrade():
    op.drop_column('users', 'avatar_preset')
