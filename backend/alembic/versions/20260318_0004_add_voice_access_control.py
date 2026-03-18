"""Add voice access control tables.

Revision ID: 20260318_0004
Revises: 20260317_0003
Create Date: 2026-03-18 10:00:00.000000
"""

from __future__ import annotations

import uuid

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql


revision = "20260318_0004"
down_revision = "20260317_0003"
branch_labels = None
depends_on = None


voice_access_role_enum = postgresql.ENUM("owner", "resident", "stranger", name="voiceaccessrole", create_type=False)
voice_join_request_status_enum = postgresql.ENUM(
    "pending",
    "allowed",
    "resident",
    "rejected",
    "cancelled",
    name="voicejoinrequeststatus",
    create_type=False,
)


def upgrade() -> None:
    bind = op.get_bind()
    voice_access_role_enum.create(bind, checkfirst=True)
    voice_join_request_status_enum.create(bind, checkfirst=True)

    op.create_table(
        "voice_channel_access",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("channel_id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("role", voice_access_role_enum, nullable=False),
        sa.Column("blocked_until", sa.DateTime(timezone=True), nullable=True),
        sa.Column("temporary_access_until", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["channel_id"], ["channels.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("channel_id", "user_id", name="uq_voice_channel_access_channel_user"),
    )
    op.create_index(
        "ix_voice_channel_access_user_role",
        "voice_channel_access",
        ["user_id", "role"],
        unique=False,
    )

    op.create_table(
        "voice_join_requests",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("channel_id", sa.Uuid(), nullable=False),
        sa.Column("requester_user_id", sa.Uuid(), nullable=False),
        sa.Column("status", voice_join_request_status_enum, nullable=False),
        sa.Column("resolved_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["channel_id"], ["channels.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["requester_user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_voice_join_requests_status_created_at",
        "voice_join_requests",
        ["status", "created_at"],
        unique=False,
    )
    op.create_index(
        "ix_voice_join_requests_requester",
        "voice_join_requests",
        ["requester_user_id", "channel_id"],
        unique=False,
    )

    voice_channels = bind.execute(
        sa.text(
            """
            SELECT id, created_by_id
            FROM channels
            WHERE type = 'voice'
            """
        )
    ).mappings().all()

    voice_access_table = sa.table(
        "voice_channel_access",
        sa.column("id", sa.Uuid()),
        sa.column("channel_id", sa.Uuid()),
        sa.column("user_id", sa.Uuid()),
        sa.column("role", voice_access_role_enum),
    )

    owner_rows = [
        {
            "id": uuid.uuid4(),
            "channel_id": row["id"],
            "user_id": row["created_by_id"],
            "role": "owner",
        }
        for row in voice_channels
        if row["created_by_id"] is not None
    ]
    if owner_rows:
        op.bulk_insert(voice_access_table, owner_rows)


def downgrade() -> None:
    op.drop_index("ix_voice_join_requests_requester", table_name="voice_join_requests")
    op.drop_index("ix_voice_join_requests_status_created_at", table_name="voice_join_requests")
    op.drop_table("voice_join_requests")

    op.drop_index("ix_voice_channel_access_user_role", table_name="voice_channel_access")
    op.drop_table("voice_channel_access")

    bind = op.get_bind()
    voice_join_request_status_enum.drop(bind, checkfirst=True)
    voice_access_role_enum.drop(bind, checkfirst=True)
