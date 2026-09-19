"""add drivers and driver_assignments tables

Revision ID: c7f21a9d4e6b
Revises: a1c3f8e2b7d4
Create Date: 2026-08-07 10:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'c7f21a9d4e6b'
down_revision: Union[str, Sequence[str], None] = 'a1c3f8e2b7d4'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table('drivers',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('name', sa.String(length=120), nullable=False),
    sa.Column('id_card_number', sa.String(length=15), nullable=False),
    sa.Column('phone_number', sa.String(length=20), nullable=True),
    sa.Column('license_number', sa.String(length=50), nullable=True),
    sa.Column('license_expiry', sa.Date(), nullable=True),
    sa.Column('status', sa.String(length=20), nullable=False),
    sa.Column('date_joined', sa.Date(), nullable=True),
    sa.Column('license_pic_path', sa.String(length=255), nullable=True),
    sa.Column('driver_pic_path', sa.String(length=255), nullable=True),
    sa.Column('created_at', sa.TIMESTAMP(), server_default=sa.text('now()'), nullable=True),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('id_card_number')
    )
    op.create_table('driver_assignments',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('driver_id', sa.Integer(), nullable=False),
    sa.Column('device_id', sa.Integer(), nullable=False),
    sa.Column('start_time', sa.DateTime(), nullable=False),
    sa.Column('end_time', sa.DateTime(), nullable=True),
    sa.Column('created_at', sa.TIMESTAMP(), server_default=sa.text('now()'), nullable=True),
    sa.ForeignKeyConstraint(['driver_id'], ['drivers.id'], ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['device_id'], ['devices.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index('ix_driver_assignments_driver_open', 'driver_assignments', ['driver_id', 'end_time'])
    op.create_index('ix_driver_assignments_device_open', 'driver_assignments', ['device_id', 'end_time'])
    # ### end Alembic commands ###


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index('ix_driver_assignments_device_open', table_name='driver_assignments')
    op.drop_index('ix_driver_assignments_driver_open', table_name='driver_assignments')
    op.drop_table('driver_assignments')
    op.drop_table('drivers')
    # ### end Alembic commands ###