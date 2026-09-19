"""add users and managers tables, device.user_id

Revision ID: f8c2b6a91d47
Revises: d4e8f2a6c1b9
Create Date: 2026-08-17 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'f8c2b6a91d47'
down_revision: Union[str, Sequence[str], None] = 'd4e8f2a6c1b9'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    # users and managers reference each other (users.manager_id ->
    # managers.id, managers.user_id -> users.id), so they can't both be
    # created in one op.create_table each with the FK inline. Sequence:
    # 1) users without manager_id, 2) managers (can now FK to users),
    # 3) add users.manager_id + its FK, 4) add devices.user_id + its FK.
    op.create_table('users',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('username', sa.String(length=60), nullable=False),
    sa.Column('full_name', sa.String(length=120), nullable=True),
    sa.Column('phone_number', sa.String(length=20), nullable=True),
    sa.Column('created_at', sa.TIMESTAMP(), server_default=sa.text('now()'), nullable=True),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('username')
    )

    op.create_table('managers',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('user_id', sa.Integer(), nullable=False),
    sa.Column('permissions', sa.JSON(), nullable=True),
    sa.Column('created_at', sa.TIMESTAMP(), server_default=sa.text('now()'), nullable=True),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('user_id')
    )

    op.add_column('users', sa.Column('manager_id', sa.Integer(), nullable=True))
    op.create_foreign_key('fk_users_manager_id', 'users', 'managers', ['manager_id'], ['id'])

    op.add_column('devices', sa.Column('user_id', sa.Integer(), nullable=True))
    op.create_foreign_key('fk_devices_user_id', 'devices', 'users', ['user_id'], ['id'])
    # ### end Alembic commands ###


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_constraint('fk_devices_user_id', 'devices', type_='foreignkey')
    op.drop_column('devices', 'user_id')

    op.drop_constraint('fk_users_manager_id', 'users', type_='foreignkey')
    op.drop_column('users', 'manager_id')

    op.drop_table('managers')
    op.drop_table('users')
    # ### end Alembic commands ###