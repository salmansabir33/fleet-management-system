"""add user_management permission

Revision ID: f1a6c3d8e475
Revises: e8f5b2c0d364
Create Date: 2026-08-21 15:15:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'f1a6c3d8e475'
down_revision: Union[str, Sequence[str], None] = 'e8f5b2c0d364'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Insert the user_management catalog row. Existing seed keys are
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
                "key": "user_management",
                "label": "User Management",
                "description": "add/edit users",
                "is_active": True,
                "default_for_new_managers": False,
            }
        ],
    )


def downgrade() -> None:
    """Remove only the user_management row added above."""
    op.execute(
        "DELETE FROM permission_definitions WHERE `key` = 'user_management'"
    )
