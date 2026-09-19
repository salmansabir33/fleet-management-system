"""add alert_type_settings table

Revision ID: e8f5b2c0d364
Revises: d7e4a1b9c253
Create Date: 2026-08-21 11:31:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'e8f5b2c0d364'
down_revision: Union[str, Sequence[str], None] = 'd7e4a1b9c253'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


# Exact alert_type strings currently produced by alert_monitor.py
# (_raise_alert calls) and security_monitor.py (DeviceAlert insert).
ALERT_TYPES = [
    "driver_unassigned",
    "harsh_brake",
    "harsh_accel",
    "overspeed",
    "geofence_exit",
    "silence",
]


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        'alert_type_settings',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('alert_type', sa.String(length=60), nullable=False),
        sa.Column('is_enabled', sa.Boolean(), nullable=False),
        sa.Column('updated_at', sa.TIMESTAMP(), server_default=sa.text('now()'), nullable=True),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('alert_type'),
    )

    settings_table = sa.table(
        'alert_type_settings',
        sa.column('alert_type', sa.String),
        sa.column('is_enabled', sa.Boolean),
    )
    op.bulk_insert(
        settings_table,
        [
            {"alert_type": alert_type, "is_enabled": True}
            for alert_type in ALERT_TYPES
        ],
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_table('alert_type_settings')
