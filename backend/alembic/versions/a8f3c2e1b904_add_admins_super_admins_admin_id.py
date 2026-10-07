"""add admins, super_admins, and admin_id tenant columns

Revision ID: a8f3c2e1b904
Revises: b4e8c1a7d259
Create Date: 2026-10-06 10:45:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.sql import table, column


# revision identifiers, used by Alembic.
revision: str = "a8f3c2e1b904"
down_revision: Union[str, Sequence[str], None] = "b4e8c1a7d259"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "admins",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("username", sa.String(60), nullable=False),
        sa.Column("password_hash", sa.String(255), nullable=False),
        sa.Column("full_name", sa.String(120), nullable=True),
        sa.Column("phone", sa.String(20), nullable=True),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("1")),
        sa.Column("created_at", sa.TIMESTAMP(), server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.Column(
            "updated_at",
            sa.TIMESTAMP(),
            server_default=sa.text("CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP"),
        ),
        sa.UniqueConstraint("username", name="uq_admins_username"),
    )

    op.create_table(
        "super_admins",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("username", sa.String(60), nullable=False),
        sa.Column("password_hash", sa.String(255), nullable=False),
        sa.Column("full_name", sa.String(120), nullable=True),
        sa.Column("phone", sa.String(20), nullable=True),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("1")),
        sa.Column("singleton_key", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("created_at", sa.TIMESTAMP(), server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.Column(
            "updated_at",
            sa.TIMESTAMP(),
            server_default=sa.text("CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP"),
        ),
        sa.UniqueConstraint("username", name="uq_super_admins_username"),
        sa.UniqueConstraint("singleton_key", name="uq_super_admins_singleton"),
    )

    # Tenant columns on fleet tables
    for table_name in ("users", "devices", "geofences", "routes", "drivers"):
        op.add_column(
            table_name,
            sa.Column("admin_id", sa.Integer(), sa.ForeignKey("admins.id"), nullable=True),
        )
        op.create_index(f"ix_{table_name}_admin_id", table_name, ["admin_id"])

    # Fuel prices: admin_id + generated key for unique index
    op.add_column(
        "fuel_prices",
        sa.Column("admin_id", sa.Integer(), sa.ForeignKey("admins.id"), nullable=True),
    )
    op.create_index("ix_fuel_prices_admin_id", "fuel_prices", ["admin_id"])
    op.add_column(
        "fuel_prices",
        sa.Column(
            "admin_id_key",
            sa.Integer(),
            sa.Computed("IFNULL(admin_id, 0)", persisted=True),
            nullable=True,
        ),
    )
    # MySQL uses uq_fuel_price_type_date to support the fuel_type_id FK.
    # Add a plain index first so we can drop the unique constraint.
    op.create_index("ix_fuel_prices_fuel_type_id", "fuel_prices", ["fuel_type_id"])
    op.drop_constraint("uq_fuel_price_type_date", "fuel_prices", type_="unique")
    op.create_unique_constraint(
        "uq_fuel_price_type_admin_date",
        "fuel_prices",
        ["fuel_type_id", "admin_id_key", "effective_date_start"],
    )

    # Backfill Admin 1 from settings / env credentials (bcrypt via auth_service).
    from tracker_backend.config import settings
    from tracker_backend.services.auth_service import hash_password

    admin_username = settings.ADMIN_USERNAME
    admin_password = settings.ADMIN_PASSWORD
    if not admin_password:
        raise RuntimeError(
            "ADMIN_PASSWORD must be set in the environment to backfill Admin 1"
        )

    password_hash = hash_password(admin_password)
    admins_t = table(
        "admins",
        column("id", sa.Integer),
        column("username", sa.String),
        column("password_hash", sa.String),
        column("full_name", sa.String),
        column("is_active", sa.Boolean),
    )
    op.bulk_insert(
        admins_t,
        [
            {
                "id": 1,
                "username": admin_username,
                "password_hash": password_hash,
                "full_name": "Administrator",
                "is_active": True,
            }
        ],
    )

    conn = op.get_bind()
    for table_name in ("users", "devices", "geofences", "routes", "drivers"):
        conn.execute(sa.text(f"UPDATE {table_name} SET admin_id = 1 WHERE admin_id IS NULL"))
    # Existing fuel prices become global (admin_id NULL) — Super Admin timeline.


def downgrade() -> None:
    op.drop_constraint("uq_fuel_price_type_admin_date", "fuel_prices", type_="unique")
    op.drop_column("fuel_prices", "admin_id_key")
    op.drop_index("ix_fuel_prices_admin_id", table_name="fuel_prices")
    op.drop_column("fuel_prices", "admin_id")
    op.create_unique_constraint(
        "uq_fuel_price_type_date",
        "fuel_prices",
        ["fuel_type_id", "effective_date_start"],
    )
    op.drop_index("ix_fuel_prices_fuel_type_id", table_name="fuel_prices")

    for table_name in ("drivers", "routes", "geofences", "devices", "users"):
        op.drop_index(f"ix_{table_name}_admin_id", table_name=table_name)
        op.drop_column(table_name, "admin_id")

    op.drop_table("super_admins")
    op.drop_table("admins")
