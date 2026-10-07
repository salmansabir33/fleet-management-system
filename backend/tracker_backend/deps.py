"""Shared FastAPI dependencies.

Manager-panel permission checks live here so the scoped
`/api/manager/{manager_id}/...` routes can gate mutating endpoints
without touching the unrestricted admin `/api/managers*` CRUD.
"""
from typing import Annotated

from fastapi import Depends, Header, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from tracker_backend.db import SessionLocal
from tracker_backend.models import Admin, Manager, SuperAdmin, User
from tracker_backend.services import auth_service
from tracker_backend.services.fleet_scope import FleetScope

_bearer = HTTPBearer(auto_error=False)


def get_db():
    """Same session factory pattern as main.get_db — kept here so
    manager-panel deps don't have to import from main (circular).
    main.py keeps its own identical get_db for existing routes.
    """
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def get_manager_or_404(manager_id: int, db: Session = Depends(get_db)) -> Manager:
    manager = db.query(Manager).filter(Manager.id == manager_id).first()
    if manager is None:
        raise HTTPException(status_code=404, detail="Manager not found")
    return manager


def require_manager_permission(key: str):
    """Factory: returns a dependency that loads the Manager for the
    path's manager_id and 403s when permissions[key] is not truthy.
    Used by write endpoints; reads that should hard-403 use
    require_manager_read (same check, named for the GET side).
    """
    def dependency(
        manager_id: int,
        db: Session = Depends(get_db),
    ) -> Manager:
        manager = db.query(Manager).filter(Manager.id == manager_id).first()
        if manager is None:
            raise HTTPException(status_code=404, detail="Manager not found")
        if not (manager.permissions or {}).get(key):
            raise HTTPException(
                status_code=403,
                detail=f"Manager lacks '{key}' permission",
            )
        return manager

    return dependency


def require_any_manager_permission(*keys: str):
    """Like require_manager_permission, but 403s only when NONE of the
    listed keys are granted. Used by vehicle-photo upload, which both
    Add User and Edit Vehicle need to reach.
    """
    def dependency(
        manager_id: int,
        db: Session = Depends(get_db),
    ) -> Manager:
        manager = db.query(Manager).filter(Manager.id == manager_id).first()
        if manager is None:
            raise HTTPException(status_code=404, detail="Manager not found")
        perms = manager.permissions or {}
        if not any(perms.get(key) for key in keys):
            joined = "', '".join(keys)
            raise HTTPException(
                status_code=403,
                detail=f"Manager lacks any of '{joined}' permission",
            )
        return manager

    return dependency


def require_manager_read(key: str):
    """Same check as require_manager_permission — named separately so
    GET endpoints can be gated without implying a write.
    """
    return require_manager_permission(key)


def _decode_bearer(
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
) -> dict:
    if credentials is None or credentials.scheme.lower() != "bearer":
        raise HTTPException(status_code=401, detail="Not authenticated")
    payload = auth_service.decode_access_token(credentials.credentials)
    if payload is None:
        raise HTTPException(status_code=401, detail="Invalid or expired token")
    return payload


