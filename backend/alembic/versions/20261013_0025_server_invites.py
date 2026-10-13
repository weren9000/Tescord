"""Revocable invitations for groups and workspaces."""
from alembic import op
import sqlalchemy as sa

revision = "20261013_0025"
down_revision = "20261013_0024"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table("server_invites",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("server_id", sa.Uuid(), sa.ForeignKey("servers.id", ondelete="CASCADE"), nullable=False),
        sa.Column("created_by_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("token_hash", sa.String(64), nullable=False, unique=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("max_uses", sa.Integer(), nullable=True),
        sa.Column("uses", sa.Integer(), server_default="0", nullable=False),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True))
    op.create_index("ix_server_invites_server_id", "server_invites", ["server_id"])


def downgrade():
    op.drop_table("server_invites")
