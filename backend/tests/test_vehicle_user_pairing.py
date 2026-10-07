"""Vehicle–user pairing: claim, assign-manager, DeviceCreate user_id, cleanup script."""
from __future__ import annotations

import os
import uuid
from unittest.mock import MagicMock

from tracker_backend.config import settings
from tracker_backend.db import SessionLocal
from tracker_backend.models import Device, SuperAdmin, User
from tracker_backend.services.auth_service import hash_password
from tracker_backend.services.manager_service import promote_user_to_manager
from tracker_backend.scripts.cleanup_orphan_test_users import list_orphan_users

SA_USERNAME = (os.environ.get("SUPER_ADMIN_USERNAME") or "phase0_superadmin").strip()
SA_PASSWORD = os.environ.get("SUPER_ADMIN_PASSWORD") or "phase0-super-pass-32chars!!"


def _ensure_super_admin(db) -> SuperAdmin:
    row = db.query(SuperAdmin).first()
    if row is None:
        row = SuperAdmin(
            username=SA_USERNAME,
            password_hash=hash_password(SA_PASSWORD),
            full_name="Phase0 Super Admin",
            is_active=True,
            singleton_key=1,
        )
        db.add(row)
    else:
        row.password_hash = hash_password(SA_PASSWORD)
        row.is_active = True
    db.commit()
    db.refresh(row)
    return row


def _sa_token(app_client) -> str:
    db = SessionLocal()
    try:
        sa = _ensure_super_admin(db)
        sa_username = sa.username
    finally:
        db.close()
    login = app_client.post(
        "/api/auth/admin/login",
        json={"username": sa_username, "password": SA_PASSWORD},
    )
    assert login.status_code == 200, login.text
    return login.json()["access_token"]


def _admin1_token(app_client) -> str:
    login = app_client.post(
        "/api/auth/admin/login",
        json={"username": settings.ADMIN_USERNAME, "password": settings.ADMIN_PASSWORD},
    )
    assert login.status_code == 200, login.text
    return login.json()["access_token"]


def _unique(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex[:10]}"


def test_device_create_without_user_id_422(app_client):
    token = _admin1_token(app_client)
    headers = {"Authorization": f"Bearer {token}"}
    resp = app_client.post(
        "/api/fleet/devices",
        headers=headers,
        json={
            "name": _unique("veh"),
            "imei": f"imei{_unique('x')}"[:20],
        },
    )
    assert resp.status_code == 422


def test_claim_creates_owner(app_client):
    token = _admin1_token(app_client)
    headers = {"Authorization": f"Bearer {token}"}

    db = SessionLocal()
    try:
        device = Device(
            traccar_device_id=int(uuid.uuid4().int % 2_000_000_000),
            name=_unique("claim_veh"),
            user_id=None,
            admin_id=1,
        )
        db.add(device)
        db.commit()
        db.refresh(device)
        device_id = device.id
    finally:
        db.close()

    username = _unique("claim_owner")
    resp = app_client.post(
        f"/api/fleet/devices/{device_id}/claim",
        headers=headers,
        json={
            "create_user": {
                "username": username,
                "password": "ValidPass123!",
                "full_name": "Claim Owner",
            },
            "name": "Renamed Claim Vehicle",
        },
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["user_id"] is not None
    assert body["admin_id"] == 1
    assert body["name"] == "Renamed Claim Vehicle"
    assert body["owner_username"] == username

    db = SessionLocal()
    try:
        user = db.query(User).filter(User.username == username).first()
        assert user is not None
        assert user.admin_id == 1
        device = db.query(Device).filter(Device.id == device_id).first()
        assert device is not None
        assert device.user_id == user.id
    finally:
        db.close()


def test_assign_manager(app_client):
    token = _sa_token(app_client)
    headers = {"Authorization": f"Bearer {token}"}

    db = SessionLocal()
    try:
        mgr_user = User(
            username=_unique("pair_mgr"),
            password_hash=hash_password("ValidPass123!"),
            admin_id=1,
        )
        target = User(
            username=_unique("pair_assignee"),
            password_hash=hash_password("ValidPass123!"),
            admin_id=1,
        )
        db.add_all([mgr_user, target])
        db.commit()
        db.refresh(mgr_user)
        db.refresh(target)
        manager = promote_user_to_manager(db, mgr_user.id)
        manager_id = manager.id
        user_id = target.id
    finally:
        db.close()

    resp = app_client.post(
        f"/api/super-admin/users/{user_id}/assign-manager",
        headers=headers,
        json={"admin_id": 1, "manager_id": manager_id},
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["id"] == user_id

    db = SessionLocal()
    try:
        user = db.query(User).filter(User.id == user_id).first()
        assert user is not None
        assert user.manager_id == manager_id
        assert user.admin_id == 1
    finally:
        db.close()


def test_list_orphan_users_only_matches_orphan_prefix():
    """Unit test: list_orphan_users filters username LIKE orphan_%."""
    matching = MagicMock()
    matching.username = "orphan_abc"
    matching.id = 1

    db = MagicMock()
    query = MagicMock()
    db.query.return_value = query
    query.filter.return_value = query
    query.order_by.return_value = query
    query.all.return_value = [matching]

    result = list_orphan_users(db)
    assert result == [matching]
    filter_call = query.filter.call_args
    assert filter_call is not None
    expr = filter_call[0][0]
    # Bound LIKE value is on the right-hand side of the BinaryExpression
    rhs = getattr(expr, "right", None)
    value = getattr(rhs, "value", None)
    assert value == "orphan_%"
