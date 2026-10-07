"""Seed missing permission and alert-type catalog rows on read.

Keeps the admin Settings page complete even when new keys are added in
code before a dedicated Alembic migration runs.

Fleet offerings (AdminPermissionOffering / AdminAlertOffering) overlay
the global master catalogs so each admin controls what their managers
can be offered. Missing overlay rows default to offered=True.
"""
from sqlalchemy.orm import Session
from sqlalchemy.orm.attributes import flag_modified

from tracker_backend.models import (
    AdminAlertOffering,
    AdminPermissionOffering,
    AlertTypeSetting,
    Manager,
    PermissionDefinition,
    User,
)

# Mirrors keys enforced in manager_panel*, deps, and the manager UI.
KNOWN_PERMISSION_DEFINITIONS = [
    ("alerts_notifications", "Alerts & Notifications", "view + resolve alerts"),
    ("driver_management", "Driver Management", "add/edit drivers, assign to vehicles"),
    ("fuel_prices", "Fuel Prices", "manage fuel price entries"),
    ("geofence", "Geofence Management", "create/edit geofences"),
    ("live_tracking", "Live Tracking", "view live vehicle positions/map"),
    ("maintenance", "Maintenance", "log/edit maintenance records"),
    ("reports_analytics", "Reports & Analytics", "daily/vehicle reports"),
    ("route_management", "Route Management", "create/edit routes, assign vehicles to routes"),
    ("trip_history", "Trip History", "view trip logs"),
    ("user_management", "User Management", "add/edit users"),
    ("vehicle_management", "Vehicle Management", "add/edit vehicles"),
]

DEFAULT_MANAGER_PERMISSION_KEYS = frozenset({
    "alerts_notifications",
    "live_tracking",
    "trip_history",
})

# Subset of catalog keys the user panel can honor (nav hide). All other
# keys stay manager-only.
USER_APPLICABLE_PERMISSION_KEYS = frozenset({
    "alerts_notifications",
    "live_tracking",
    "maintenance",
    "trip_history",
})

DEFAULT_USER_PERMISSION_KEYS = frozenset({
    "alerts_notifications",
    "live_tracking",
    "trip_history",
})

# Static alert types the fleet monitors (excludes dynamic maintenance_* keys).
KNOWN_ALERT_TYPES = [
    "driver_unassigned",
    "geofence_exit",
    "harsh_accel",
    "harsh_brake",
    "overspeed",
    "route_deviation",
    "silence",
    "trip_driver_pending_confirmation",
    "trip_route_pending_confirmation",
]


def ensure_permission_definitions(db: Session) -> None:
    existing_rows = {row.key: row for row in db.query(PermissionDefinition).all()}
    dirty = False
    for key, label, description in KNOWN_PERMISSION_DEFINITIONS:
        applies_to_user = key in USER_APPLICABLE_PERMISSION_KEYS
        if key not in existing_rows:
            db.add(PermissionDefinition(
                key=key,
                label=label,
                description=description,
                is_active=True,
                default_for_new_managers=key in DEFAULT_MANAGER_PERMISSION_KEYS,
                applies_to_user=applies_to_user,
                default_for_new_users=key in DEFAULT_USER_PERMISSION_KEYS,
            ))
            dirty = True
            continue
        row = existing_rows[key]
        if bool(row.applies_to_user) != applies_to_user:
            row.applies_to_user = applies_to_user
            if not applies_to_user:
                row.default_for_new_users = False
            dirty = True
    if dirty:
        db.commit()


def ensure_alert_type_settings(db: Session) -> None:
    existing = {row.alert_type for row in db.query(AlertTypeSetting.alert_type).all()}
    added = False
    for alert_type in KNOWN_ALERT_TYPES:
        if alert_type in existing:
            continue
        db.add(AlertTypeSetting(
            alert_type=alert_type,
            is_enabled=True,
            default_manager_bell=True,
            default_user_bell=True,
            offered_to_managers=True,
        ))
        added = True
    if added:
        db.commit()


def default_user_permissions(db: Session) -> dict[str, bool]:
    ensure_permission_definitions(db)
    rows = (
        db.query(PermissionDefinition)
        .filter(
            PermissionDefinition.is_active.is_(True),
            PermissionDefinition.applies_to_user.is_(True),
            PermissionDefinition.default_for_new_users.is_(True),
        )
        .all()
    )
    return {row.key: True for row in rows}


def permission_offering_map(db: Session, admin_id: int) -> dict[str, bool]:
    """permission_key -> is_offered. Missing keys default to True at call sites."""
    rows = (
        db.query(AdminPermissionOffering)
        .filter(AdminPermissionOffering.admin_id == admin_id)
        .all()
    )
    return {row.permission_key: bool(row.is_offered) for row in rows}


def alert_offering_map(db: Session, admin_id: int) -> dict[str, bool]:
    """alert_type -> offered_to_managers. Missing keys default to True at call sites."""
    rows = (
        db.query(AdminAlertOffering)
        .filter(AdminAlertOffering.admin_id == admin_id)
        .all()
    )
    return {row.alert_type: bool(row.offered_to_managers) for row in rows}


