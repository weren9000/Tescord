"""add user avatar fields

Revision ID: 20260321_0011
Revises: 20260321_0010
Create Date: 2026-03-21 14:20:00
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20260321_0011"
down_revision = "20260321_0010"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("users", sa.Column("avatar_filename", sa.String(length=255), nullable=True))
    op.add_column("users", sa.Column("avatar_mime_type", sa.String(length=128), nullable=True))
    op.add_column("users", sa.Column("avatar_size_bytes", sa.Integer(), nullable=True))
    op.add_column("users", sa.Column("avatar_content", sa.LargeBinary(), nullable=True))
    op.add_column("users", sa.Column("avatar_updated_at", sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    op.drop_column("users", "avatar_updated_at")
    op.drop_column("users", "avatar_content")
    op.drop_column("users", "avatar_size_bytes")
    op.drop_column("users", "avatar_mime_type")
    op.drop_column("users", "avatar_filename")
