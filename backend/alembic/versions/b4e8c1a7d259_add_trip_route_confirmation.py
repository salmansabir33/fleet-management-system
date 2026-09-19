"""add trip route confirmation and time-ranged route assignments

Revision ID: b4e8c1a7d259
Revises: a3d9f2e8c146
Create Date: 2026-09-17 11:45:00.000000

"""
from datetime import datetime
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "b4e8c1a7d259"
down_revision: Union[str, Sequence[str], None] = "a3d9f2e8c146"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _column_names(conn, table: str) -> set[str]:
    rows = conn.execute(sa.text(f"SHOW COLUMNS FROM {table}")).fetchall()
    return {row[0] for row in rows}


def _index_names(conn, table: str) -> set[str]:
    rows = conn.execute(sa.text(f"SHOW INDEX FROM {table}")).fetchall()
    return {row[2] for row in rows}


def upgrade() -> None:
    conn = op.get_bind()
    rv_cols = _column_names(conn, "route_vehicles")

    if "start_time" not in rv_cols:
        op.add_column("route_vehicles", sa.Column("start_time", sa.DateTime(), nullable=True))
    if "end_time" not in rv_cols:
        op.add_column("route_vehicles", sa.Column("end_time", sa.DateTime(), nullable=True))

    rows = conn.execute(
        sa.text(
            "SELECT id, device_id, created_at FROM route_vehicles "
            "ORDER BY device_id ASC, created_at ASC, id ASC"
        )
    ).fetchall()

    by_device: dict[int, list] = {}
    for row in rows:
        by_device.setdefault(row.device_id, []).append(row)

    fallback_start = datetime.utcnow()
    for assignments in by_device.values():
        for index, row in enumerate(assignments):
            start = row.created_at or fallback_start
            end = None
            if index < len(assignments) - 1:
                end = assignments[index + 1].created_at or start
            conn.execute(
                sa.text(
                    "UPDATE route_vehicles SET start_time = :start, end_time = :end WHERE id = :id"
                ),
                {"start": start, "end": end, "id": row.id},
            )

    conn.execute(
        sa.text(
            "UPDATE route_vehicles SET start_time = :start WHERE start_time IS NULL"
        ),
        {"start": fallback_start},
    )

    start_null = conn.execute(
        sa.text(
            "SELECT IS_NULLABLE FROM information_schema.COLUMNS "
            "WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'route_vehicles' "
            "AND COLUMN_NAME = 'start_time'"
        )
    ).scalar()
    if start_null == "YES":
        op.alter_column(
            "route_vehicles",
            "start_time",
            existing_type=sa.DateTime(),
            nullable=False,
        )

    # MySQL InnoDB uses UNIQUE (route_id, device_id) as the supporting
    # index for FK route_vehicles_ibfk_2. Create a dedicated route_id
    # index before dropping that unique key (error 1553).
    rv_indexes = _index_names(conn, "route_vehicles")
    if "ix_route_vehicles_route_id" not in rv_indexes:
        op.create_index("ix_route_vehicles_route_id", "route_vehicles", ["route_id"])

    if "ix_route_vehicles_device_end" not in _index_names(conn, "route_vehicles"):
        op.create_index(
            "ix_route_vehicles_device_end",
            "route_vehicles",
            ["device_id", "end_time"],
        )

    if "uq_route_vehicle" in _index_names(conn, "route_vehicles"):
        op.drop_constraint("uq_route_vehicle", "route_vehicles", type_="unique")

    trip_cols = _column_names(conn, "trips")
    if "confirmed_route_id" not in trip_cols:
        op.add_column("trips", sa.Column("confirmed_route_id", sa.Integer(), nullable=True))
    if "route_confirmed_at" not in trip_cols:
        op.add_column("trips", sa.Column("route_confirmed_at", sa.DateTime(), nullable=True))
    if "route_confirmed_by_user_id" not in trip_cols:
        op.add_column(
            "trips",
            sa.Column("route_confirmed_by_user_id", sa.Integer(), nullable=True),
        )

    trip_indexes = _index_names(conn, "trips")
    fks = {
        row[0]
        for row in conn.execute(
            sa.text(
                "SELECT CONSTRAINT_NAME FROM information_schema.TABLE_CONSTRAINTS "
                "WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'trips' "
                "AND CONSTRAINT_TYPE = 'FOREIGN KEY'"
            )
        ).fetchall()
    }
    if "fk_trips_confirmed_route_id" not in fks:
        op.create_foreign_key(
            "fk_trips_confirmed_route_id",
            "trips",
            "routes",
            ["confirmed_route_id"],
            ["id"],
            ondelete="SET NULL",
        )
    if "fk_trips_route_confirmed_by_user_id" not in fks:
        op.create_foreign_key(
            "fk_trips_route_confirmed_by_user_id",
            "trips",
            "users",
            ["route_confirmed_by_user_id"],
            ["id"],
            ondelete="SET NULL",
        )
    if "ix_trips_confirmed_route_id" not in trip_indexes:
        op.create_index("ix_trips_confirmed_route_id", "trips", ["confirmed_route_id"])


def downgrade() -> None:
    op.drop_index("ix_trips_confirmed_route_id", table_name="trips")
    op.drop_constraint("fk_trips_route_confirmed_by_user_id", "trips", type_="foreignkey")
    op.drop_constraint("fk_trips_confirmed_route_id", "trips", type_="foreignkey")
    op.drop_column("trips", "route_confirmed_by_user_id")
    op.drop_column("trips", "route_confirmed_at")
    op.drop_column("trips", "confirmed_route_id")

    op.drop_index("ix_route_vehicles_device_end", table_name="route_vehicles")
    # Keep only currently-open assignments so the unique (route, device)
    # constraint can be restored.
    conn = op.get_bind()
    conn.execute(sa.text("DELETE FROM route_vehicles WHERE end_time IS NOT NULL"))
    op.create_unique_constraint(
        "uq_route_vehicle",
        "route_vehicles",
        ["route_id", "device_id"],
    )
    op.drop_index("ix_route_vehicles_route_id", table_name="route_vehicles")
    op.drop_column("route_vehicles", "end_time")
    op.drop_column("route_vehicles", "start_time")