def get_current_principal(
    payload: Annotated[dict, Depends(_decode_bearer)],
    db: Session = Depends(get_db),
) -> dict:
    role = payload.get("role")

    if role == "super_admin":
        sa_id = payload.get("super_admin_id")
        if sa_id is None:
            raise HTTPException(status_code=401, detail="Invalid token payload")
        sa = db.query(SuperAdmin).filter(SuperAdmin.id == sa_id).first()
        if sa is None or not sa.is_active:
            raise HTTPException(status_code=401, detail="Super admin disabled or missing")
        return {
            "role": "super_admin",
            "sub": sa.username,
            "full_name": sa.full_name or "Super Admin",
            "super_admin_id": sa.id,
            "admin_id": None,
            "pic_url": None,
        }

    if role == "admin":
        admin_id = payload.get("admin_id")
        if admin_id is None:
            raise HTTPException(status_code=401, detail="Invalid token payload")
        admin = db.query(Admin).filter(Admin.id == admin_id).first()
        if admin is None or not admin.is_active:
            raise HTTPException(status_code=401, detail="Admin disabled or missing")
        return {
            "role": "admin",
            "sub": admin.username,
            "full_name": admin.full_name or "Administrator",
            "admin_id": admin.id,
            "pic_url": None,
        }

    user_id = payload.get("user_id")
    if user_id is None:
        raise HTTPException(status_code=401, detail="Invalid token payload")

    user = db.query(User).filter(User.id == user_id).first()
    if user is None:
        raise HTTPException(status_code=401, detail="User not found")

    manager = db.query(Manager).filter(Manager.user_id == user.id).first()
    return {
        "role": "manager" if manager is not None else "user",
        "sub": user.username,
        "full_name": user.full_name,
        "user_id": user.id,
        "manager_id": manager.id if manager else None,
        "admin_id": user.admin_id,
        "pic_url": f"/uploads/{user.pic_path}" if user.pic_path else None,
    }


def get_current_admin(
    principal: Annotated[dict, Depends(get_current_principal)],
) -> dict:
    if principal.get("role") not in ("admin", "super_admin"):
        raise HTTPException(status_code=403, detail="Admin access required")
    return principal


def require_super_admin(
    principal: Annotated[dict, Depends(get_current_principal)],
) -> dict:
    if principal.get("role") != "super_admin":
        raise HTTPException(status_code=403, detail="Super admin access required")
    return principal


def get_scope(
    principal: Annotated[dict, Depends(get_current_principal)],
    db: Session = Depends(get_db),
    x_acting_admin_id: Annotated[str | None, Header(alias="X-Acting-Admin-Id")] = None,
) -> FleetScope:
    """Single tenancy scope for all fleet routes."""
    role = principal.get("role")

    acting: int | None = None
    if x_acting_admin_id is not None and str(x_acting_admin_id).strip() != "":
        if role != "super_admin":
            raise HTTPException(
                status_code=403,
                detail="X-Acting-Admin-Id is only valid for super admin",
            )
        try:
            acting = int(x_acting_admin_id)
        except (TypeError, ValueError):
            raise HTTPException(status_code=400, detail="Invalid X-Acting-Admin-Id")
        admin = db.query(Admin).filter(Admin.id == acting).first()
        if admin is None:
            raise HTTPException(status_code=404, detail="Acting admin not found")
        if not admin.is_active:
            raise HTTPException(status_code=403, detail="Acting admin is disabled")

    if role == "super_admin":
        return FleetScope(
            role="super_admin",
            admin_id=acting,
            principal=principal,
            db=db,
            is_super_admin=True,
            acting_admin_id=acting,
        )

    if role == "admin":
        return FleetScope(
            role="admin",
            admin_id=principal.get("admin_id"),
            principal=principal,
            db=db,
            is_super_admin=False,
        )

    return FleetScope(
        role=role,
        admin_id=principal.get("admin_id"),
        principal=principal,
        db=db,
        is_super_admin=False,
    )


def require_manager_scope(
    manager_id: int,
    principal: Annotated[dict, Depends(get_current_principal)],
    db: Session = Depends(get_db),
    x_acting_admin_id: Annotated[str | None, Header(alias="X-Acting-Admin-Id")] = None,
) -> dict:
    """Ensures the caller may access `/api/manager/{manager_id}/...`.

    Managers: only their own JWT manager_id.
    Admins / super_admin (optionally acting): manager's linked user must
    share their effective admin_id.
    """
    role = principal.get("role")
    if role == "manager":
        token_manager_id = principal.get("manager_id")
        if token_manager_id is None or int(token_manager_id) != int(manager_id):
            raise HTTPException(
                status_code=403,
                detail="Cannot access another manager's workspace",
            )
        return principal

    if role not in ("admin", "super_admin"):
        raise HTTPException(status_code=403, detail="Manager or admin access required")

    scope = get_scope(principal, db, x_acting_admin_id)
    scope.assert_manager(manager_id)
    return principal
