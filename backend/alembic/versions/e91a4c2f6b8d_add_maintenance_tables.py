"""add maintenance tables

Revision ID: e91a4c2f6b8d
Revises: b7e2a4c9f1d3
Create Date: 2026-08-13 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = 'e91a4c2f6b8d'
down_revision: Union[str, Sequence[str], None] = 'b7e2a4c9f1d3'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


# Seed catalog — (key, label, sort_order). See the maintenance feature
# plan §2 for the source of these values.
MAINTENANCE_ITEMS = [
    ("engine_oil", "Engine Oil & Filter", 10),
    ("air_filter", "Air Filter", 20),
    ("ac_filter", "AC / Cabin Filter", 30),
    ("fuel_filter", "Fuel Filter", 40),
    ("tyres", "Tyres", 50),
    ("brake_pads", "Brake Pads", 60),
    ("brake_fluid", "Brake Fluid", 70),
    ("coolant", "Coolant / Radiator Flush", 80),
    ("battery", "Battery", 90),
    ("spark_plugs", "Spark Plugs", 100),
    ("wiper_blades", "Wiper Blades", 110),
    ("wheel_alignment", "Wheel Alignment & Balancing", 120),
]

# Seed default intervals — (item_key, vehicle_type or None for the
# fallback row, dimension, interval_value). Items with no applicable
# type default AND no fallback (e.g. ac_filter/bike) are intentionally
# absent here — "not applicable" for that vehicle_type is handled in
# services/maintenance_service.py's NOT_APPLICABLE set, not by a DB row.
MAINTENANCE_TYPE_DEFAULTS = [
    ("engine_oil", "bike", "distance", 3000),
    ("engine_oil", "car", "distance", 5000),
    ("engine_oil", "van", "distance", 5000),
    ("engine_oil", "truck", "engine_hours", 250),
    ("engine_oil", None, "distance", 5000),

    ("air_filter", "bike", "distance", 6000),
    ("air_filter", "car", "distance", 10000),
    ("air_filter", "van", "distance", 10000),
    ("air_filter", "truck", "engine_hours", 500),
    ("air_filter", None, "distance", 10000),

    # ac_filter: no bike row (air-cooled assumption — not applicable)
    ("ac_filter", "car", "distance", 15000),
    ("ac_filter", "van", "distance", 15000),
    ("ac_filter", "truck", "distance", 15000),
    ("ac_filter", None, "distance", 15000),

    ("fuel_filter", "bike", "distance", 10000),
    ("fuel_filter", "car", "distance", 20000),
    ("fuel_filter", "van", "distance", 20000),
    ("fuel_filter", "truck", "engine_hours", 400),
    ("fuel_filter", None, "distance", 20000),

    ("tyres", "bike", "distance", 15000),
    ("tyres", "car", "distance", 40000),
    ("tyres", "van", "distance", 40000),
    ("tyres", "truck", "distance", 60000),
    ("tyres", None, "distance", 40000),

    ("brake_pads", "bike", "distance", 10000),
    ("brake_pads", "car", "distance", 25000),
    ("brake_pads", "van", "distance", 25000),
    ("brake_pads", "truck", "distance", 35000),
    ("brake_pads", None, "distance", 25000),

    ("brake_fluid", "bike", "distance", 20000),
    ("brake_fluid", "car", "distance", 20000),
    ("brake_fluid", "van", "distance", 20000),
    ("brake_fluid", "truck", "engine_hours", 750),
    ("brake_fluid", None, "distance", 20000),

    # coolant: no bike row (air-cooled assumption — not applicable)
    ("coolant", "car", "distance", 40000),
    ("coolant", "van", "distance", 40000),
    ("coolant", "truck", "engine_hours", 1000),
    ("coolant", None, "distance", 40000),

    ("battery", "bike", "distance", 30000),
    ("battery", "car", "distance", 30000),
    ("battery", "van", "distance", 30000),
    ("battery", "truck", "engine_hours", 1200),
    ("battery", None, "distance", 30000),

    ("spark_plugs", "bike", "distance", 8000),
    ("spark_plugs", "car", "distance", 30000),
    # van/truck: assumed diesel — no spark plugs, not applicable
    ("spark_plugs", None, "distance", 30000),

    # Same interval for every vehicle_type — one fallback row covers all
    # of them, no need for per-type rows.
    ("wiper_blades", None, "distance", 12000),
    ("wheel_alignment", None, "distance", 10000),
]


def upgrade() -> None:
    """Upgrade schema."""
    maintenance_dimension_enum = sa.Enum(
        "distance", "engine_hours", name="maintenance_dimension_enum"
    )
    maintenance_dimension_enum.create(op.get_bind(), checkfirst=True)

    op.create_table(
        "maintenance_items",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("key", sa.String(length=40), nullable=False),
        sa.Column("label", sa.String(length=120), nullable=False),
        sa.Column("sort_order", sa.Integer(), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False),
        sa.Column("created_at", sa.TIMESTAMP(), server_default=sa.text("now()"), nullable=True),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("key"),
    )

    op.create_table(
        "maintenance_item_type_defaults",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("item_id", sa.Integer(), nullable=False),
        sa.Column("vehicle_type", sa.String(length=30), nullable=True),
        sa.Column("dimension", maintenance_dimension_enum, nullable=False),
        sa.Column("interval_value", sa.Float(), nullable=False),
        sa.ForeignKeyConstraint(["item_id"], ["maintenance_items.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("item_id", "vehicle_type", name="uq_item_type_default"),
    )

    op.create_table(
        "vehicle_maintenance_settings",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("device_id", sa.Integer(), nullable=False),
        sa.Column("item_id", sa.Integer(), nullable=False),
        sa.Column("dimension", maintenance_dimension_enum, nullable=False),
        sa.Column("interval_value", sa.Float(), nullable=False),
        sa.Column("created_at", sa.TIMESTAMP(), server_default=sa.text("now()"), nullable=True),
        sa.Column("updated_at", sa.TIMESTAMP(), server_default=sa.text("now()"), nullable=True),
        sa.ForeignKeyConstraint(["device_id"], ["devices.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["item_id"], ["maintenance_items.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("device_id", "item_id", name="uq_vehicle_item_setting"),
    )

    op.create_table(
        "maintenance_records",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("device_id", sa.Integer(), nullable=False),
        sa.Column("record_date", sa.Date(), nullable=False),
        sa.Column("odometer_km", sa.Float(), nullable=False),
        sa.Column("engine_hours", sa.Float(), nullable=True),
        sa.Column("is_baseline", sa.Boolean(), nullable=False),
        sa.Column("total_cost", sa.Float(), nullable=False),
        sa.Column("notes", sa.String(length=500), nullable=True),
        sa.Column("created_at", sa.TIMESTAMP(), server_default=sa.text("now()"), nullable=True),
        sa.ForeignKeyConstraint(["device_id"], ["devices.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("device_id", "record_date", "id", name="uq_maintenance_record_natural"),
    )

    op.create_table(
        "maintenance_record_lines",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("record_id", sa.Integer(), nullable=False),
        sa.Column("item_id", sa.Integer(), nullable=True),
        sa.Column("custom_label", sa.String(length=120), nullable=True),
        sa.Column("price", sa.Float(), nullable=False),
        sa.Column("checked", sa.Boolean(), nullable=False),
        sa.Column("service_odometer_km", sa.Float(), nullable=True),
        sa.Column("service_engine_hours", sa.Float(), nullable=True),
        sa.Column("created_at", sa.TIMESTAMP(), server_default=sa.text("now()"), nullable=True),
        sa.ForeignKeyConstraint(["record_id"], ["maintenance_records.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["item_id"], ["maintenance_items.id"]),
        sa.PrimaryKeyConstraint("id"),
    )

    op.add_column("devices", sa.Column("engine_hours", sa.Float(), nullable=True))

    # ── Seed data ──
    conn = op.get_bind()

    items_table = sa.table(
        "maintenance_items",
        sa.column("key", sa.String),
        sa.column("label", sa.String),
        sa.column("sort_order", sa.Integer),
        sa.column("is_active", sa.Boolean),
    )
    op.bulk_insert(
        items_table,
        [
            {"key": key, "label": label, "sort_order": sort_order, "is_active": True}
            for key, label, sort_order in MAINTENANCE_ITEMS
        ],
    )

    for item_key, vehicle_type, dimension, interval_value in MAINTENANCE_TYPE_DEFAULTS:
        conn.execute(
            sa.text(
                "INSERT INTO maintenance_item_type_defaults "
                "(item_id, vehicle_type, dimension, interval_value) "
                "SELECT id, :vehicle_type, :dimension, :interval_value "
                "FROM maintenance_items WHERE `key` = :item_key"
            ),
            {
                "vehicle_type": vehicle_type,
                "dimension": dimension,
                "interval_value": interval_value,
                "item_key": item_key,
            },
        )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column("devices", "engine_hours")
    op.drop_table("maintenance_record_lines")
    op.drop_table("maintenance_records")
    op.drop_table("vehicle_maintenance_settings")
    op.drop_table("maintenance_item_type_defaults")
    op.drop_table("maintenance_items")
    sa.Enum(name="maintenance_dimension_enum").drop(op.get_bind(), checkfirst=True)
