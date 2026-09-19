"""add user pic_path

Revision ID: b6e9d2a4c178
Revises: d2f8a4c1b573
Create Date: 2026-08-31 11:20:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'b6e9d2a4c178'
down_revision: Union[str, Sequence[str], None] = 'd2f8a4c1b573'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('users', sa.Column('pic_path', sa.String(length=255), nullable=True))


def downgrade() -> None:
    op.drop_column('users', 'pic_path')
