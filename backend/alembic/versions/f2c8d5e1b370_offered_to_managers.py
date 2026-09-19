"""offered_to_managers on alert_type_settings

Revision ID: f2c8d5e1b370
Revises: e1b7c4d9a258
Create Date: 2026-08-31 17:30:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'f2c8d5e1b370'
down_revision: Union[str, Sequence[str], None] = 'e1b7c4d9a258'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "alert_type_settings",
        sa.Column("offered_to_managers", sa.Boolean(), nullable=False, server_default=sa.true()),
    )


def downgrade() -> None:
    op.drop_column("alert_type_settings", "offered_to_managers")
