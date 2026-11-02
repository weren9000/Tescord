"""Separate device-bound transport for client-encrypted secret chats."""
from alembic import op
import sqlalchemy as sa

revision = '20261102_0058'
down_revision = '20261102_0057'
branch_labels = depends_on = None


def upgrade():
    op.create_table('secret_devices',
        sa.Column('id',sa.Uuid(),primary_key=True),
        sa.Column('user_id',sa.Uuid(),sa.ForeignKey('users.id',ondelete='CASCADE'),nullable=False),
        sa.Column('auth_session_id',sa.Uuid(),sa.ForeignKey('auth_sessions.id',ondelete='CASCADE'),nullable=False),
        sa.Column('name',sa.String(80),nullable=False),sa.Column('device_keys',sa.JSON(),nullable=False),
        sa.Column('created_at',sa.DateTime(timezone=True),server_default=sa.func.now(),nullable=False),
        sa.Column('revoked',sa.Boolean(),nullable=False),sa.Column('session_challenge',sa.JSON()))
    op.create_index('ix_secret_devices_user_id','secret_devices',['user_id'])
    op.create_index('ix_secret_devices_auth_session_id','secret_devices',['auth_session_id'])
    op.create_table('secret_prekeys',
        sa.Column('device_id',sa.Uuid(),sa.ForeignKey('secret_devices.id',ondelete='CASCADE'),primary_key=True),
        sa.Column('key_id',sa.String(128),primary_key=True),sa.Column('payload',sa.JSON(),nullable=False),
        sa.Column('claimed',sa.Boolean(),nullable=False))
    op.create_table('secret_chats',sa.Column('id',sa.Uuid(),primary_key=True),
        sa.Column('initiator_id',sa.Uuid(),sa.ForeignKey('secret_devices.id',ondelete='CASCADE'),nullable=False),
        sa.Column('recipient_id',sa.Uuid(),sa.ForeignKey('secret_devices.id',ondelete='CASCADE'),nullable=False),
        sa.Column('created_at',sa.DateTime(timezone=True),server_default=sa.func.now(),nullable=False),
        sa.Column('accepted_at',sa.DateTime(timezone=True)),sa.Column('closed_at',sa.DateTime(timezone=True)))
    for name in ('initiator_id','recipient_id'):
        op.create_index('ix_secret_chats_'+name,'secret_chats',[name])
    op.create_table('secret_envelopes',sa.Column('sequence',sa.BigInteger(),primary_key=True,autoincrement=True),
        sa.Column('client_id',sa.Uuid(),nullable=False),
        sa.Column('chat_id',sa.Uuid(),sa.ForeignKey('secret_chats.id',ondelete='CASCADE'),nullable=False),
        sa.Column('sender_id',sa.Uuid(),sa.ForeignKey('secret_devices.id',ondelete='CASCADE'),nullable=False),
        sa.Column('recipient_id',sa.Uuid(),sa.ForeignKey('secret_devices.id',ondelete='CASCADE'),nullable=False),
        sa.Column('kind',sa.String(16),nullable=False),sa.Column('ciphertext',sa.JSON(),nullable=False),
        sa.Column('digest',sa.String(64),nullable=False),
        sa.Column('created_at',sa.DateTime(timezone=True),server_default=sa.func.now(),nullable=False),
        sa.Column('acknowledged',sa.Boolean(),nullable=False),
        sa.UniqueConstraint('sender_id','client_id',name='uq_secret_envelope_client'))
    for name in ('chat_id','recipient_id'):
        op.create_index('ix_secret_envelopes_'+name,'secret_envelopes',[name])
    op.create_table('secret_uploads',sa.Column('id',sa.Uuid(),primary_key=True),
        sa.Column('chat_id',sa.Uuid(),sa.ForeignKey('secret_chats.id',ondelete='CASCADE'),nullable=False),
        sa.Column('owner_id',sa.Uuid(),sa.ForeignKey('secret_devices.id',ondelete='CASCADE'),nullable=False),
        sa.Column('size_bytes',sa.BigInteger(),nullable=False),sa.Column('chunk_count',sa.BigInteger(),nullable=False),
        sa.Column('complete',sa.Boolean(),nullable=False),
        sa.Column('published',sa.Boolean(),nullable=False),
        sa.Column('created_at',sa.DateTime(timezone=True),server_default=sa.func.now(),nullable=False))
    op.create_index('ix_secret_uploads_chat_id','secret_uploads',['chat_id'])


def downgrade():
    if op.get_bind().scalar(sa.text('SELECT EXISTS(SELECT 1 FROM secret_chats)')):
        raise RuntimeError('Secret chats exist; refusing to discard their transport data')
    for table in ('secret_uploads','secret_envelopes','secret_chats','secret_prekeys','secret_devices'):
        op.drop_table(table)
