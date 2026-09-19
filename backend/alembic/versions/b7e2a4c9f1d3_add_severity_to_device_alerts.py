"""add severity to device_alerts

Revision ID: b7e2a4c9f1d3
Revises: c7f21a9d4e6b
Create Date: 2026-08-10 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = 'b7e2a4c9f1d3'
down_revision: Union[str, Sequence[str], None] = 'c7f21a9d4e6b'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    alert_severity_enum = sa.Enum('critical', 'warning', 'info', name='alert_severity_enum')
    alert_severity_enum.create(op.get_bind(), checkfirst=True)
    op.add_column(
        'device_alerts',
        sa.Column(
            'severity',
            alert_severity_enum,
            nullable=False,
            server_default='warning',
        ),
    )
    # Existing "silence" rows (device offline) should read as critical,
    # not the generic "warning" default used for everything else.
    op.execute("UPDATE device_alerts SET severity = 'critical' WHERE alert_type = 'silence'")


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column('device_alerts', 'severity')
    sa.Enum(name='alert_severity_enum').drop(op.get_bind(), checkfirst=True)
