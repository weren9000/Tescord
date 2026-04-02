"""add friend and group block tables

Revision ID: 20260402_0020
Revises: 20260402_0019
Create Date: 2026-04-02 23:35:00.000000
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20260402_0020"
down_revision = "20260402_0019"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "friend_blocks",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("blocker_user_id", sa.Uuid(), nullable=False),
        sa.Column("blocked_user_id", sa.Uuid(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.ForeignKeyConstraint(["blocker_user_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["blocked_user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("blocker_user_id", "blocked_user_id", name="uq_friend_blocks_blocker_blocked"),
    )
    op.create_index("ix_friend_blocks_blocked_user_id", "friend_blocks", ["blocked_user_id"])

    op.create_table(
        "server_blocks",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("server_id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.ForeignKeyConstraint(["server_id"], ["servers.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("server_id", "user_id", name="uq_server_blocks_server_user"),
    )
    op.create_index("ix_server_blocks_user_id", "server_blocks", ["user_id"])


def downgrade() -> None:
    op.drop_index("ix_server_blocks_user_id", table_name="server_blocks")
    op.drop_table("server_blocks")
    op.drop_index("ix_friend_blocks_blocked_user_id", table_name="friend_blocks")
    op.drop_table("friend_blocks")
