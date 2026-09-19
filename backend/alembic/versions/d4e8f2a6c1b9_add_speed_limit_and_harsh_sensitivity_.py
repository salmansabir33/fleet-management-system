"""add speed_limit_kmh, harsh_brake_delta_kmh, harsh_accel_delta_kmh to devices

Revision ID: d4e8f2a6c1b9
Revises: b3c8d5e1f7a2
Create Date: 2026-08-15 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'd4e8f2a6c1b9'
down_revision: Union[str, Sequence[str], None] = 'b3c8d5e1f7a2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema.

    All three columns are nullable with no default — NULL means "use the
    fleet-wide default" (see OVERSPEED_THRESHOLD_KMH / HARSH_BRAKE_DELTA_KMH
    / HARSH_ACCEL_DELTA_KMH in services/report.py), so every existing
    device keeps behaving exactly as before until a value is explicitly
    set for it via the Set Parameters form.
    """
    op.add_column('devices', sa.Column('speed_limit_kmh', sa.Float(), nullable=True))
    op.add_column('devices', sa.Column('harsh_brake_delta_kmh', sa.Float(), nullable=True))
    op.add_column('devices', sa.Column('harsh_accel_delta_kmh', sa.Float(), nullable=True))


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column('devices', 'harsh_accel_delta_kmh')
    op.drop_column('devices', 'harsh_brake_delta_kmh')
    op.drop_column('devices', 'speed_limit_kmh')