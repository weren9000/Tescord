"""Platforms with shared membership; existing conversations stay independent.

This migration is additive. Legacy workspace deletion is a separate operation.
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "20261021_0049"
down_revision = "20261020_0048"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table("platform_migration_state",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("retired_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()))
    op.create_table("platforms",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("name", sa.String(80), nullable=False),
        sa.Column("description", sa.Text()),
        sa.Column("owner_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()))
    op.create_table("platform_members",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("platform_id", sa.Uuid(), sa.ForeignKey("platforms.id", ondelete="CASCADE"), nullable=False),
        sa.Column("user_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("role", postgresql.ENUM("owner", "admin", "member", name="memberrole", create_type=False), nullable=False),
        sa.Column("notifications_enabled", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("joined_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint("platform_id", "user_id", name="uq_platform_member"))
    op.create_index("ix_platform_members_platform_id", "platform_members", ["platform_id"])
    op.create_index("ix_platform_members_user_id", "platform_members", ["user_id"])
    op.create_table("platform_invites",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("platform_id", sa.Uuid(), sa.ForeignKey("platforms.id", ondelete="CASCADE"), nullable=False),
        sa.Column("token_hash", sa.String(64), nullable=False, unique=True),
        sa.Column("created_by_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="SET NULL")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("expires_at", sa.DateTime(timezone=True)),
        sa.Column("revoked_at", sa.DateTime(timezone=True)),
        sa.Column("max_uses", sa.Integer()),
        sa.Column("uses", sa.Integer(), nullable=False, server_default="0"))
    op.create_index("ix_platform_invites_platform_id", "platform_invites", ["platform_id"])
    op.add_column("servers", sa.Column("platform_id", sa.Uuid(), sa.ForeignKey("platforms.id", ondelete="CASCADE")))
    op.add_column("servers", sa.Column("platform_position", sa.Integer(), nullable=False, server_default="0"))
    op.create_index("ix_servers_platform_id", "servers", ["platform_id"])


def downgrade():
    op.drop_table("platform_migration_state")
    op.drop_index("ix_servers_platform_id", table_name="servers")
    op.drop_column("servers", "platform_position")
    op.drop_column("servers", "platform_id")
    op.drop_table("platform_invites")
    op.drop_table("platform_members")
    op.drop_table("platforms")
