"""
Settings role defaults, user grants, and per-person notification prefs.

Calls route functions against in-memory SQLite so this does not need
live MySQL and does not start the Traccar poller.

Run with: python -m pytest tests/test_settings_role_prefs.py -v
(from the `backend` folder)
"""

from __future__ import annotations

import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from tracker_backend.models import AlertTypeSetting, Device, Manager, PermissionDefinition, User
from tracker_backend.schemas import (
    AlertTypeSettingUpdate,
    NotificationPrefsUpdate,
    PermissionDefinitionCreate,
    PermissionDefinitionUpdate,
    UserPermissionsUpdate,
)
from tracker_backend.services.settings_catalog import (
    DEFAULT_USER_PERMISSION_KEYS,
    USER_APPLICABLE_PERMISSION_KEYS,
    ensure_alert_type_settings,
    ensure_permission_definitions,
)


@pytest.fixture
def db():
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    PermissionDefinition.__table__.create(engine)
    AlertTypeSetting.__table__.create(engine)
    User.__table__.create(engine)
    Manager.__table__.create(engine)
    Device.__table__.create(engine)
    TestingSession = sessionmaker(bind=engine, autoflush=False, autocommit=False)
    session = TestingSession()
    try:
        yield session
    finally:
        session.close()


def test_catalog_user_default_flags(db):
    from tracker_backend.main import list_permission_definitions

    listed = list_permission_definitions(include_inactive=False, db=db)
    by_key = {row.key: row for row in listed}

    for key in USER_APPLICABLE_PERMISSION_KEYS:
        assert by_key[key].applies_to_user is True
    for key in DEFAULT_USER_PERMISSION_KEYS:
        assert by_key[key].default_for_new_users is True

    assert by_key["vehicle_management"].applies_to_user is False
    assert by_key["vehicle_management"].default_for_new_users is False


def test_cannot_default_user_without_applies_to_user(db):
    from tracker_backend.main import create_permission_definition, update_permission_definition

    with pytest.raises(HTTPException) as created:
        create_permission_definition(
            PermissionDefinitionCreate(
                key="fleet_admin",
                label="Fleet Admin",
                applies_to_user=False,
                default_for_new_users=True,
            ),
            db=db,
        )
    assert created.value.status_code == 400

    row = create_permission_definition(
        PermissionDefinitionCreate(key="fleet_admin", label="Fleet Admin"),
        db=db,
    )
    with pytest.raises(HTTPException) as updated:
        update_permission_definition(
            row.id,
            PermissionDefinitionUpdate(default_for_new_users=True),
            db=db,
        )
    assert updated.value.status_code == 400


def test_patch_user_permissions_rejects_manager_only_keys(db):
    from tracker_backend.main import update_user_permissions
    from tracker_backend.services.user_service import create_user_row

    ensure_permission_definitions(db)
    user = create_user_row(db, username="owner1", full_name="Owner One")

    with pytest.raises(HTTPException) as rejected:
        update_user_permissions(
            user.id,
            UserPermissionsUpdate(permissions={"vehicle_management": True}),
            db=db,
        )
    assert rejected.value.status_code == 400
    assert "vehicle_management" in rejected.value.detail

    updated = update_user_permissions(
        user.id,
        UserPermissionsUpdate(permissions={
            "live_tracking": True,
            "trip_history": False,
            "vehicle_management": False,
        }),
        db=db,
    )
    assert updated.permissions.get("live_tracking") is True
    assert "vehicle_management" not in updated.permissions
    assert updated.permissions.get("trip_history") is not True


