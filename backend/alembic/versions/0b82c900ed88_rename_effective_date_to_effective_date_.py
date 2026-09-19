"""rename effective_date to effective_date_start add effective_date_end

Revision ID: 0b82c900ed88
Revises: 2c9ef6bb9f45
Create Date: 2026-08-05 10:11:05.078974

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '0b82c900ed88'
down_revision: Union[str, Sequence[str], None] = '2c9ef6bb9f45'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema.

    Renames effective_date -> effective_date_start (preserving existing
    data), adds the nullable effective_date_end column, and updates the
    unique constraint to use the new column name.
    """
    # 1. Rename effective_date -> effective_date_start, keeping the data.
    #    MySQL's ALTER TABLE ... CHANGE COLUMN does the rename in place.
    op.alter_column(
        'fuel_prices',
        'effective_date',
        new_column_name='effective_date_start',
        existing_type=sa.Date(),
        existing_nullable=False,
    )

    # 2. Add the nullable effective_date_end column.
    op.add_column(
        'fuel_prices',
        sa.Column('effective_date_end', sa.Date(), nullable=True),
    )

    # 3. Update the unique constraint to reference the renamed column.
    op.drop_constraint('uq_fuel_price_type_date', 'fuel_prices', type_='unique')
    op.create_unique_constraint(
        'uq_fuel_price_type_date',
        'fuel_prices',
        ['fuel_type_id', 'effective_date_start'],
    )


def downgrade() -> None:
    """Downgrade schema.

    Reverses the upgrade: restores the old unique constraint, drops the
    effective_date_end column, and renames effective_date_start back to
    effective_date.
    """
    # 1. Restore the old unique constraint on effective_date.
    op.drop_constraint('uq_fuel_price_type_date', 'fuel_prices', type_='unique')
    op.create_unique_constraint(
        'uq_fuel_price_type_date',
        'fuel_prices',
        ['fuel_type_id', 'effective_date'],
    )

    # 2. Drop the effective_date_end column.
    op.drop_column('fuel_prices', 'effective_date_end')

    # 3. Rename effective_date_start -> effective_date, keeping the data.
    op.alter_column(
        'fuel_prices',
        'effective_date_start',
        new_column_name='effective_date',
        existing_type=sa.Date(),
        existing_nullable=False,
    )