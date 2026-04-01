"""add attachment disk storage support

Revision ID: 20260401_0017
Revises: 20260401_0016
Create Date: 2026-04-01 00:30:00.000000
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20260401_0017"
down_revision = "20260401_0016"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("attachments", sa.Column("storage_path", sa.String(length=512), nullable=True))
    op.alter_column("attachments", "content", existing_type=sa.LargeBinary(), nullable=True)


def downgrade() -> None:
    op.execute(sa.text("UPDATE attachments SET content = decode('', 'hex') WHERE content IS NULL"))
    op.alter_column("attachments", "content", existing_type=sa.LargeBinary(), nullable=False)
    op.drop_column("attachments", "storage_path")
