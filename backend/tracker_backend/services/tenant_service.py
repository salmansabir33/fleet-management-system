"""Tenant moves — reassign users (and owned devices) between fleet admins."""
from __future__ import annotations

from datetime import datetime

from fastapi import HTTPException
from sqlalchemy.orm import Session

from tracker_backend.models import Device, DriverAssignment, Manager, User
from tracker_backend.services.driver_service import get_active_assignment_for_device
from tracker_backend.services.route_assignment_service import get_active_assignment_for_device as get_active_route_for_device


def set_user_admin_id(db: Session, user: User, admin_id: int | None) -> None:
    """Update user.admin_id and their owned device's admin_id together."""
    user.admin_id = admin_id
    device = db.query(Device).filter(Device.user_id == user.id).first()
    if device is not None:
        device.admin_id = admin_id


def _maybe_clear_manager(db: Session, user: User, new_admin_id: int | None) -> None:
    if user.manager_id is None:
        return
    manager = db.query(Manager).filter(Manager.id == user.manager_id).first()
    if manager is None:
        user.manager_id = None
        return
    manager_user = db.query(User).filter(User.id == manager.user_id).first()
    if manager_user is None or manager_user.admin_id != new_admin_id:
        user.manager_id = None


def _reset_device_fleet_links(db: Session, device: Device, at_time: datetime | None = None) -> None:
    """Close open route/driver assignments and clear primary geofence on move."""
    at_time = at_time or datetime.utcnow()
    open_route = get_active_route_for_device(db, device.id)
    if open_route is not None:
        open_route.end_time = at_time
    open_driver = get_active_assignment_for_device(db, device.id)
    if open_driver is not None:
        open_driver.end_time = at_time
    device.primary_geofence_id = None


def _apply_user_move(db: Session, user: User, admin_id: int | None, at_time: datetime) -> None:
    set_user_admin_id(db, user, admin_id)
    _maybe_clear_manager(db, user, admin_id)
    device = db.query(Device).filter(Device.user_id == user.id).first()
    if device is not None:
        _reset_device_fleet_links(db, device, at_time)


def move_user(db: Session, user_id: int, admin_id: int | None) -> User:
    """Move one user (and managed users if they are a manager) to another fleet."""
    user = db.query(User).filter(User.id == user_id).first()
    if user is None:
        raise HTTPException(status_code=404, detail="User not found")

    if admin_id is not None:
        from tracker_backend.models import Admin

        target = db.query(Admin).filter(Admin.id == admin_id).first()
        if target is None:
            raise HTTPException(status_code=404, detail="Target admin not found")
        if not target.is_active:
            raise HTTPException(status_code=400, detail="Target admin is disabled")

    at_time = datetime.utcnow()
    users_to_move: list[User] = [user]

    manager = db.query(Manager).filter(Manager.user_id == user.id).first()
    if manager is not None:
        subordinates = (
            db.query(User)
            .filter(User.manager_id == manager.id)
            .all()
        )
        users_to_move.extend(subordinates)

    seen: set[int] = set()
    for u in users_to_move:
        if u.id in seen:
            continue
        seen.add(u.id)
        _apply_user_move(db, u, admin_id, at_time)

    db.commit()
    db.refresh(user)
    return user


def reassign_admin_fleet(
    db: Session,
    source_admin_id: int,
    target_admin_id: int | None,
) -> dict[str, int]:
    """Move all tenant-owned rows from one admin to another (or unassigned)."""
    from tracker_backend.models import Admin, Driver, Geofence, Route

    source = db.query(Admin).filter(Admin.id == source_admin_id).first()
    if source is None:
        raise HTTPException(status_code=404, detail="Admin not found")

    if target_admin_id is not None:
        target = db.query(Admin).filter(Admin.id == target_admin_id).first()
        if target is None:
            raise HTTPException(status_code=404, detail="Target admin not found")
        if not target.is_active:
            raise HTTPException(status_code=400, detail="Target admin is disabled")
        if target_admin_id == source_admin_id:
            raise HTTPException(status_code=400, detail="Source and target admin must differ")

    counts: dict[str, int] = {}
    for label, model in (
        ("users", User),
        ("devices", Device),
        ("geofences", Geofence),
        ("routes", Route),
        ("drivers", Driver),
    ):
        n = (
            db.query(model)
            .filter(model.admin_id == source_admin_id)
            .update({model.admin_id: target_admin_id}, synchronize_session=False)
        )
        counts[label] = n

    db.commit()
    return counts
