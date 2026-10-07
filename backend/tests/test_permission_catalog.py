"""
Permission catalog: global create (SA) + per-fleet offerings (admin).

Calls route functions against in-memory SQLite so this does not need
live MySQL and does not start the Traccar poller.

Run with: python -m pytest tests/test_permission_catalog.py -v
(from the `backend` folder)
"""

from __future__ import annotations

import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from tracker_backend.models import Admin, AdminPermissionOffering, PermissionDefinition
from tracker_backend.schemas import PermissionDefinitionCreate, PermissionDefinitionUpdate
from tracker_backend.services.fleet_scope import FleetScope


@pytest.fixture
def db():
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Admin.__table__.create(engine)
    PermissionDefinition.__table__.create(engine)
    AdminPermissionOffering.__table__.create(engine)
    TestingSession = sessionmaker(bind=engine, autoflush=False, autocommit=False)
    session = TestingSession()
    try:
        yield session
    finally:
        session.close()


def _sa_scope(db) -> FleetScope:
    return FleetScope(
        role="super_admin",
        admin_id=None,
        principal={"role": "super_admin"},
        db=db,
        is_super_admin=True,
        acting_admin_id=None,
    )


def _fleet_scope(db, admin_id: int) -> FleetScope:
    return FleetScope(
        role="admin",
        admin_id=admin_id,
        principal={"role": "admin", "admin_id": admin_id},
        db=db,
        is_super_admin=False,
        acting_admin_id=None,
    )


def test_permission_catalog_fleet_offerings(db):
    from tracker_backend.main import (
        create_permission_definition,
        delete_permission_definition,
        get_manager_permission_keys,
        list_permission_definitions,
        update_permission_definition,
    )

    admin_a = Admin(username="admin_a", password_hash="x", is_active=True)
    admin_b = Admin(username="admin_b", password_hash="x", is_active=True)
    db.add_all([admin_a, admin_b])
    db.commit()
    db.refresh(admin_a)
    db.refresh(admin_b)

    sa = _sa_scope(db)
    fleet_a = _fleet_scope(db, admin_a.id)
    fleet_b = _fleet_scope(db, admin_b.id)

    created = create_permission_definition(
        PermissionDefinitionCreate(
            key="custom_reports",
            label="Custom Reports",
            description="ad-hoc report builder",
            default_for_new_managers=False,
        ),
        db=db,
        scope=sa,
    )
    assert created.key == "custom_reports"
    assert created.is_active is True

    with pytest.raises(HTTPException) as clash:
        create_permission_definition(
            PermissionDefinitionCreate(key="custom_reports", label="Duplicate"),
            db=db,
            scope=sa,
        )
    assert clash.value.status_code == 409

    # Both fleets see the key offered by default
    listed_a = list_permission_definitions(include_inactive=False, db=db, scope=fleet_a)
    assert "custom_reports" in [row.key for row in listed_a]
    keys_a = get_manager_permission_keys(db=db, scope=fleet_a)
    assert "custom_reports" in keys_a["keys"]

    # Fleet A un-offers — only fleet A's managers lose it
    deleted = delete_permission_definition(created.id, db=db, scope=fleet_a)
    assert deleted.is_active is False

    listed_a_active = list_permission_definitions(include_inactive=False, db=db, scope=fleet_a)
    assert "custom_reports" not in [row.key for row in listed_a_active]

    listed_a_all = list_permission_definitions(include_inactive=True, db=db, scope=fleet_a)
    assert "custom_reports" in [row.key for row in listed_a_all]
    assert all(row.is_active is False for row in listed_a_all if row.key == "custom_reports")

    keys_a_after = get_manager_permission_keys(db=db, scope=fleet_a)
    assert "custom_reports" not in keys_a_after["keys"]

    # Fleet B still offered
    listed_b = list_permission_definitions(include_inactive=False, db=db, scope=fleet_b)
    assert "custom_reports" in [row.key for row in listed_b]
    keys_b = get_manager_permission_keys(db=db, scope=fleet_b)
    assert "custom_reports" in keys_b["keys"]

    # Fleet A can re-offer
    restored = update_permission_definition(
        created.id,
        PermissionDefinitionUpdate(is_active=True),
        db=db,
        scope=fleet_a,
    )
    assert restored.is_active is True
    keys_a_restored = get_manager_permission_keys(db=db, scope=fleet_a)
    assert "custom_reports" in keys_a_restored["keys"]
