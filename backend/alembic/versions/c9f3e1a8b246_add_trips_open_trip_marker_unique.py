"""add unique open-trip marker on trips

Revision ID: c9f3e1a8b246
Revises: 6a4d8b2c9f31
Create Date: 2026-08-19 17:51:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'c9f3e1a8b246'
down_revision: Union[str, Sequence[str], None] = '6a4d8b2c9f31'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema.

    Safety net: at most one in_progress Trip per device. A generated
    column stores device_id only when status = 'in_progress' and NULL
    otherwise. MySQL unique indexes treat each NULL as distinct, so
    completed trips are unaffected; a second in_progress row for the
    same device_id is rejected at the DB level.

    NOTE: if any existing data already has two+ in_progress trips for
    the same device_id, this migration will fail to apply. Run
    tracker_backend/scripts/cleanup_duplicate_open_trips.py first.
    """
    op.add_column(
        'trips',
        sa.Column(
            'open_trip_marker',
            sa.Integer(),
            sa.Computed(
                "CASE WHEN status = 'in_progress' THEN device_id ELSE NULL END",
                persisted=False,
            ),
            nullable=True,
        ),
    )
    op.create_index(
        'uq_trips_open_trip_marker',
        'trips',
        ['open_trip_marker'],
        unique=True,
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index('uq_trips_open_trip_marker', table_name='trips')
    op.drop_column('trips', 'open_trip_marker')
