"""enforce one vehicle per user (unique devices.user_id)

Revision ID: 934f74786d41
Revises: f8c2b6a91d47
Create Date: 2026-08-17 13:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '934f74786d41'
down_revision: Union[str, Sequence[str], None] = 'f8c2b6a91d47'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema.

    Product decision: a user owns at most one vehicle (previously
    0+). Enforced here at the DB level so it holds regardless of
    entry point (API validation in main.py's update_fleet_device
    mirrors this for a clean 400 instead of a raw IntegrityError,
    but the DB is the actual source of truth).

    MySQL/InnoDB unique indexes treat each NULL as distinct, so
    multiple devices with user_id = NULL (no owner) remain allowed —
    only a real duplicate user_id across two devices is rejected.

    NOTE: if any existing data already has two+ devices pointing at
    the same user_id, this migration will fail to apply. Resolve
    those duplicates (reassign or null out the extras) before running
    it against a populated database.
    """
    op.create_unique_constraint('uq_devices_user_id', 'devices', ['user_id'])


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_constraint('uq_devices_user_id', 'devices', type_='unique')