def is_permission_offered(db: Session, admin_id: int | None, key: str, *, global_active: bool = True) -> bool:
    if not global_active:
        return False
    if admin_id is None:
        return True
    overlay = permission_offering_map(db, admin_id)
    if key not in overlay:
        return True
    return overlay[key]


def is_alert_offered(db: Session, admin_id: int | None, alert_type: str, *, global_offered: bool = True) -> bool:
    if not global_offered:
        return False
    if admin_id is None:
        return True
    overlay = alert_offering_map(db, admin_id)
    if alert_type not in overlay:
        return True
    return overlay[alert_type]


def default_bell_prefs(db: Session, role: str, admin_id: int | None = None) -> dict[str, bool]:
    """Seed notification_prefs for a new manager or user.

    Managers get every type currently offered for their fleet (all on).
    Users still follow default_user_bell.
    """
    ensure_alert_type_settings(db)
    rows = db.query(AlertTypeSetting).all()
    if role == "user":
        return {row.alert_type: bool(row.default_user_bell) for row in rows}
    return {
        row.alert_type: True
        for row in rows
        if is_alert_offered(db, admin_id, row.alert_type, global_offered=bool(row.offered_to_managers))
    }


def active_permission_keys(db: Session, admin_id: int | None = None) -> set[str]:
    ensure_permission_definitions(db)
    rows = (
        db.query(PermissionDefinition)
        .filter(PermissionDefinition.is_active.is_(True))
        .all()
    )
    return {
        row.key
        for row in rows
        if is_permission_offered(db, admin_id, row.key, global_active=True)
    }


def offered_alert_types(db: Session, admin_id: int | None = None) -> set[str]:
    ensure_alert_type_settings(db)
    rows = db.query(AlertTypeSetting).all()
    return {
        row.alert_type
        for row in rows
        if is_alert_offered(db, admin_id, row.alert_type, global_offered=bool(row.offered_to_managers))
    }


def set_permission_offered(db: Session, admin_id: int, permission_key: str, offered: bool) -> AdminPermissionOffering:
    row = (
        db.query(AdminPermissionOffering)
        .filter(
            AdminPermissionOffering.admin_id == admin_id,
            AdminPermissionOffering.permission_key == permission_key,
        )
        .first()
    )
    if row is None:
        row = AdminPermissionOffering(
            admin_id=admin_id,
            permission_key=permission_key,
            is_offered=offered,
        )
        db.add(row)
    else:
        row.is_offered = offered
    return row


def set_alert_offered(db: Session, admin_id: int, alert_type: str, offered: bool) -> AdminAlertOffering:
    row = (
        db.query(AdminAlertOffering)
        .filter(
            AdminAlertOffering.admin_id == admin_id,
            AdminAlertOffering.alert_type == alert_type,
        )
        .first()
    )
    if row is None:
        row = AdminAlertOffering(
            admin_id=admin_id,
            alert_type=alert_type,
            offered_to_managers=offered,
        )
        db.add(row)
    else:
        row.offered_to_managers = offered
    return row


def _managers_for_fleet(db: Session, admin_id: int | None) -> list[Manager]:
    from sqlalchemy import inspect
    if not inspect(db.bind).has_table("managers"):
        return []
    if admin_id is None:
        return db.query(Manager).all()
    user_ids = [
        row.id
        for row in db.query(User.id).filter(User.admin_id == admin_id).all()
    ]
    if not user_ids:
        return []
    return db.query(Manager).filter(Manager.user_id.in_(user_ids)).all()


def revoke_permission_from_managers(db: Session, key: str, admin_id: int | None = None) -> None:
    """Force key=false on managers (optionally one fleet). Does not commit."""
    for manager in _managers_for_fleet(db, admin_id):
        perms = dict(manager.permissions or {})
        if perms.get(key):
            perms[key] = False
            manager.permissions = perms
            flag_modified(manager, "permissions")


def revoke_alert_type_from_managers(db: Session, alert_type: str, admin_id: int | None = None) -> None:
    """Force notification_prefs[alert_type]=false on managers. No commit."""
    for manager in _managers_for_fleet(db, admin_id):
        prefs = dict(manager.notification_prefs or {})
        if prefs.get(alert_type) is not False:
            prefs[alert_type] = False
            manager.notification_prefs = prefs
            flag_modified(manager, "notification_prefs")


def merge_bell_prefs(stored: dict | None, known_types: list[str], default: bool = True) -> dict[str, bool]:
    stored = stored or {}
    merged = {}
    for alert_type in known_types:
        merged[alert_type] = bool(stored[alert_type]) if alert_type in stored else default
    return merged


def user_applicable_keys(db: Session) -> set[str]:
    ensure_permission_definitions(db)
    rows = (
        db.query(PermissionDefinition.key)
        .filter(
            PermissionDefinition.is_active.is_(True),
            PermissionDefinition.applies_to_user.is_(True),
        )
        .all()
    )
    return {row.key for row in rows}


def manager_fleet_admin_id(db: Session, manager: Manager) -> int | None:
    user = db.query(User).filter(User.id == manager.user_id).first()
    return user.admin_id if user else None