def test_promote_grants_all_active_keys_and_offered_bells(db):
    from tracker_backend.main import delete_permission_definition, update_alert_type_setting
    from tracker_backend.services.manager_service import promote_user_to_manager
    from tracker_backend.services.user_service import create_user_row

    ensure_permission_definitions(db)
    ensure_alert_type_settings(db)

    vehicle = db.query(PermissionDefinition).filter_by(key="vehicle_management").one()
    delete_permission_definition(vehicle.id, db=db)

    update_alert_type_setting(
        "overspeed",
        AlertTypeSettingUpdate(offered_to_managers=False),
        db=db,
    )

    user = create_user_row(db, username="promo", full_name="Promo User")
    manager = promote_user_to_manager(db, user.id)
    assert manager.permissions.get("live_tracking") is True
    assert manager.permissions.get("trip_history") is True
    assert manager.permissions.get("vehicle_management") is not True
    assert manager.notification_prefs.get("harsh_brake") is True
    assert manager.notification_prefs.get("overspeed") is not True


def test_deactivate_revokes_permission_from_all_managers(db):
    from tracker_backend.main import delete_permission_definition
    from tracker_backend.services.manager_service import promote_user_to_manager
    from tracker_backend.services.user_service import create_user_row

    ensure_permission_definitions(db)
    ensure_alert_type_settings(db)
    user = create_user_row(db, username="revoke-mgr", full_name="Revoke Mgr")
    manager = promote_user_to_manager(db, user.id)
    assert manager.permissions.get("live_tracking") is True

    live = db.query(PermissionDefinition).filter_by(key="live_tracking").one()
    delete_permission_definition(live.id, db=db)
    db.refresh(manager)
    assert manager.permissions.get("live_tracking") is False


def test_unoffered_alert_revokes_manager_prefs(db):
    from tracker_backend.main import update_alert_type_setting
    from tracker_backend.services.manager_service import promote_user_to_manager
    from tracker_backend.services.user_service import create_user_row

    ensure_permission_definitions(db)
    ensure_alert_type_settings(db)
    user = create_user_row(db, username="bell-revoke", full_name="Bell Revoke")
    manager = promote_user_to_manager(db, user.id)
    assert manager.notification_prefs.get("silence") is True

    update_alert_type_setting(
        "silence",
        AlertTypeSettingUpdate(offered_to_managers=False),
        db=db,
    )
    db.refresh(manager)
    assert manager.notification_prefs.get("silence") is False


def test_alert_type_role_bell_patch(db):
    from tracker_backend.main import list_alert_type_settings, update_alert_type_setting

    rows = list_alert_type_settings(db=db)
    assert rows
    overspeed = next(row for row in rows if row.alert_type == "overspeed")
    assert overspeed.default_manager_bell is True

    updated = update_alert_type_setting(
        "overspeed",
        AlertTypeSettingUpdate(default_manager_bell=False, default_user_bell=False),
        db=db,
    )
    assert updated.default_manager_bell is False
    assert updated.default_user_bell is False
    assert updated.is_enabled is True


def test_notification_prefs_get_patch(db):
    from tracker_backend.main import (
        get_manager_notification_prefs,
        get_user_notification_prefs,
        update_manager_notification_prefs,
        update_user_notification_prefs,
    )
    from tracker_backend.services.manager_service import promote_user_to_manager
    from tracker_backend.services.user_service import create_user_row

    user = create_user_row(db, username="belluser", full_name="Bell User")
    user_prefs = get_user_notification_prefs(user.id, db=db)
    assert user_prefs.notification_prefs.get("overspeed") is True

    patched_user = update_user_notification_prefs(
        user.id,
        NotificationPrefsUpdate(notification_prefs={"overspeed": False}),
        db=db,
    )
    assert patched_user.notification_prefs.get("overspeed") is False
    assert patched_user.notification_prefs.get("silence") is True

    manager = promote_user_to_manager(db, user.id)
    manager_prefs = get_manager_notification_prefs(manager.id, db=db)
    assert "overspeed" in manager_prefs.notification_prefs

    patched_manager = update_manager_notification_prefs(
        manager.id,
        NotificationPrefsUpdate(notification_prefs={"silence": False}),
        db=db,
    )
    assert patched_manager.notification_prefs.get("silence") is False
