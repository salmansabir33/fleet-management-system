"""Fleet tenancy scope helpers.

One place for who can see which users/devices/geofences/routes/drivers.
"""
from __future__ import annotations

from dataclasses import dataclass

from fastapi import HTTPException
from sqlalchemy.orm import Session

from tracker_backend.models import Admin, Device, Driver, Geofence, Manager, Route, User
from tracker_backend.services import manager_service


@dataclass
class FleetScope:
    """Resolved access for the current principal (and optional acting admin)."""

    role: str
    admin_id: int | None  # effective fleet filter; None for super_admin all-access
    principal: dict
    db: Session
    is_super_admin: bool = False
    acting_admin_id: int | None = None

    @property
    def sees_all(self) -> bool:
        return self.is_super_admin and self.admin_id is None

    def filter_admin_id(self, query, column):
        """Apply tenant filter when scoped to one admin; no-op when sees_all."""
        if self.sees_all:
            return query
        if self.admin_id is None and self.role == "super_admin":
            return query
        return query.filter(column == self.admin_id)

    def device_ids(self) -> set[int] | None:
        """None = unrestricted (super admin, no acting). Else allowed device ids."""
        if self.sees_all:
            return None
        if self.role in ("admin", "super_admin"):
            rows = (
                self.db.query(Device.id)
                .filter(Device.admin_id == self.admin_id)
                .all()
            )
            return {r[0] for r in rows}
        if self.role == "manager":
            mid = self.principal.get("manager_id")
            if mid is None:
                return set()
            return set(manager_service.get_device_ids_for_manager(self.db, mid))
        if self.role == "user":
            uid = self.principal.get("user_id")
            if uid is None:
                return set()
            rows = self.db.query(Device.id).filter(Device.user_id == uid).all()
            return {r[0] for r in rows}
        return set()

    def assert_device(self, device_id: int) -> Device:
        device = self.db.query(Device).filter(Device.id == device_id).first()
        if device is None:
            raise HTTPException(status_code=404, detail="Device not found")
        allowed = self.device_ids()
        if allowed is not None and device.id not in allowed:
            raise HTTPException(status_code=403, detail="Device out of scope")
        return device

    def assert_user(self, user_id: int) -> User:
        user = self.db.query(User).filter(User.id == user_id).first()
        if user is None:
            raise HTTPException(status_code=404, detail="User not found")
        if self.sees_all:
            return user
        if self.role in ("admin", "super_admin"):
            if user.admin_id != self.admin_id:
                raise HTTPException(status_code=403, detail="User out of scope")
            return user
        if self.role == "manager":
            mid = self.principal.get("manager_id")
            if user.manager_id != mid and user.id != self.principal.get("user_id"):
                raise HTTPException(status_code=403, detail="User out of scope")
            return user
        if self.role == "user":
            if user.id != self.principal.get("user_id"):
                raise HTTPException(status_code=403, detail="User out of scope")
            return user
        raise HTTPException(status_code=403, detail="User out of scope")

    def assert_geofence(self, geofence_id: int) -> Geofence:
        row = self.db.query(Geofence).filter(Geofence.id == geofence_id).first()
        if row is None:
            raise HTTPException(status_code=404, detail="Geofence not found")
        if not self.sees_all and row.admin_id != self.admin_id:
            raise HTTPException(status_code=403, detail="Geofence out of scope")
        return row

    def assert_route(self, route_id: int) -> Route:
        row = self.db.query(Route).filter(Route.id == route_id).first()
        if row is None:
            raise HTTPException(status_code=404, detail="Route not found")
        if not self.sees_all and row.admin_id != self.admin_id:
            raise HTTPException(status_code=403, detail="Route out of scope")
        return row

    def assert_driver(self, driver_id: int) -> Driver:
        row = self.db.query(Driver).filter(Driver.id == driver_id).first()
        if row is None:
            raise HTTPException(status_code=404, detail="Driver not found")
        if not self.sees_all and row.admin_id != self.admin_id:
            raise HTTPException(status_code=403, detail="Driver out of scope")
        return row

    def assert_manager(self, manager_id: int) -> Manager:
        manager = self.db.query(Manager).filter(Manager.id == manager_id).first()
        if manager is None:
            raise HTTPException(status_code=404, detail="Manager not found")
        user = self.db.query(User).filter(User.id == manager.user_id).first()
        if user is None:
            raise HTTPException(status_code=404, detail="Manager user not found")
        if self.sees_all:
            return manager
        if self.role in ("admin", "super_admin"):
            if user.admin_id != self.admin_id:
                raise HTTPException(status_code=403, detail="Manager out of scope")
            return manager
        if self.role == "manager":
            if int(manager.id) != int(self.principal.get("manager_id") or -1):
                raise HTTPException(status_code=403, detail="Manager out of scope")
            return manager
        raise HTTPException(status_code=403, detail="Manager out of scope")

    def stamp_admin_id(self) -> int | None:
        """admin_id to write on new fleet rows (None only for super_admin unassigned)."""
        if self.role == "admin":
            return self.admin_id
        if self.role == "super_admin":
            return self.admin_id  # acting fleet, or None = orphan
        if self.role == "manager":
            uid = self.principal.get("user_id")
            user = self.db.query(User).filter(User.id == uid).first()
            return user.admin_id if user else None
        return None

    def require_admin_like(self) -> None:
        if self.role not in ("admin", "super_admin"):
            raise HTTPException(status_code=403, detail="Admin access required")

    def require_super_admin(self) -> None:
        if not self.is_super_admin:
            raise HTTPException(status_code=403, detail="Super admin access required")


