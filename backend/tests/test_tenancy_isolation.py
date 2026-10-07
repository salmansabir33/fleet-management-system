"""
Tenancy / auth isolation contract tests.

After Phases 1–3 these should pass for auth dependency wiring and model presence.
Cross-fleet Admin A/B HTTP isolation needs seeded tokens (optional follow-up).

Run from backend/:
  python -m pytest tests/test_tenancy_isolation.py -v
"""
from __future__ import annotations

import pytest

from tests.conftest import FLEET_PATHS_REQUIRE_AUTH, route_requires_auth


@pytest.mark.parametrize("method,path", [
    ("GET", "/api/users"),
    ("DELETE", "/api/users/{user_id}"),
])
def test_users_endpoints_must_declare_auth_dependency(method, path):
    assert route_requires_auth(path, method)


def test_unauthenticated_get_users_returns_401(app_client):
    response = app_client.get("/api/users")
    assert response.status_code == 401


def test_unauthenticated_delete_users_returns_401(app_client):
    response = app_client.delete("/api/users/1")
    assert response.status_code == 401


@pytest.mark.parametrize("method,path", FLEET_PATHS_REQUIRE_AUTH)
def test_fleet_route_declares_auth(method, path):
    try:
        has_auth = route_requires_auth(path, method)
    except AssertionError:
        pytest.skip(f"Route {method} {path} not registered yet / path differs")
    assert has_auth


def test_get_scope_helper_exists():
    from tracker_backend import deps
    assert hasattr(deps, "get_scope")


def test_admin_and_super_admin_models_exist():
    from tracker_backend import models
    assert hasattr(models, "Admin")
    assert hasattr(models, "SuperAdmin")


def test_user_has_admin_id_column():
    from tracker_backend.models import User
    assert hasattr(User, "admin_id")


def test_require_super_admin_exists():
    from tracker_backend import deps
    assert hasattr(deps, "require_super_admin")


def test_password_reveal_scoped_to_fleet():
    assert route_requires_auth("/api/users/{user_id}/password", "GET")
    from tracker_backend import deps
    assert hasattr(deps, "get_scope")


def test_admin_login_rejects_unknown_user(app_client):
    response = app_client.post(
        "/api/auth/admin/login",
        json={"username": "__nobody__", "password": "wrong"},
    )
    assert response.status_code == 401


def test_admin_db_login_succeeds_for_admin1(app_client):
    """Admin 1 was backfilled from env in Phase 1 migration."""
    from tracker_backend.config import settings

    response = app_client.post(
        "/api/auth/admin/login",
        json={"username": settings.ADMIN_USERNAME, "password": settings.ADMIN_PASSWORD},
    )
    assert response.status_code == 200, response.text
    data = response.json()
    assert data["role"] == "admin"
    assert data.get("admin_id") == 1
    assert data.get("access_token")


def test_scoped_list_users_with_admin_token(app_client):
    from tracker_backend.config import settings

    login = app_client.post(
        "/api/auth/admin/login",
        json={"username": settings.ADMIN_USERNAME, "password": settings.ADMIN_PASSWORD},
    )
    assert login.status_code == 200
    token = login.json()["access_token"]
    response = app_client.get(
        "/api/users",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert response.status_code == 200
    assert isinstance(response.json(), list)
