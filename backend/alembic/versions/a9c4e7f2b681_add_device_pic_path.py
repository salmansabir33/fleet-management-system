"""add device pic_path

Revision ID: a9c4e7f2b681
Revises: f2c8d5e1b370
Create Date: 2026-09-01 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'a9c4e7f2b681'
down_revision: Union[str, Sequence[str], None] = 'f2c8d5e1b370'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('devices', sa.Column('pic_path', sa.String(length=255), nullable=True))


def downgrade() -> None:
    op.drop_column('devices', 'pic_path')
