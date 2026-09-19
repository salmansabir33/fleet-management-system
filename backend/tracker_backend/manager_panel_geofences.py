"""Manager-scoped geofence endpoints — `/api/manager/{manager_id}/geofences*`.

Mirrors the admin /api/geofences surface, filtered to geofences relevant
to this manager's fleet and gated on the `geofence` permission.

Scope rules
-----------
- Authorized devices: manager_service.get_device_ids_for_manager
- In-scope geofence: has no assigned devices anywhere (unowned), OR at
  least one assigned device belongs to this manager's fleet.
- Create: always allowed (new geofence has no assignments yet).
- Update: geofence must be in scope.
- Delete: no out-of-scope device may reference it (405 if so).
- Assign / unassign: only for in-scope devices.

The Geofence table itself stays global (no owner column needed) —
ownership is derived from Device.primary_geofence_id, just like Routes
derive scope from RouteVehicle.
"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from tracker_backend.deps import get_db, require_manager_permission, require_manager_read, require_manager_scope
from tracker_backend.models import Device, Geofence, Manager
from tracker_backend.schemas import DeviceOut, GeofenceCreate, GeofenceOut, GeofenceUpdate
from tracker_backend.services import manager_service

router = APIRouter(
    prefix="/api/manager/{manager_id}",
    tags=["manager-panel"],
    dependencies=[Depends(require_manager_scope)],
)


# ── helpers ──────────────────────────────────────────────────────────────────

def _device_out_simple(db: Session, device: Device) -> DeviceOut:
    from tracker_backend.models import User
    out = DeviceOut.model_validate(device)
    if device.user_id is not None:
        owner = db.query(User).filter(User.id == device.user_id).first()
        if owner is not None:
            out.owner_username = owner.username
            out.owner_full_name = owner.full_name
            out.owner_phone_number = owner.phone_number
    out.pic_url = f"/uploads/{device.pic_path}" if device.pic_path else None
    return out


def _manager_device_ids(db: Session, manager_id: int) -> set[int]:
    return set(manager_service.get_device_ids_for_manager(db, manager_id))


def _geofence_in_scope(db: Session, manager_device_ids: set[int], geofence_id: int) -> bool:
    """True if the geofence has no assignments at all, or at least one
    assignment that belongs to this manager's fleet."""
    assigned = (
        db.query(Device.id)
        .filter(Device.primary_geofence_id == geofence_id)
        .all()
    )
    if not assigned:
        return True
    assigned_ids = {row[0] for row in assigned}
    return bool(assigned_ids & manager_device_ids)


def _assert_geofence_in_scope(db: Session, manager_device_ids: set[int], geofence_id: int) -> Geofence:
    gf = db.query(Geofence).filter(Geofence.id == geofence_id).first()
    if gf is None or not _geofence_in_scope(db, manager_device_ids, gf.id):
        raise HTTPException(status_code=404, detail="Geofence not found")
    return gf


# ── endpoints ────────────────────────────────────────────────────────────────

@router.get("/geofences", response_model=list[GeofenceOut])
def manager_list_geofences(
    manager: Manager = Depends(require_manager_read("geofence")),
    db: Session = Depends(get_db),
):
    device_ids = _manager_device_ids(db, manager.id)
    all_gf = db.query(Geofence).all()
    return [gf for gf in all_gf if _geofence_in_scope(db, device_ids, gf.id)]


@router.post("/geofences", response_model=GeofenceOut)
def manager_create_geofence(
    payload: GeofenceCreate,
    manager: Manager = Depends(require_manager_permission("geofence")),
    db: Session = Depends(get_db),
):
    gf = Geofence(**payload.dict())
    db.add(gf)
    db.commit()
    db.refresh(gf)
    return gf


@router.get("/geofences/assignable-vehicles", response_model=list[DeviceOut])
def manager_geofence_assignable_vehicles(
    manager: Manager = Depends(require_manager_read("geofence")),
    db: Session = Depends(get_db),
):
    """Flat DeviceOut list for this manager's fleet — used by
    AssignVehicleToGeofenceModal (which needs vehicle metadata, not live
    positions). Gated on geofence rather than live_tracking so managers
    with only the geofence permission can still assign."""
    device_ids = _manager_device_ids(db, manager.id)
    if not device_ids:
        return []
    devices = db.query(Device).filter(Device.id.in_(device_ids)).all()
    return [_device_out_simple(db, d) for d in devices]


@router.get("/geofences/{geofence_id}", response_model=GeofenceOut)
def manager_get_geofence(
    geofence_id: int,
    manager: Manager = Depends(require_manager_read("geofence")),
    db: Session = Depends(get_db),
):
    device_ids = _manager_device_ids(db, manager.id)
    return _assert_geofence_in_scope(db, device_ids, geofence_id)


@router.patch("/geofences/{geofence_id}", response_model=GeofenceOut)
def manager_update_geofence(
    geofence_id: int,
    payload: GeofenceUpdate,
    manager: Manager = Depends(require_manager_permission("geofence")),
    db: Session = Depends(get_db),
):
    device_ids = _manager_device_ids(db, manager.id)
    gf = _assert_geofence_in_scope(db, device_ids, geofence_id)
    for field, value in payload.dict(exclude_unset=True).items():
        setattr(gf, field, value)
    db.commit()
    db.refresh(gf)
    return gf


@router.delete("/geofences/{geofence_id}")
def manager_delete_geofence(
    geofence_id: int,
    manager: Manager = Depends(require_manager_permission("geofence")),
    db: Session = Depends(get_db),
):
    device_ids = _manager_device_ids(db, manager.id)
    gf = _assert_geofence_in_scope(db, device_ids, geofence_id)

    # Refuse if an out-of-scope device still references this geofence
    all_using = {
        row[0]
        for row in db.query(Device.id).filter(Device.primary_geofence_id == geofence_id).all()
    }
    out_of_scope = all_using - device_ids
    if out_of_scope:
        raise HTTPException(
            status_code=409,
            detail="Cannot delete: geofence is assigned to vehicles outside your fleet.",
        )

    db.delete(gf)
    db.commit()
    return {"ok": True}


@router.post("/geofences/{geofence_id}/vehicles/{device_id}")
def manager_assign_vehicle_to_geofence(
    geofence_id: int,
    device_id: int,
    manager: Manager = Depends(require_manager_permission("geofence")),
    db: Session = Depends(get_db),
):
    device_ids = _manager_device_ids(db, manager.id)
    if device_id not in device_ids:
        raise HTTPException(status_code=404, detail="Vehicle not found")
    gf = db.query(Geofence).filter(Geofence.id == geofence_id).first()
    if gf is None:
        raise HTTPException(status_code=404, detail="Geofence not found")

    # After assignment the geofence will be in scope, so no extra guard needed
    device = db.query(Device).filter(Device.id == device_id).first()
    device.primary_geofence_id = geofence_id
    db.commit()
    return {"ok": True}


@router.delete("/geofences/{geofence_id}/vehicles/{device_id}")
def manager_unassign_vehicle_from_geofence(
    geofence_id: int,
    device_id: int,
    manager: Manager = Depends(require_manager_permission("geofence")),
    db: Session = Depends(get_db),
):
    device_ids = _manager_device_ids(db, manager.id)
    if device_id not in device_ids:
        raise HTTPException(status_code=404, detail="Vehicle not found")
    device = db.query(Device).filter(Device.id == device_id).first()
    if device is None or device.primary_geofence_id != geofence_id:
        raise HTTPException(status_code=404, detail="Assignment not found")
    device.primary_geofence_id = None
    db.commit()
    return {"ok": True}
