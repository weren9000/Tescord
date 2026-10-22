"""Stage independent file uploads before publishing a message."""
from alembic import op
import sqlalchemy as sa
revision='20261022_0051'
down_revision='20261022_0050'
branch_labels=None
depends_on=None
def upgrade():
    op.add_column('attachments',sa.Column('position',sa.Integer(),nullable=False,server_default='0'))
    op.create_table('pending_uploads',
        sa.Column('id',sa.Uuid(),primary_key=True),
        sa.Column('owner_id',sa.Uuid(),sa.ForeignKey('users.id',ondelete='CASCADE'),nullable=False),
        sa.Column('channel_id',sa.Uuid(),sa.ForeignKey('channels.id',ondelete='CASCADE'),nullable=False),
        sa.Column('message_id',sa.Uuid(),sa.ForeignKey('messages.id',ondelete='CASCADE')),
        sa.Column('filename',sa.String(255),nullable=False),sa.Column('mime_type',sa.String(128),nullable=False),
        sa.Column('storage_path',sa.String(512),nullable=False),sa.Column('size_bytes',sa.BigInteger(),nullable=False),
        sa.Column('checksum_sha256',sa.String(64),nullable=False),sa.Column('expires_at',sa.DateTime(timezone=True),nullable=False))
    for field in ('owner_id','channel_id','expires_at'):op.create_index('ix_pending_uploads_'+field,'pending_uploads',[field])
def downgrade():
    op.drop_table('pending_uploads')
    op.drop_column('attachments','position')
