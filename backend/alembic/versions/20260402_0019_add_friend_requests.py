"""add friend requests

Revision ID: 20260402_0019
Revises: 20260402_0018
Create Date: 2026-04-02 22:10:00.000000
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20260402_0019"
down_revision = "20260402_0018"
branch_labels = None
depends_on = None


friend_request_status = sa.Enum(
    "pending",
    "accepted",
    "rejected",
    "blocked",
    "cancelled",
    name="friendrequeststatus",
)


def upgrade() -> None:
    friend_request_status.create(op.get_bind(), checkfirst=True)
    op.create_table(
        "friend_requests",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("requester_user_id", sa.Uuid(), nullable=False),
        sa.Column("target_user_id", sa.Uuid(), nullable=False),
        sa.Column(
            "status",
            sa.Enum(
                "pending",
                "accepted",
                "rejected",
                "blocked",
                "cancelled",
                name="friendrequeststatus",
                create_type=False,
            ),
            nullable=False,
            server_default="pending",
        ),
        sa.Column("responded_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.ForeignKeyConstraint(["requester_user_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["target_user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("requester_user_id", "target_user_id", name="uq_friend_requests_requester_target"),
    )
    op.create_index("ix_friend_requests_target_status", "friend_requests", ["target_user_id", "status"])
    op.create_index("ix_friend_requests_requester_status", "friend_requests", ["requester_user_id", "status"])


def downgrade() -> None:
    op.drop_index("ix_friend_requests_requester_status", table_name="friend_requests")
    op.drop_index("ix_friend_requests_target_status", table_name="friend_requests")
    op.drop_table("friend_requests")
    friend_request_status.drop(op.get_bind(), checkfirst=True)