def resolve_list_admin_filter(
    scope: FleetScope,
    query_admin_id: int | None,
) -> int | None:
    """List-endpoint tenant filter: None = all fleets (global SA only)."""
    if scope.role == "admin":
        if query_admin_id is not None:
            raise HTTPException(status_code=403, detail="admin_id query not allowed")
        return scope.admin_id

    if scope.role == "super_admin":
        if query_admin_id is not None and scope.acting_admin_id is not None:
            if int(query_admin_id) != int(scope.acting_admin_id):
                raise HTTPException(
                    status_code=400,
                    detail="admin_id query conflicts with X-Acting-Admin-Id",
                )
        if query_admin_id is not None:
            return int(query_admin_id)
        if scope.acting_admin_id is not None:
            return scope.acting_admin_id
        return None

    if query_admin_id is not None:
        raise HTTPException(status_code=403, detail="admin_id query not allowed")
    return scope.admin_id


def require_create_admin_id(
    scope: FleetScope,
    body_admin_id: int | None,
) -> int:
    """Geofence / route / driver create — no orphan rows."""
    if scope.role == "admin":
        if scope.admin_id is None:
            raise HTTPException(status_code=403, detail="Admin access required")
        return scope.admin_id

    if scope.role == "super_admin":
        if scope.acting_admin_id is not None:
            return scope.acting_admin_id
        if body_admin_id is None:
            raise HTTPException(
                status_code=400,
                detail="admin_id is required when not acting as a fleet admin",
            )
        admin = scope.db.query(Admin).filter(Admin.id == body_admin_id).first()
        if admin is None:
            raise HTTPException(status_code=404, detail="Admin not found")
        if not admin.is_active:
            raise HTTPException(status_code=403, detail="Admin is disabled")
        return int(body_admin_id)

    stamped = scope.stamp_admin_id()
    if stamped is None:
        raise HTTPException(status_code=400, detail="admin_id is required")
    return stamped


def resolve_user_create_admin_id(
    scope: FleetScope,
    body_admin_id: int | None,
) -> int:
    """User create — admin_id required (no orphan users for global SA)."""
    if scope.role == "admin":
        if scope.admin_id is None:
            raise HTTPException(status_code=403, detail="Admin access required")
        return scope.admin_id

    if scope.role == "super_admin":
        if scope.acting_admin_id is not None:
            return scope.acting_admin_id
        if body_admin_id is None:
            raise HTTPException(
                status_code=400,
                detail="admin_id is required when not acting as a fleet admin",
            )
        admin = scope.db.query(Admin).filter(Admin.id == body_admin_id).first()
        if admin is None:
            raise HTTPException(status_code=404, detail="Admin not found")
        if not admin.is_active:
            raise HTTPException(status_code=403, detail="Admin is disabled")
        return int(body_admin_id)

    stamped = scope.stamp_admin_id()
    if stamped is None:
        raise HTTPException(status_code=400, detail="admin_id is required")
    return stamped


def assert_same_admin(
    a_id: int | None,
    b_id: int | None,
    *,
    detail: str = "Cross-fleet operation not allowed",
) -> None:
    if a_id != b_id:
        raise HTTPException(status_code=400, detail=detail)


def apply_list_admin_filter(scope: FleetScope, query, column, query_admin_id: int | None):
    """Apply optional ?admin_id= filter for list queries."""
    filter_id = resolve_list_admin_filter(scope, query_admin_id)
    if filter_id is not None:
        return query.filter(column == filter_id)
    return query


def require_global_super_admin_catalog(scope: FleetScope) -> None:
    """Catalog writes: global super admin only (not acting, not fleet admin)."""
    if scope.role != "super_admin" or scope.acting_admin_id is not None:
        raise HTTPException(status_code=403, detail="Only Super Admin can edit global settings")


def require_fleet_offering_admin_id(scope: FleetScope) -> int:
    """Fleet admin (or SA acting as a fleet) required to edit manager offerings."""
    scope.require_admin_like()
    admin_id = scope.stamp_admin_id()
    if admin_id is None:
        raise HTTPException(
            status_code=400,
            detail="Select a fleet (or act as an admin) to edit manager offerings",
        )
    return int(admin_id)
