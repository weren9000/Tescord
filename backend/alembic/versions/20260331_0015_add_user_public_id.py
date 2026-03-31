"""add user public id

Revision ID: 20260331_0015
Revises: 20260331_0014
Create Date: 2026-03-31 16:30:00.000000
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20260331_0015"
down_revision = "20260331_0014"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("users", sa.Column("public_id", sa.Integer(), nullable=True))

    op.execute(
        """
        WITH numbered AS (
            SELECT id, 10000 + ROW_NUMBER() OVER (ORDER BY created_at, id) - 1 AS generated_public_id
            FROM users
        )
        UPDATE users AS target
        SET public_id = numbered.generated_public_id
        FROM numbered
        WHERE target.id = numbered.id
        """
    )

    op.alter_column("users", "public_id", nullable=False)
    op.create_unique_constraint("uq_users_public_id", "users", ["public_id"])
    op.create_check_constraint("ck_users_public_id_range", "users", "public_id BETWEEN 10000 AND 99999")


def downgrade() -> None:
    op.drop_constraint("ck_users_public_id_range", "users", type_="check")
    op.drop_constraint("uq_users_public_id", "users", type_="unique")
    op.drop_column("users", "public_id")
