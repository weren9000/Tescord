"""Versioned cloud encryption and keyed substring search. Backfill is explicit."""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = '20261102_0057'
down_revision = '20261102_0056'
branch_labels = depends_on = None


def upgrade():
    op.create_table('encryption_key_checks', sa.Column('key_id', sa.String(32), primary_key=True),
                    sa.Column('ciphertext', sa.LargeBinary(), nullable=False))
    op.create_table('encryption_cleanup', sa.Column('id', sa.Uuid(), primary_key=True),
                    sa.Column('storage_kind', sa.String(16), nullable=False),
                    sa.Column('relative_path', sa.String(512), nullable=False))
    for table in ('messages', 'room_messages'):
        op.add_column(table, sa.Column('encrypted_content', sa.LargeBinary()))
        op.create_check_constraint(f'ck_{table}_encrypted_content', table,
                                   "encrypted_content IS NULL OR content = ''")
    op.add_column('messages', sa.Column('search_tokens', postgresql.ARRAY(sa.String(64))))
    op.create_index('ix_messages_search_tokens', 'messages', ['search_tokens'], postgresql_using='gin')
    op.add_column('room_uploads', sa.Column('storage_encrypted', sa.Boolean(), nullable=False, server_default='false'))


def downgrade():
    db = op.get_bind()
    if db.scalar(sa.text("SELECT EXISTS(SELECT 1 FROM messages WHERE encrypted_content IS NOT NULL) OR "
                         "EXISTS(SELECT 1 FROM room_messages WHERE encrypted_content IS NOT NULL) OR "
                         "EXISTS(SELECT 1 FROM room_uploads WHERE storage_encrypted)")):
        raise RuntimeError('Encrypted data requires a compatible application; refusing destructive downgrade')
    op.drop_column('room_uploads', 'storage_encrypted')
    op.drop_index('ix_messages_search_tokens', table_name='messages')
    op.drop_column('messages', 'search_tokens')
    for table in ('messages', 'room_messages'):
        op.drop_constraint(f'ck_{table}_encrypted_content', table, type_='check')
        op.drop_column(table, 'encrypted_content')
    op.drop_table('encryption_cleanup')
    op.drop_table('encryption_key_checks')
