"""Email verification, optional TOTP and session-bound push subscriptions."""
from alembic import op
import sqlalchemy as sa

revision = '20261102_0056'
down_revision = '20261030_0055'
branch_labels = depends_on = None


def upgrade():
    op.add_column('users', sa.Column('email_verified_at', sa.DateTime(timezone=True)))
    op.add_column('users', sa.Column('email_verification_source', sa.String(16)))
    op.add_column('users', sa.Column('totp_secret', sa.Text()))
    op.add_column('users', sa.Column('totp_enabled_at', sa.DateTime(timezone=True)))
    op.add_column('users', sa.Column('totp_last_step', sa.BigInteger(), nullable=False, server_default='-1'))
    op.add_column('users', sa.Column('security_version', sa.Integer(), nullable=False, server_default='0'))
    # One-time grandfathering. New users have no verified default.
    op.execute("UPDATE users SET email_verified_at = now(), email_verification_source = 'legacy'")
    op.add_column('push_subscriptions', sa.Column('session_id', sa.Uuid(), sa.ForeignKey('auth_sessions.id', ondelete='CASCADE')))
    op.create_index('ix_push_subscriptions_session_id', 'push_subscriptions', ['session_id'])
    # Legacy subscriptions cannot be attributed to a session. Clients re-register.
    op.execute('DELETE FROM push_subscriptions')
    op.create_table('auth_challenges',
        sa.Column('id', sa.Uuid(), primary_key=True),
        sa.Column('token_hash', sa.String(64), nullable=False, unique=True),
        sa.Column('purpose', sa.String(24), nullable=False),
        sa.Column('email', sa.String(320)),
        sa.Column('user_id', sa.Uuid(), sa.ForeignKey('users.id', ondelete='CASCADE')),
        sa.Column('session_id', sa.Uuid(), sa.ForeignKey('auth_sessions.id', ondelete='CASCADE')),
        sa.Column('security_version', sa.Integer(), nullable=False),
        sa.Column('code_hash', sa.String(64)), sa.Column('secret', sa.Text()),
        sa.Column('attempts', sa.Integer(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column('sent_at', sa.DateTime(timezone=True)),
        sa.Column('expires_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('verified_at', sa.DateTime(timezone=True)),
        sa.Column('consumed_at', sa.DateTime(timezone=True)))
    for field in ('email', 'user_id', 'expires_at'):
        op.create_index('ix_auth_challenges_' + field, 'auth_challenges', [field])
    op.create_table('auth_recovery_codes',
        sa.Column('id', sa.Uuid(), primary_key=True),
        sa.Column('user_id', sa.Uuid(), sa.ForeignKey('users.id', ondelete='CASCADE'), nullable=False),
        sa.Column('code_hash', sa.String(64), nullable=False),
        sa.Column('used_at', sa.DateTime(timezone=True)))
    op.create_index('ix_auth_recovery_codes_user_id', 'auth_recovery_codes', ['user_id'])
    op.create_table('auth_mail_outbox',
        sa.Column('id', sa.Uuid(), primary_key=True),
        sa.Column('payload', sa.Text(), nullable=False),
        sa.Column('attempts', sa.Integer(), nullable=False),
        sa.Column('available_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column('expires_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('delivered_at', sa.DateTime(timezone=True)))
    op.create_index('ix_auth_mail_outbox_available_at', 'auth_mail_outbox', ['available_at'])


def downgrade():
    # Reverting the application would remove enforced MFA, so require an explicit
    # recovery procedure rather than silently discarding enrolled factors.
    raise RuntimeError('Authentication migration requires a reviewed recovery procedure to downgrade')
