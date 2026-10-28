"""Ephemeral meetings with scoped guest sessions, chat and uploads."""
from alembic import op
import sqlalchemy as sa

revision = '20261027_0052'
down_revision = '20261022_0051'
branch_labels = depends_on = None

def uid(name='id', target=None, **kw):
    return sa.Column(name, sa.Uuid(), *([sa.ForeignKey(target, ondelete='CASCADE')] if target else []), **kw)

def upgrade():
    op.create_table('meeting_rooms', uid(primary_key=True), uid('owner_id','users.id',nullable=False,unique=True), sa.Column('name',sa.String(80),nullable=False))
    op.create_table('room_sessions', uid(primary_key=True),uid('room_id','meeting_rooms.id',nullable=False,unique=True),
        sa.Column('started_at',sa.DateTime(timezone=True),server_default=sa.func.now(),nullable=False),
        sa.Column('owner_seen_at',sa.DateTime(timezone=True),nullable=False),sa.Column('owner_left_at',sa.DateTime(timezone=True)),
        sa.Column('ended_at',sa.DateTime(timezone=True)),sa.Column('invite_hash',sa.String(64),unique=True),
        sa.Column('invite_expires_at',sa.DateTime(timezone=True),nullable=False),sa.Column('invite_limit',sa.Integer(),nullable=False),
        sa.Column('invite_uses',sa.Integer(),nullable=False),sa.Column('locked',sa.Boolean(),nullable=False),sa.Column('chat_revision',sa.Integer(),nullable=False,server_default='0'))
    op.create_table('room_participants',uid(primary_key=True),uid('session_id','room_sessions.id',nullable=False),
        sa.Column('name',sa.String(64),nullable=False),sa.Column('join_hash',sa.String(64),nullable=False),
        sa.Column('is_owner',sa.Boolean(),nullable=False),
        sa.Column('auth_session_id',sa.Uuid(),sa.ForeignKey('auth_sessions.id',ondelete='SET NULL')),
        sa.Column('last_seen_at',sa.DateTime(timezone=True),nullable=False),sa.Column('revoked',sa.Boolean(),nullable=False),
        sa.Column('silenced',sa.Boolean(),nullable=False),sa.UniqueConstraint('session_id','join_hash',name='uq_room_participant_join'))
    op.create_table('room_messages',uid(primary_key=True),uid('session_id','room_sessions.id',nullable=False),uid('author_id','room_participants.id',nullable=False),
        sa.Column('content',sa.Text(),nullable=False),sa.Column('reply_to_id',sa.Uuid(),sa.ForeignKey('room_messages.id',ondelete='SET NULL')),
        sa.Column('created_at',sa.DateTime(timezone=True),server_default=sa.func.now(),nullable=False),sa.Column('edited_at',sa.DateTime(timezone=True)))
    op.create_table('room_uploads',uid(primary_key=True),uid('session_id','room_sessions.id',nullable=False),uid('author_id','room_participants.id',nullable=False),
        uid('message_id','room_messages.id'),sa.Column('filename',sa.String(255),nullable=False),sa.Column('mime_type',sa.String(128),nullable=False),
        sa.Column('size_bytes',sa.BigInteger(),nullable=False),sa.Column('created_at',sa.DateTime(timezone=True),server_default=sa.func.now(),nullable=False))
    op.create_table('room_reactions',uid(primary_key=True),uid('message_id','room_messages.id',nullable=False),uid('participant_id','room_participants.id',nullable=False),
        sa.Column('emoji',sa.String(32),nullable=False),sa.UniqueConstraint('message_id','participant_id','emoji',name='uq_room_reaction'))
    for table,fields in [('room_participants',['session_id']),('room_messages',['session_id']),('room_uploads',['session_id','message_id']),('room_reactions',['message_id'])]:
        for field in fields: op.create_index(f'ix_{table}_{field}',table,[field])

def downgrade():
    for table in ['room_reactions','room_uploads','room_messages','room_participants','room_sessions','meeting_rooms']: op.drop_table(table)
