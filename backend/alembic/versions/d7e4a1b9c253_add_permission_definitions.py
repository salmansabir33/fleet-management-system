"""add permission_definitions table

Revision ID: d7e4a1b9c253
Revises: c9f3e1a8b246
Create Date: 2026-08-21 11:30:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'd7e4a1b9c253'
down_revision: Union[str, Sequence[str], None] = 'c9f3e1a8b246'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


# Original MANAGER_PERMISSION_KEYS from schemas.py — key, label, and the
# inline comment copied as description. Catalog is now editable via
# /api/settings/permissions; this seed just matches what the hardcoded
# list used to return.
PERMISSION_DEFINITIONS = [
    ("geofence", "Geofence Management", "create/edit geofences"),
    ("live_tracking", "Live Tracking", "view live vehicle positions/map"),
    ("reports_analytics", "Reports & Analytics", "daily/vehicle reports"),
    ("trip_history", "Trip History", "view trip logs"),
    ("alerts_notifications", "Alerts & Notifications", "view + resolve alerts"),
    ("maintenance", "Maintenance", "log/edit maintenance records"),
    ("fuel_prices", "Fuel Prices", "manage fuel price entries"),
    ("driver_management", "Driver Management", "add/edit drivers, assign to vehicles"),
    ("vehicle_management", "Vehicle Management", "add/edit vehicles"),
]


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        'permission_definitions',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('key', sa.String(length=60), nullable=False),
        sa.Column('label', sa.String(length=120), nullable=False),
        sa.Column('description', sa.String(length=255), nullable=True),
        sa.Column('is_active', sa.Boolean(), nullable=False),
        sa.Column('default_for_new_managers', sa.Boolean(), nullable=False),
        sa.Column('created_at', sa.TIMESTAMP(), server_default=sa.text('now()'), nullable=True),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('key'),
    )

    definitions_table = sa.table(
        'permission_definitions',
        sa.column('key', sa.String),
        sa.column('label', sa.String),
        sa.column('description', sa.String),
        sa.column('is_active', sa.Boolean),
        sa.column('default_for_new_managers', sa.Boolean),
    )
    op.bulk_insert(
        definitions_table,
        [
            {
                "key": key,
                "label": label,
                "description": description,
                "is_active": True,
                "default_for_new_managers": False,
            }
            for key, label, description in PERMISSION_DEFINITIONS
        ],
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_table('permission_definitions')
