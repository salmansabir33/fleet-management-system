"""Phase 0 super-admin global mode and tenancy list/create rules."""
from __future__ import annotations

import os
import uuid

import pytest

from tracker_backend.config import settings
from tracker_backend.db import SessionLocal
from tracker_backend.models import Admin, Device, Driver, Geofence, Route, SuperAdmin, User
from tracker_backend.services.auth_service import hash_password

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


def _ensure_second_admin(db) -> Admin:
    admin = db.query(Admin).filter(Admin.id == 2).first()
    if admin is not None:
        return admin
    admin = Admin(
        username=f"phase0_admin2_{uuid.uuid4().hex[:8]}",
        password_hash=hash_password("phase0-admin2-pass!!"),
        full_name="Fleet Two",
        is_active=True,
    )
    db.add(admin)
    db.commit()
    db.refresh(admin)
    return admin


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
    assert login.json()["role"] == "super_admin"
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


def test_sa_global_lists_include_orphans(app_client):
    token = _sa_token(app_client)
    headers = {"Authorization": f"Bearer {token}"}

    orphan_username = _unique("orphan_list")
    create = app_client.post(
        "/api/users",
        headers=headers,
        json={
            "username": orphan_username,
            "password": "ValidPass123!",
            "full_name": "Orphan List User",
            "admin_id": 1,
        },
    )
    assert create.status_code == 200, create.text
    user_id = create.json()["id"]
    moved = app_client.post(
        f"/api/super-admin/users/{user_id}/move",
        headers=headers,
        json={"admin_id": None},
    )
    assert moved.status_code == 200, moved.text

    listed = app_client.get("/api/users", headers=headers)
    assert listed.status_code == 200
    names = {u["username"] for u in listed.json()}
    assert orphan_username in names


def test_create_geofence_without_admin_id_global_sa_400(app_client):
    token = _sa_token(app_client)
    headers = {"Authorization": f"Bearer {token}"}
    resp = app_client.post(
        "/api/geofences",
        headers=headers,
        json={
            "name": _unique("gf"),
            "center_lat": 33.0,
            "center_lon": 73.0,
            "radius_meters": 500,
        },
    )
    assert resp.status_code == 400


def test_create_user_without_admin_id_global_sa_400(app_client):
    token = _sa_token(app_client)
    headers = {"Authorization": f"Bearer {token}"}
    username = _unique("orphan_create")
    resp = app_client.post(
        "/api/users",
        headers=headers,
        json={"username": username, "password": "ValidPass123!", "full_name": "Orphan"},
    )
    assert resp.status_code == 400


def test_admin_query_admin_id_403(app_client):
    token = _admin1_token(app_client)
    headers = {"Authorization": f"Bearer {token}"}
    resp = app_client.get("/api/users?admin_id=1", headers=headers)
    assert resp.status_code == 403


def test_sa_header_and_query_admin_id_differ_400(app_client):
    token = _sa_token(app_client)
    headers = {
        "Authorization": f"Bearer {token}",
        "X-Acting-Admin-Id": "1",
    }
    resp = app_client.get("/api/users?admin_id=2", headers=headers)
    assert resp.status_code == 400


def test_admin_403_on_super_admin_admins(app_client):
    token = _admin1_token(app_client)
    headers = {"Authorization": f"Bearer {token}"}
    resp = app_client.get("/api/super-admin/admins", headers=headers)
    assert resp.status_code == 403


def test_admin_403_create_fuel_type(app_client):
    token = _admin1_token(app_client)
    headers = {"Authorization": f"Bearer {token}"}
    resp = app_client.post(
        "/api/fuel-types",
        headers=headers,
        json={"name": _unique("fuel")},
    )
    assert resp.status_code == 403


def test_cross_fleet_route_assign_rejected(app_client):
    db = SessionLocal()
    try:
        _ensure_super_admin(db)
        admin2 = _ensure_second_admin(db)
        gf1 = Geofence(
            name=_unique("gf_a1"),
            center_lat=1.0,
            center_lon=1.0,
            radius_meters=100,
            admin_id=1,
        )
        gf2 = Geofence(
            name=_unique("gf_a2"),
            center_lat=2.0,
            center_lon=2.0,
            radius_meters=100,
            admin_id=admin2.id,
        )
        db.add_all([gf1, gf2])
        db.commit()
        db.refresh(gf1)
        db.refresh(gf2)

        route = Route(
            name=_unique("route_a1"),
            waypoints=[{"lat": 1.0, "lon": 1.0}],
            path=[{"lat": 1.0, "lon": 1.0}],
            tolerance_meters=400,
            admin_id=1,
        )
        db.add(route)
        db.commit()
        db.refresh(route)

        user_b = User(
            username=_unique("user_b"),
            password_hash=hash_password("ValidPass123!"),
            admin_id=admin2.id,
        )
        db.add(user_b)
        db.commit()
        db.refresh(user_b)

        device_b = Device(
            traccar_device_id=int(uuid.uuid4().int % 2_000_000_000),
            name=_unique("veh_b"),
            user_id=user_b.id,
            admin_id=admin2.id,
            primary_geofence_id=gf2.id,
        )
        db.add(device_b)
        db.commit()
        db.refresh(device_b)
        route_id = route.id
        device_id = device_b.id
    finally:
        db.close()

    token = _sa_token(app_client)
    headers = {"Authorization": f"Bearer {token}"}
    resp = app_client.post(
        f"/api/routes/{route_id}/vehicles",
        headers=headers,
        json={"device_id": device_id},
    )
    assert resp.status_code == 400


def test_orphan_user_get_as_sa(app_client):
    token = _sa_token(app_client)
    headers = {"Authorization": f"Bearer {token}"}
    username = _unique("orphan_get")
    created = app_client.post(
        "/api/users",
        headers=headers,
        json={"username": username, "password": "ValidPass123!", "admin_id": 1},
    )
    assert created.status_code == 200
    user_id = created.json()["id"]
    moved = app_client.post(
        f"/api/super-admin/users/{user_id}/move",
        headers=headers,
        json={"admin_id": None},
    )
    assert moved.status_code == 200, moved.text
    got = app_client.get(f"/api/users/{user_id}", headers=headers)
    assert got.status_code == 200
    assert got.json()["username"] == username
    assert got.json().get("admin_id") is None


def test_cross_fleet_driver_assign_rejected(app_client):
    db = SessionLocal()
    try:
        admin2 = _ensure_second_admin(db)
        driver_a = Driver(
            name=_unique("drv_a"),
            id_card_number=f"35202-{uuid.uuid4().int % 10_000_000:07d}-1",
            admin_id=1,
        )
        user_b = User(
            username=_unique("user_drv_b"),
            password_hash=hash_password("ValidPass123!"),
            admin_id=admin2.id,
        )
        db.add_all([driver_a, user_b])
        db.commit()
        db.refresh(driver_a)
        db.refresh(user_b)
        device_b = Device(
            traccar_device_id=int(uuid.uuid4().int % 2_000_000_000),
            name=_unique("veh_drv_b"),
            user_id=user_b.id,
            admin_id=admin2.id,
        )
        db.add(device_b)
        db.commit()
        db.refresh(device_b)
        driver_id = driver_a.id
        device_id = device_b.id
    finally:
        db.close()

    token = _sa_token(app_client)
    headers = {"Authorization": f"Bearer {token}"}
    resp = app_client.post(
        f"/api/drivers/{driver_id}/assign?device_id={device_id}",
        headers=headers,
    )
    assert resp.status_code == 400
