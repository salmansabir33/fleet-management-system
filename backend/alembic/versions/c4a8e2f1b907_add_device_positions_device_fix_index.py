"""add device_positions (device_id, fix_time) index

Revision ID: c4a8e2f1b907
Revises: b1e4f7a2c903
Create Date: 2026-09-07 15:35:00.000000

"""
from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = 'c4a8e2f1b907'
down_revision: Union[str, Sequence[str], None] = 'b1e4f7a2c903'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Speed up Playback / route range scans on device_positions."""
    op.create_index(
        'ix_device_positions_device_id_fix_time',
        'device_positions',
        ['device_id', 'fix_time'],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(
        'ix_device_positions_device_id_fix_time',
        table_name='device_positions',
    )
