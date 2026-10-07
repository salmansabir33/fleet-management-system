"""Shared fixtures for tenancy / auth isolation tests.

Phase 0: fixtures document the *target* multi-admin contract. Once
Phase 1 adds Admin / admin_id columns, seed helpers here create two
disjoint fleets. Until then, route-introspection helpers still work.
"""
from __future__ import annotations

from contextlib import asynccontextmanager
from typing import Any, Callable

import pytest
from fastapi.dependencies.models import Dependant
from fastapi.routing import APIRoute


FLEET_PATHS_REQUIRE_AUTH = [
    ("GET", "/api/users"),
    ("DELETE", "/api/users/{user_id}"),
    ("GET", "/api/fleet/devices"),
    ("GET", "/api/geofences"),
    ("GET", "/api/routes"),
    ("GET", "/api/drivers"),
    ("GET", "/api/trips"),
    ("GET", "/api/live"),
    ("GET", "/api/positions"),
    ("GET", "/api/users/{user_id}/password"),
]


def _dependant_uses_call(dependant: Dependant, predicate: Callable[[Any], bool]) -> bool:
    """Walk a FastAPI Dependant tree looking for a matching call."""
    if dependant.call is not None and predicate(dependant.call):
        return True
    for child in dependant.dependencies:
        if _dependant_uses_call(child, predicate):
            return True
    return False


def route_requires_auth(path: str, method: str) -> bool:
    """True if the route's dependency tree includes bearer/principal/admin/scope."""
    from tracker_backend.main import app
    from tracker_backend import deps as deps_mod

    auth_calls = {
        deps_mod._decode_bearer,
        deps_mod.get_current_principal,
        deps_mod.get_current_admin,
        getattr(deps_mod, "require_super_admin", None),
        getattr(deps_mod, "get_scope", None),
    }
    auth_calls.discard(None)

    method_u = method.upper()
    for route in app.routes:
        if not isinstance(route, APIRoute):
            continue
        if route.path != path:
            continue
        if method_u not in (route.methods or set()):
            continue
        return _dependant_uses_call(
            route.dependant,
            lambda call: call in auth_calls or getattr(call, "__name__", "") in (
                "get_scope",
                "require_super_admin",
                "get_current_admin",
                "get_current_principal",
                "_decode_bearer",
            ),
        )
    raise AssertionError(f"No route found for {method} {path}")


@pytest.fixture(autouse=True)
def _disable_login_rate_limit(monkeypatch):
    """Auth sweep + phase0 tests perform many login attempts in one session."""
    from tracker_backend import auth_routes, rate_limit

    rate_limit._buckets.clear()
    noop = lambda *args, **kwargs: None
    monkeypatch.setattr(rate_limit, "check_rate_limit", noop)
    monkeypatch.setattr(auth_routes, "check_rate_limit", noop)
    yield
    rate_limit._buckets.clear()


@pytest.fixture
def app_client():
    """HTTP client against the real app with lifespan disabled (no poller)."""
    from fastapi.testclient import TestClient
    from tracker_backend.main import app

    @asynccontextmanager
    async def _noop_lifespan(_app):
        yield

    previous = app.router.lifespan_context
    app.router.lifespan_context = _noop_lifespan
    try:
        with TestClient(app, raise_server_exceptions=False) as client:
            yield client
    finally:
        app.router.lifespan_context = previous
