"""set default_for_new_managers on three permission keys

Revision ID: c8e3f1a6b429
Revises: a2b7c4d9e186
Create Date: 2026-08-24 15:30:00.000000

"""
from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = 'c8e3f1a6b429'
down_revision: Union[str, Sequence[str], None] = 'a2b7c4d9e186'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Seed live_tracking, trip_history, and alerts_notifications as
    the defaults granted when a user is promoted to manager. All other
    catalog rows stay unchanged.
    """
    op.execute(
        "UPDATE permission_definitions SET default_for_new_managers = true "
        "WHERE `key` IN ('alerts_notifications', 'trip_history', 'live_tracking')"
    )


def downgrade() -> None:
    """Revert the three keys back to not-default."""
    op.execute(
        "UPDATE permission_definitions SET default_for_new_managers = false "
        "WHERE `key` IN ('alerts_notifications', 'trip_history', 'live_tracking')"
    )
