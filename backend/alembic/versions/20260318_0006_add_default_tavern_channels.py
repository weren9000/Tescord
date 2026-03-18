"""add default tavern flag to channels

Revision ID: 20260318_0006
Revises: 20260318_0005
Create Date: 2026-03-18 23:15:00.000000
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20260318_0006"
down_revision = "20260318_0005"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "channels",
        sa.Column("is_default_tavern", sa.Boolean(), nullable=False, server_default=sa.text("false")),
    )


def downgrade() -> None:
    op.drop_column("channels", "is_default_tavern")
