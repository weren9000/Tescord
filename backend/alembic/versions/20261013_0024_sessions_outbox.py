"""Revocable sessions and idempotent message delivery."""
from alembic import op
import sqlalchemy as sa

revision = "20261013_0024"
down_revision = "20260415_0023"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table("auth_sessions",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("user_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True))
    op.create_index("ix_auth_sessions_user_id", "auth_sessions", ["user_id"])
    op.add_column("messages", sa.Column("client_message_id", sa.Uuid(), nullable=True))
    op.create_unique_constraint("uq_messages_author_client", "messages", ["author_id", "client_message_id"])
    op.create_table("outbox_events",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("message_id", sa.Uuid(), sa.ForeignKey("messages.id", ondelete="CASCADE"), unique=True, nullable=False),
        sa.Column("attempts", sa.Integer(), server_default="0", nullable=False),
        sa.Column("available_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("delivered_at", sa.DateTime(timezone=True), nullable=True))
    op.create_index("ix_outbox_events_available_at", "outbox_events", ["available_at"])


def downgrade():
    op.drop_table("outbox_events")
    op.drop_constraint("uq_messages_author_client", "messages", type_="unique")
    op.drop_column("messages", "client_message_id")
    op.drop_table("auth_sessions")
