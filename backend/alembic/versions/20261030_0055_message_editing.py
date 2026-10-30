"""Distinguish deleted messages from edited text."""
from alembic import op
import sqlalchemy as sa

revision = '20261030_0055'
down_revision = '20261029_0054'
branch_labels = depends_on = None


def upgrade():
    op.add_column('messages', sa.Column('deleted_at', sa.DateTime(timezone=True), nullable=True))
    # The old moderation endpoint left this exact tombstone and removed all
    # attachments. Normal messages had no editing endpoint before this migration.
    op.execute("""UPDATE messages SET deleted_at = edited_at, edited_at = NULL
        WHERE content = 'Сообщение удалено' AND edited_at IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM attachments WHERE message_id = messages.id)""")


def downgrade():
    op.execute('UPDATE messages SET edited_at = deleted_at WHERE deleted_at IS NOT NULL')
    op.drop_column('messages', 'deleted_at')
