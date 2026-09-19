"""add maintenance due snapshot tables

Revision ID: f3a9c1d8b2e4
Revises: e91a4c2f6b8d
Create Date: 2026-08-13 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = 'f3a9c1d8b2e4'
down_revision: Union[str, Sequence[str], None] = 'e91a4c2f6b8d'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    maintenance_dimension_enum = sa.Enum(
        "distance", "engine_hours", name="maintenance_dimension_enum"
    )
    # Already created by e91a4c2f6b8d — checkfirst so this migration is
    # safe to run standalone against a fresh DB too.
    maintenance_dimension_enum.create(op.get_bind(), checkfirst=True)

    op.create_table(
        "maintenance_due_snapshots",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("device_id", sa.Integer(), nullable=False),
        sa.Column("snapshot_date", sa.Date(), nullable=False),
        sa.Column("odometer_km", sa.Float(), nullable=True),
        sa.Column("engine_hours", sa.Float(), nullable=True),
        sa.Column("created_at", sa.TIMESTAMP(), server_default=sa.text("now()"), nullable=True),
        sa.ForeignKeyConstraint(["device_id"], ["devices.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("device_id", "snapshot_date", name="uq_due_snapshot_device_date"),
    )

    op.create_table(
        "maintenance_due_snapshot_lines",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("snapshot_id", sa.Integer(), nullable=False),
        sa.Column("item_id", sa.Integer(), nullable=False),
        sa.Column("dimension", maintenance_dimension_enum, nullable=False),
        sa.Column("interval_value", sa.Float(), nullable=False),
        sa.Column("last_service_value", sa.Float(), nullable=True),
        sa.Column("current_value", sa.Float(), nullable=True),
        sa.Column("progress_pct", sa.Float(), nullable=True),
        sa.Column("status", sa.String(length=20), nullable=False),
        sa.Column("created_at", sa.TIMESTAMP(), server_default=sa.text("now()"), nullable=True),
        sa.ForeignKeyConstraint(["snapshot_id"], ["maintenance_due_snapshots.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["item_id"], ["maintenance_items.id"]),
        sa.PrimaryKeyConstraint("id"),
    )

    op.create_index(
        "ix_due_snapshot_lines_snapshot_id",
        "maintenance_due_snapshot_lines",
        ["snapshot_id"],
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index("ix_due_snapshot_lines_snapshot_id", table_name="maintenance_due_snapshot_lines")
    op.drop_table("maintenance_due_snapshot_lines")
    op.drop_table("maintenance_due_snapshots")
    # Do NOT drop maintenance_dimension_enum here — e91a4c2f6b8d still
    # owns/uses it for maintenance_item_type_defaults etc.
