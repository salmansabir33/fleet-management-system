"""backfill manager self-assignment

Revision ID: d2f8a4c1b573
Revises: c8e3f1a6b429
Create Date: 2026-08-24 16:00:00.000000

"""
from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = 'd2f8a4c1b573'
down_revision: Union[str, Sequence[str], None] = 'c8e3f1a6b429'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Point every manager's own User.manager_id at their Manager.id
    when it isn't already. New promotions do this in
    promote_user_to_manager; this catches managers created before that.
    """
    op.execute(
        "UPDATE users "
        "JOIN managers ON users.id = managers.user_id "
        "SET users.manager_id = managers.id "
        "WHERE users.manager_id IS NULL OR users.manager_id != managers.id"
    )


def downgrade() -> None:
    """Undo only the self-assignments this upgrade wrote — users whose
    manager_id equals their own Manager.id — without wiping assignments
    of other users reporting to those managers.
    """
    op.execute(
        "UPDATE users "
        "JOIN managers ON users.id = managers.user_id "
        "SET users.manager_id = NULL "
        "WHERE users.manager_id = managers.id"
    )
