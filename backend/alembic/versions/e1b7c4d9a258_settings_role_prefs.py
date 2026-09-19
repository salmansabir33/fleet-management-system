"""settings role prefs: user grants, person bells, catalog user flags

Revision ID: e1b7c4d9a258
Revises: b6e9d2a4c178
Create Date: 2026-08-31 16:50:00.000000

"""
from typing import Sequence, Union
import json

from alembic import op
import sqlalchemy as sa


revision: str = 'e1b7c4d9a258'
down_revision: Union[str, Sequence[str], None] = 'b6e9d2a4c178'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

USER_APPLICABLE_KEYS = (
    "alerts_notifications",
    "live_tracking",
    "maintenance",
    "trip_history",
)
DEFAULT_USER_KEYS = (
    "alerts_notifications",
    "live_tracking",
    "trip_history",
)


def _set_json(connection, table: str, column: str, payload: dict) -> None:
    raw = json.dumps(payload)
    dialect = connection.dialect.name
    if dialect == "mysql":
        connection.execute(
            sa.text(f"UPDATE `{table}` SET `{column}` = CAST(:p AS JSON)").bindparams(p=raw)
        )
    else:
        connection.execute(
            sa.text(f"UPDATE {table} SET {column} = :p").bindparams(p=raw)
        )


def upgrade() -> None:
    op.add_column(
        "permission_definitions",
        sa.Column("applies_to_user", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    op.add_column(
        "permission_definitions",
        sa.Column("default_for_new_users", sa.Boolean(), nullable=False, server_default=sa.false()),
    )

    op.add_column("users", sa.Column("permissions", sa.JSON(), nullable=True))
    op.add_column("users", sa.Column("notification_prefs", sa.JSON(), nullable=True))
    op.add_column("managers", sa.Column("notification_prefs", sa.JSON(), nullable=True))

    op.add_column(
        "alert_type_settings",
        sa.Column("default_manager_bell", sa.Boolean(), nullable=False, server_default=sa.true()),
    )
    op.add_column(
        "alert_type_settings",
        sa.Column("default_user_bell", sa.Boolean(), nullable=False, server_default=sa.true()),
    )

    connection = op.get_bind()
    for key in USER_APPLICABLE_KEYS:
        connection.execute(
            sa.text("UPDATE permission_definitions SET applies_to_user = 1 WHERE `key` = :key"),
            {"key": key},
        )
    for key in DEFAULT_USER_KEYS:
        connection.execute(
            sa.text("UPDATE permission_definitions SET default_for_new_users = 1 WHERE `key` = :key"),
            {"key": key},
        )

    perm_rows = connection.execute(
        sa.text(
            "SELECT `key` FROM permission_definitions "
            "WHERE is_active = 1 AND default_for_new_users = 1"
        )
    ).fetchall()
    user_permissions = {row[0]: True for row in perm_rows}

    alert_rows = connection.execute(
        sa.text("SELECT alert_type FROM alert_type_settings")
    ).fetchall()
    all_on = {row[0]: True for row in alert_rows}

    _set_json(connection, "users", "permissions", user_permissions)
    _set_json(connection, "users", "notification_prefs", all_on)
    _set_json(connection, "managers", "notification_prefs", all_on)


def downgrade() -> None:
    op.drop_column("alert_type_settings", "default_user_bell")
    op.drop_column("alert_type_settings", "default_manager_bell")
    op.drop_column("managers", "notification_prefs")
    op.drop_column("users", "notification_prefs")
    op.drop_column("users", "permissions")
    op.drop_column("permission_definitions", "default_for_new_users")
    op.drop_column("permission_definitions", "applies_to_user")
