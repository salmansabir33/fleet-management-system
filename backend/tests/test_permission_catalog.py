"""
Permission catalog endpoints: create, list (active-only by default),
soft-delete, and confirm the key drops out of /api/managers/permission-keys.

Calls the route functions against an in-memory SQLite catalog table so
this does not need live MySQL and does not start the Traccar poller.

Run with: python -m pytest tests/test_permission_catalog.py -v
(from the `backend` folder)
"""

from __future__ import annotations

import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from tracker_backend.models import PermissionDefinition
from tracker_backend.schemas import PermissionDefinitionCreate


@pytest.fixture
def db():
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    PermissionDefinition.__table__.create(engine)
    TestingSession = sessionmaker(bind=engine, autoflush=False, autocommit=False)
    session = TestingSession()
    try:
        yield session
    finally:
        session.close()


def test_permission_catalog_create_list_soft_delete(db):
    from tracker_backend.main import (
        create_permission_definition,
        delete_permission_definition,
        get_manager_permission_keys,
        list_permission_definitions,
    )

    created = create_permission_definition(
        PermissionDefinitionCreate(
            key="custom_reports",
            label="Custom Reports",
            description="ad-hoc report builder",
            default_for_new_managers=False,
        ),
        db=db,
    )
    assert created.key == "custom_reports"
    assert created.is_active is True

    with pytest.raises(HTTPException) as clash:
        create_permission_definition(
            PermissionDefinitionCreate(key="custom_reports", label="Duplicate"),
            db=db,
        )
    assert clash.value.status_code == 409

    listed = list_permission_definitions(include_inactive=False, db=db)
    assert "custom_reports" in [row.key for row in listed]

    permission_keys = get_manager_permission_keys(db=db)
    assert "custom_reports" in permission_keys["keys"]

    deleted = delete_permission_definition(created.id, db=db)
    assert deleted.is_active is False

    listed_active = list_permission_definitions(include_inactive=False, db=db)
    assert "custom_reports" not in [row.key for row in listed_active]

    listed_all = list_permission_definitions(include_inactive=True, db=db)
    assert "custom_reports" in [row.key for row in listed_all]

    permission_keys_after = get_manager_permission_keys(db=db)
    assert "custom_reports" not in permission_keys_after["keys"]
