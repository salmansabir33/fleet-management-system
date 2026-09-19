"""add trip driver confirmation columns

Revision ID: a3d9f2e8c146
Revises: c4a8e2f1b907
Create Date: 2026-09-16 12:30:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "a3d9f2e8c146"
down_revision: Union[str, Sequence[str], None] = "c4a8e2f1b907"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "trips",
        sa.Column("confirmed_driver_id", sa.Integer(), nullable=True),
    )
    op.add_column(
        "trips",
        sa.Column("driver_confirmed_at", sa.DateTime(), nullable=True),
    )
    op.add_column(
        "trips",
        sa.Column("driver_confirmed_by_user_id", sa.Integer(), nullable=True),
    )
    op.add_column(
        "trips",
        sa.Column("borrowed_from_device_id", sa.Integer(), nullable=True),
    )
    op.create_foreign_key(
        "fk_trips_confirmed_driver_id",
        "trips",
        "drivers",
        ["confirmed_driver_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_foreign_key(
        "fk_trips_driver_confirmed_by_user_id",
        "trips",
        "users",
        ["driver_confirmed_by_user_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_foreign_key(
        "fk_trips_borrowed_from_device_id",
        "trips",
        "devices",
        ["borrowed_from_device_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_index(
        "ix_trips_confirmed_driver_id",
        "trips",
        ["confirmed_driver_id"],
    )


def downgrade() -> None:
    op.drop_index("ix_trips_confirmed_driver_id", table_name="trips")
    op.drop_constraint("fk_trips_borrowed_from_device_id", "trips", type_="foreignkey")
    op.drop_constraint("fk_trips_driver_confirmed_by_user_id", "trips", type_="foreignkey")
    op.drop_constraint("fk_trips_confirmed_driver_id", "trips", type_="foreignkey")
    op.drop_column("trips", "borrowed_from_device_id")
    op.drop_column("trips", "driver_confirmed_by_user_id")
    op.drop_column("trips", "driver_confirmed_at")
    op.drop_column("trips", "confirmed_driver_id")
