"""Ephemeral, authorized delivery of public call keys and Olm envelopes."""
from alembic import op
import sqlalchemy as sa
revision='20261102_0059'
down_revision='20261102_0058'
branch_labels=depends_on=None


def upgrade():
    op.create_table('secret_media_devices',sa.Column('id',sa.Uuid(),primary_key=True),
        sa.Column('room',sa.String(100),nullable=False),sa.Column('identity',sa.String(36),nullable=False),
        sa.Column('keys',sa.JSON(),nullable=False),sa.Column('seen_at',sa.DateTime(timezone=True),server_default=sa.func.now(),nullable=False),
        sa.UniqueConstraint('room','identity',name='uq_secret_media_identity'))
    op.create_index('ix_secret_media_devices_room','secret_media_devices',['room'])
    op.create_index('ix_secret_media_devices_seen_at','secret_media_devices',['seen_at'])
    op.create_table('secret_media_prekeys',sa.Column('device_id',sa.Uuid(),sa.ForeignKey('secret_media_devices.id',ondelete='CASCADE'),primary_key=True),
        sa.Column('key_id',sa.String(128),primary_key=True),sa.Column('payload',sa.JSON(),nullable=False),sa.Column('claimed',sa.Boolean(),nullable=False))
    op.create_table('secret_media_envelopes',sa.Column('sequence',sa.BigInteger(),primary_key=True,autoincrement=True),
        sa.Column('sender_id',sa.Uuid(),sa.ForeignKey('secret_media_devices.id',ondelete='CASCADE'),nullable=False),
        sa.Column('recipient_id',sa.Uuid(),sa.ForeignKey('secret_media_devices.id',ondelete='CASCADE'),nullable=False),
        sa.Column('client_id',sa.Uuid(),nullable=False),sa.Column('ciphertext',sa.JSON(),nullable=False),sa.Column('digest',sa.String(64),nullable=False),
        sa.Column('acknowledged',sa.Boolean(),nullable=False),sa.Column('created_at',sa.DateTime(timezone=True),server_default=sa.func.now(),nullable=False),
        sa.UniqueConstraint('sender_id','client_id',name='uq_secret_media_envelope'))
    for field in ('sender_id','recipient_id'):
        op.create_index('ix_secret_media_envelopes_'+field,'secret_media_envelopes',[field])


def downgrade():
    for table in ('secret_media_envelopes','secret_media_prekeys','secret_media_devices'):
        op.drop_table(table)
