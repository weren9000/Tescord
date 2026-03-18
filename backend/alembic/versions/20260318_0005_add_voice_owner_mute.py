"""Add owner mute state for voice channel access.

Revision ID: 20260318_0005
Revises: 20260318_0004
Create Date: 2026-03-18 18:30:00.000000
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op


revision = "20260318_0005"
down_revision = "20260318_0004"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "voice_channel_access",
        sa.Column("owner_muted", sa.Boolean(), nullable=False, server_default=sa.text("false")),
    )
    op.alter_column("voice_channel_access", "owner_muted", server_default=None)


def downgrade() -> None:
    op.drop_column("voice_channel_access", "owner_muted")
