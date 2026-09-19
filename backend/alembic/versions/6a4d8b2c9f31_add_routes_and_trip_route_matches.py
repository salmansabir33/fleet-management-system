"""add routes and trip route matches

Revision ID: 6a4d8b2c9f31
Revises: 934f74786d41
Create Date: 2026-08-18 14:50:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '6a4d8b2c9f31'
down_revision: Union[str, Sequence[str], None] = '934f74786d41'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table('routes',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('name', sa.String(length=120), nullable=False),
    sa.Column('direction_label', sa.String(length=120), nullable=True),
    sa.Column('waypoints', sa.JSON(), nullable=False),
    sa.Column('path', sa.JSON(), nullable=False),
    sa.Column('tolerance_meters', sa.Float(), server_default='400', nullable=False),
    sa.Column('created_at', sa.TIMESTAMP(), server_default=sa.text('now()'), nullable=True),
    sa.PrimaryKeyConstraint('id')
    )

    op.create_table('route_vehicles',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('route_id', sa.Integer(), nullable=False),
    sa.Column('device_id', sa.Integer(), nullable=False),
    sa.Column('created_at', sa.TIMESTAMP(), server_default=sa.text('now()'), nullable=True),
    sa.ForeignKeyConstraint(['device_id'], ['devices.id'], ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['route_id'], ['routes.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('route_id', 'device_id', name='uq_route_vehicle')
    )

    op.create_table('trip_route_matches',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('trip_id', sa.Integer(), nullable=False),
    sa.Column('route_id', sa.Integer(), nullable=False),
    sa.Column('match_percent', sa.Float(), nullable=False),
    sa.Column('deviation_segments', sa.JSON(), nullable=True),
    sa.Column('leg_start_index', sa.Integer(), nullable=True),
    sa.Column('leg_end_index', sa.Integer(), nullable=True),
    sa.Column('created_at', sa.TIMESTAMP(), server_default=sa.text('now()'), nullable=True),
    sa.ForeignKeyConstraint(['route_id'], ['routes.id'], ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['trip_id'], ['trips.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id')
    )

    op.add_column('trips', sa.Column('toll_tax_pkr', sa.Float(), nullable=True))
    op.add_column('trips', sa.Column('challan_pkr', sa.Float(), nullable=True))


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column('trips', 'challan_pkr')
    op.drop_column('trips', 'toll_tax_pkr')
    op.drop_table('trip_route_matches')
    op.drop_table('route_vehicles')
    op.drop_table('routes')
