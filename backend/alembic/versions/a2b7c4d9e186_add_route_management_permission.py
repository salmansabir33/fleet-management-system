"""add route_management permission

Revision ID: a2b7c4d9e186
Revises: f1a6c3d8e475
Create Date: 2026-08-24 10:30:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'a2b7c4d9e186'
down_revision: Union[str, Sequence[str], None] = 'f1a6c3d8e475'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Insert the route_management catalog row. Existing seed keys are
    left untouched — this only adds one new definition.
    """
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
                "key": "route_management",
                "label": "Route Management",
                "description": "create/edit routes, assign vehicles to routes",
                "is_active": True,
                "default_for_new_managers": False,
            }
        ],
    )


def downgrade() -> None:
    """Remove only the route_management row added above."""
    op.execute(
        "DELETE FROM permission_definitions WHERE `key` = 'route_management'"
    )
