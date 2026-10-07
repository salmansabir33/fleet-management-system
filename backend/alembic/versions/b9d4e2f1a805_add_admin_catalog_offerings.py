"""add per-fleet admin permission and alert offerings

Revision ID: b9d4e2f1a805
Revises: a8f3c2e1b904
Create Date: 2026-10-06 16:30:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "b9d4e2f1a805"
down_revision: Union[str, Sequence[str], None] = "a8f3c2e1b904"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "admin_permission_offerings",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("admin_id", sa.Integer(), sa.ForeignKey("admins.id", ondelete="CASCADE"), nullable=False),
        sa.Column("permission_key", sa.String(60), nullable=False),
        sa.Column("is_offered", sa.Boolean(), nullable=False, server_default=sa.text("1")),
        sa.Column(
            "updated_at",
            sa.TIMESTAMP(),
            server_default=sa.text("CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP"),
        ),
        sa.UniqueConstraint("admin_id", "permission_key", name="uq_admin_permission_offering"),
    )
    op.create_index(
        "ix_admin_permission_offerings_admin_id",
        "admin_permission_offerings",
        ["admin_id"],
    )

    op.create_table(
        "admin_alert_offerings",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("admin_id", sa.Integer(), sa.ForeignKey("admins.id", ondelete="CASCADE"), nullable=False),
        sa.Column("alert_type", sa.String(60), nullable=False),
        sa.Column("offered_to_managers", sa.Boolean(), nullable=False, server_default=sa.text("1")),
        sa.Column(
            "updated_at",
            sa.TIMESTAMP(),
            server_default=sa.text("CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP"),
        ),
        sa.UniqueConstraint("admin_id", "alert_type", name="uq_admin_alert_offering"),
    )
    op.create_index(
        "ix_admin_alert_offerings_admin_id",
        "admin_alert_offerings",
        ["admin_id"],
    )


def downgrade() -> None:
    op.drop_index("ix_admin_alert_offerings_admin_id", table_name="admin_alert_offerings")
    op.drop_table("admin_alert_offerings")
    op.drop_index("ix_admin_permission_offerings_admin_id", table_name="admin_permission_offerings")
    op.drop_table("admin_permission_offerings")
