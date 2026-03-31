"""add server conversation kinds

Revision ID: 20260331_0013
Revises: 20260331_0012
Create Date: 2026-03-31 18:40:00
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20260331_0013"
down_revision = "20260331_0012"
branch_labels = None
depends_on = None


serverkind_enum = sa.Enum("workspace", "direct", "group_chat", name="serverkind")


def upgrade() -> None:
    serverkind_enum.create(op.get_bind(), checkfirst=True)

    op.add_column(
        "servers",
        sa.Column("kind", serverkind_enum, nullable=False, server_default="workspace"),
    )
    op.add_column("servers", sa.Column("direct_key", sa.String(length=72), nullable=True))
    op.create_unique_constraint("uq_servers_direct_key", "servers", ["direct_key"])


def downgrade() -> None:
    op.drop_constraint("uq_servers_direct_key", "servers", type_="unique")
    op.drop_column("servers", "direct_key")
    op.drop_column("servers", "kind")
    serverkind_enum.drop(op.get_bind(), checkfirst=True)
