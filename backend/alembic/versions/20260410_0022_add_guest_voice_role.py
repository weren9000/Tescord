"""add guest voice role

Revision ID: 20260410_0022
Revises: 20260403_0021
Create Date: 2026-04-10 16:20:00.000000
"""

from __future__ import annotations

from alembic import op

# revision identifiers, used by Alembic.
revision = "20260410_0022"
down_revision = "20260403_0021"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TYPE voiceaccessrole ADD VALUE IF NOT EXISTS 'guest'")


def downgrade() -> None:
    # PostgreSQL does not support removing enum values without recreating the type.
    pass
