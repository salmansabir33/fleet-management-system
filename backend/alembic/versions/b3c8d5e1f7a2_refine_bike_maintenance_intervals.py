"""refine bike maintenance intervals

Revision ID: b3c8d5e1f7a2
Revises: f3a9c1d8b2e4
Create Date: 2026-08-13 00:00:00.000000

Corrects bike-specific maintenance data that was either missing or
using a car-oriented placeholder:

- fuel_filter: the bike row was seeded at 10,000 km, which several
  manufacturer/service sources put too low for a modern bike (most
  put street-bike fuel filter life well above that). Raised to
  20,000 km.
- brake_fluid: had no bike-specific row, so bikes silently used the
  generic/car interval (20,000 km). Brake fluid degrades on a
  roughly time-based (not purely mileage-based) schedule per most
  manufacturers (~1-2 years) — 15,000 km approximates that for
  typical bike annual mileage. Added a bike row.
- battery: had no bike-specific row either (generic/car 30,000 km).
  Bike batteries generally have a shorter service life than car
  batteries. Added a bike row at 20,000 km.

wiper_blades is NOT touched here — it isn't distance/interval data,
it's an applicability exclusion, handled in
tracker_backend/services/maintenance_service.py's NOT_APPLICABLE set
(bikes don't have wipers at all), not in this table.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = 'b3c8d5e1f7a2'
down_revision: Union[str, Sequence[str], None] = 'f3a9c1d8b2e4'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# Previous bike fuel_filter interval, restored on downgrade.
_OLD_FUEL_FILTER_BIKE_KM = 10000
_NEW_FUEL_FILTER_BIKE_KM = 20000

# New bike-specific rows added by this migration — (item_key,
# dimension, interval_value). Both previously fell through to the
# vehicle_type=NULL fallback row (the car-oriented value).
_NEW_BIKE_ROWS = [
    ("brake_fluid", "distance", 15000),
    ("battery", "distance", 20000),
]


def upgrade() -> None:
    """Upgrade schema."""
    conn = op.get_bind()

    conn.execute(
        sa.text(
            "UPDATE maintenance_item_type_defaults "
            "SET interval_value = :new_value "
            "WHERE vehicle_type = 'bike' "
            "AND item_id = (SELECT id FROM maintenance_items WHERE `key` = 'fuel_filter')"
        ),
        {"new_value": _NEW_FUEL_FILTER_BIKE_KM},
    )

    for item_key, dimension, interval_value in _NEW_BIKE_ROWS:
        # Idempotent: clear any existing bike row for this item first
        # (e.g. a leftover from a previously interrupted run of this
        # same migration) so re-running upgrade() never hits the
        # (item_id, vehicle_type) unique constraint.
        conn.execute(
            sa.text(
                "DELETE FROM maintenance_item_type_defaults "
                "WHERE vehicle_type = 'bike' "
                "AND item_id = (SELECT id FROM maintenance_items WHERE `key` = :item_key)"
            ),
            {"item_key": item_key},
        )
        conn.execute(
            sa.text(
                "INSERT INTO maintenance_item_type_defaults "
                "(item_id, vehicle_type, dimension, interval_value) "
                "SELECT id, 'bike', :dimension, :interval_value "
                "FROM maintenance_items WHERE `key` = :item_key"
            ),
            {
                "dimension": dimension,
                "interval_value": interval_value,
                "item_key": item_key,
            },
        )


def downgrade() -> None:
    """Downgrade schema."""
    conn = op.get_bind()

    for item_key, _dimension, _interval_value in _NEW_BIKE_ROWS:
        conn.execute(
            sa.text(
                "DELETE FROM maintenance_item_type_defaults "
                "WHERE vehicle_type = 'bike' "
                "AND item_id = (SELECT id FROM maintenance_items WHERE `key` = :item_key)"
            ),
            {"item_key": item_key},
        )

    conn.execute(
        sa.text(
            "UPDATE maintenance_item_type_defaults "
            "SET interval_value = :old_value "
            "WHERE vehicle_type = 'bike' "
            "AND item_id = (SELECT id FROM maintenance_items WHERE `key` = 'fuel_filter')"
        ),
        {"old_value": _OLD_FUEL_FILTER_BIKE_KM},
    )