"""Permanent unauthenticated sweep: fleet /api/* must 401 except auth allowlist."""
from __future__ import annotations

import re

import pytest
from fastapi.routing import APIRoute

AUTH_ALLOWLIST_PREFIXES = (
    "/api/auth",
)

PUBLIC_EXACT = {
    "/",
    "/docs",
    "/redoc",
    "/openapi.json",
    "/uploads",
}


def _collect_api_routes():
    from tracker_backend.main import app

    out = []
    for route in app.routes:
        if not isinstance(route, APIRoute):
            continue
        path = route.path
        if not path.startswith("/api"):
            continue
        for method in sorted(route.methods or []):
            if method in ("HEAD", "OPTIONS"):
                continue
            out.append((method, path))
    return out


def _is_allowlisted(path: str) -> bool:
    if path in PUBLIC_EXACT:
        return True
    return any(path == p or path.startswith(p + "/") for p in AUTH_ALLOWLIST_PREFIXES)


def _fill_path_params(path: str) -> str:
    return re.sub(r"\{[^}]+\}", "1", path)


@pytest.mark.parametrize("method,path", _collect_api_routes())
def test_unauthenticated_api_routes_return_401(app_client, method, path):
    if _is_allowlisted(path):
        pytest.skip("auth allowlist")
    url = _fill_path_params(path)
    response = app_client.request(method, url)
    assert response.status_code == 401, f"{method} {url} -> {response.status_code}"
