"""Persist application connections per account."""
from alembic import op
import sqlalchemy as sa

revision = '20261029_0054'
down_revision = '20261028_0053'
branch_labels = depends_on = None


def upgrade():
    op.create_table(
        'user_applications',
        sa.Column('user_id', sa.Uuid(), sa.ForeignKey('users.id', ondelete='CASCADE'), primary_key=True),
        sa.Column('application_id', sa.String(80), primary_key=True),
        sa.Column('enabled', sa.Boolean(), nullable=False),
    )


def downgrade():
    op.drop_table('user_applications')
