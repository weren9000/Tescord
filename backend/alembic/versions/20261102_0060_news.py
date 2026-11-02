"""Public news and administrator drafts."""
from alembic import op
import sqlalchemy as sa

revision = '20261102_0060'
down_revision = '20261102_0059'
branch_labels = depends_on = None


def upgrade():
    op.create_table(
        'news_posts',
        sa.Column('id', sa.Uuid(), primary_key=True),
        sa.Column('title', sa.String(160), nullable=False),
        sa.Column('excerpt', sa.String(320), nullable=False),
        sa.Column('body', sa.Text(), nullable=False),
        sa.Column('published', sa.Boolean(), server_default='false', nullable=False),
        sa.Column('published_at', sa.DateTime(timezone=True)),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column('updated_by', sa.Uuid(), sa.ForeignKey('users.id', ondelete='SET NULL')),
        sa.Column('version', sa.Integer(), server_default='1', nullable=False),
        sa.Column('has_image', sa.Boolean(), server_default='false', nullable=False),
        sa.Column('image', sa.LargeBinary()),
    )
    op.create_index('ix_news_publication', 'news_posts', ['published', 'published_at', 'id'])


def downgrade():
    op.drop_table('news_posts')
