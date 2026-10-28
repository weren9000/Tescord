"""Bind registered meeting participants to their account, including existing owners."""
from alembic import op
import sqlalchemy as sa

revision = '20261028_0053'
down_revision = '20261027_0052'
branch_labels = depends_on = None


def upgrade():
    op.add_column('room_participants', sa.Column('user_id', sa.Uuid(), nullable=True))
    op.create_foreign_key('fk_room_participant_user', 'room_participants', 'users', ['user_id'], ['id'], ondelete='CASCADE')
    op.execute('''UPDATE room_participants p SET user_id = r.owner_id
                  FROM room_sessions s JOIN meeting_rooms r ON r.id = s.room_id
                  WHERE p.session_id = s.id AND p.is_owner = true''')
    op.create_unique_constraint('uq_room_participant_user', 'room_participants', ['session_id', 'user_id'])


def downgrade():
    op.drop_constraint('uq_room_participant_user', 'room_participants', type_='unique')
    op.drop_constraint('fk_room_participant_user', 'room_participants', type_='foreignkey')
    op.drop_column('room_participants', 'user_id')
