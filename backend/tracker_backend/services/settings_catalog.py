"""Seed missing permission and alert-type catalog rows on read.

Keeps the admin Settings page complete even when new keys are added in
code before a dedicated Alembic migration runs.
"""
from sqlalchemy.orm import Session
from sqlalchemy.orm.attributes import flag_modified

from tracker_backend.models import AlertTypeSetting, Manager, PermissionDefinition

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


def default_bell_prefs(db: Session, role: str) -> dict[str, bool]:
    """Seed notification_prefs for a new manager or user.

    Managers get every type currently offered_to_managers (all on).
    Users still follow default_user_bell.
    """
    ensure_alert_type_settings(db)
    rows = db.query(AlertTypeSetting).all()
    if role == "user":
        return {row.alert_type: bool(row.default_user_bell) for row in rows}
    return {row.alert_type: True for row in rows if row.offered_to_managers}


def active_permission_keys(db: Session) -> set[str]:
    ensure_permission_definitions(db)
    rows = (
        db.query(PermissionDefinition.key)
        .filter(PermissionDefinition.is_active.is_(True))
        .all()
    )
    return {row.key for row in rows}


def offered_alert_types(db: Session) -> set[str]:
    ensure_alert_type_settings(db)
    rows = (
        db.query(AlertTypeSetting.alert_type)
        .filter(AlertTypeSetting.offered_to_managers.is_(True))
        .all()
    )
    return {row.alert_type for row in rows}


def revoke_permission_from_managers(db: Session, key: str) -> None:
    """Force key=false on every manager. Does not commit — caller does."""
    from sqlalchemy import inspect
    if not inspect(db.bind).has_table("managers"):
        return
    managers = db.query(Manager).all()
    for manager in managers:
        perms = dict(manager.permissions or {})
        if perms.get(key):
            perms[key] = False
            manager.permissions = perms
            flag_modified(manager, "permissions")


def revoke_alert_type_from_managers(db: Session, alert_type: str) -> None:
    """Force notification_prefs[alert_type]=false on every manager. No commit."""
    from sqlalchemy import inspect
    if not inspect(db.bind).has_table("managers"):
        return
    managers = db.query(Manager).all()
    for manager in managers:
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
