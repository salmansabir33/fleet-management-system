"""Super Admin — fleet admin CRUD and cross-tenant moves."""
from typing import Annotated, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from tracker_backend.deps import get_db, require_super_admin
from tracker_backend.models import Admin, Device, SuperAdmin, User
from tracker_backend.schemas import ClaimUserCreate
from tracker_backend.services import auth_service
from tracker_backend.services import manager_service
from tracker_backend.services.fleet_device_service import claim_device, delete_fleet_device_cascade
from tracker_backend.services.tenant_service import move_user, reassign_admin_fleet

router = APIRouter(prefix="/api/super-admin", tags=["super-admin"])


class AdminOut(BaseModel):
    id: int
    username: str
    full_name: str | None = None
    phone: str | None = None
    is_active: bool
    user_count: int = 0
    device_count: int = 0

    class Config:
        from_attributes = True


class AdminCreate(BaseModel):
    username: str = Field(min_length=1, max_length=60)
    password: str = Field(min_length=1)
    full_name: str | None = None
    phone: str | None = None


class AdminUpdate(BaseModel):
    full_name: str | None = None
    phone: str | None = None
    password: str | None = None
    is_active: bool | None = None


class ReassignFleetBody(BaseModel):
    target_admin_id: int | None = None


class MoveUserBody(BaseModel):
    admin_id: int | None = None


class DeviceAssignBody(BaseModel):
    admin_id: int
    user_id: Optional[int] = None
    create_user: Optional[ClaimUserCreate] = None
    name: Optional[str] = None


class AssignManagerBody(BaseModel):
    admin_id: int
    manager_id: int


class UnassignedUserOut(BaseModel):
    id: int
    username: str
    full_name: str | None = None
    phone_number: str | None = None

    class Config:
        from_attributes = True


class UnassignedDeviceOut(BaseModel):
    id: int
    name: str
    user_id: int | None = None

    class Config:
        from_attributes = True


class UnassignedPairOut(BaseModel):
    """One fleet-less user+vehicle row (or quarantine device awaiting a user)."""
    user_id: int | None = None
    username: str | None = None
    full_name: str | None = None
    phone_number: str | None = None
    device_id: int | None = None
    vehicle_name: str | None = None


class UnassignedOut(BaseModel):
    items: list[UnassignedPairOut]


def _admin_counts(db: Session) -> tuple[dict[int, int], dict[int, int]]:
    """Grouped user/device counts keyed by admin_id (one query each)."""
    from sqlalchemy import func

    user_rows = (
        db.query(User.admin_id, func.count(User.id))
        .filter(User.admin_id.isnot(None))
        .group_by(User.admin_id)
        .all()
    )
    device_rows = (
        db.query(Device.admin_id, func.count(Device.id))
        .filter(Device.admin_id.isnot(None))
        .group_by(Device.admin_id)
        .all()
    )
    return (
        {int(aid): int(n) for aid, n in user_rows},
        {int(aid): int(n) for aid, n in device_rows},
    )


def _admin_out(admin: Admin, user_counts: dict[int, int] | None = None, device_counts: dict[int, int] | None = None) -> AdminOut:
    uc = user_counts if user_counts is not None else {}
    dc = device_counts if device_counts is not None else {}
    return AdminOut(
        id=admin.id,
        username=admin.username,
        full_name=admin.full_name,
        phone=admin.phone,
        is_active=admin.is_active,
        user_count=uc.get(admin.id, 0),
        device_count=dc.get(admin.id, 0),
    )


def _reject_super_admin_username(db: Session, username: str) -> None:
    normalized = username.strip()
    sa = db.query(SuperAdmin).filter(SuperAdmin.username == normalized).first()
    if sa is not None:
        raise HTTPException(
            status_code=400,
            detail="Cannot use super admin username for a fleet admin",
        )


@router.get("/admins", response_model=list[AdminOut])
def list_admins(
    _principal: Annotated[dict, Depends(require_super_admin)],
    db: Session = Depends(get_db),
):
    rows = db.query(Admin).order_by(Admin.id.asc()).all()
    user_counts, device_counts = _admin_counts(db)
    return [_admin_out(row, user_counts, device_counts) for row in rows]


@router.post("/admins", response_model=AdminOut, status_code=201)
def create_admin(
    payload: AdminCreate,
    _principal: Annotated[dict, Depends(require_super_admin)],
    db: Session = Depends(get_db),
):
    username = payload.username.strip()
    if not username:
        raise HTTPException(status_code=400, detail="Username is required")
    _reject_super_admin_username(db, username)

    existing = db.query(Admin).filter(Admin.username == username).first()
    if existing is not None:
        raise HTTPException(status_code=400, detail="Username already in use")

    admin = Admin(
        username=username,
        password_hash=auth_service.hash_password(payload.password),
        full_name=payload.full_name,
        phone=payload.phone,
        is_active=True,
    )
    db.add(admin)
    db.commit()
    db.refresh(admin)
    return _admin_out(admin)


@router.get("/admins/{admin_id}", response_model=AdminOut)
def get_admin(
    admin_id: int,
    _principal: Annotated[dict, Depends(require_super_admin)],
    db: Session = Depends(get_db),
):
    admin = db.query(Admin).filter(Admin.id == admin_id).first()
    if admin is None:
        raise HTTPException(status_code=404, detail="Admin not found")
    user_counts, device_counts = _admin_counts(db)
    return _admin_out(admin, user_counts, device_counts)


@router.patch("/admins/{admin_id}", response_model=AdminOut)
def update_admin(
    admin_id: int,
    payload: AdminUpdate,
    _principal: Annotated[dict, Depends(require_super_admin)],
    db: Session = Depends(get_db),
):
    admin = db.query(Admin).filter(Admin.id == admin_id).first()
    if admin is None:
        raise HTTPException(status_code=404, detail="Admin not found")

    data = payload.model_dump(exclude_unset=True)
    if "password" in data:
        password = data.pop("password")
        if password:
            admin.password_hash = auth_service.hash_password(password)

    if "is_active" in data:
        # Disabling only — never hard-delete or create another SuperAdmin row.
        if data["is_active"] is False:
            admin.is_active = False
        elif data["is_active"] is True:
            admin.is_active = True

    for field in ("full_name", "phone"):
        if field in data:
            setattr(admin, field, data[field])

    db.commit()
    db.refresh(admin)
    user_counts, device_counts = _admin_counts(db)
    return _admin_out(admin, user_counts, device_counts)


@router.post("/admins/{admin_id}/reassign-fleet")
def reassign_fleet(
    admin_id: int,
    body: ReassignFleetBody,
    _principal: Annotated[dict, Depends(require_super_admin)],
    db: Session = Depends(get_db),
):
    counts = reassign_admin_fleet(db, admin_id, body.target_admin_id)
    return {"success": True, "moved": counts}


@router.post("/users/{user_id}/move", response_model=UnassignedUserOut)
def move_user_endpoint(
    user_id: int,
    body: MoveUserBody,
    _principal: Annotated[dict, Depends(require_super_admin)],
    db: Session = Depends(get_db),
):
    user = move_user(db, user_id, body.admin_id)
    return UnassignedUserOut.model_validate(user)


@router.post("/devices/{device_id}/assign", response_model=UnassignedDeviceOut)
def assign_device(
    device_id: int,
    body: DeviceAssignBody,
    _principal: Annotated[dict, Depends(require_super_admin)],
    db: Session = Depends(get_db),
):
    """Assign a quarantine/unassigned device to a fleet, claiming an owner if needed."""
    device = db.query(Device).filter(Device.id == device_id).first()
    if device is None:
        raise HTTPException(status_code=404, detail="Device not found")

    admin = db.query(Admin).filter(Admin.id == body.admin_id).first()
    if admin is None:
        raise HTTPException(status_code=404, detail="Admin not found")
    if not admin.is_active:
        raise HTTPException(status_code=400, detail="Target admin is disabled")

    if device.user_id is not None:
        move_user(db, device.user_id, body.admin_id)
        device = db.query(Device).filter(Device.id == device_id).first()
        if device is None:
            raise HTTPException(status_code=404, detail="Device not found")
        if body.name is not None:
            device.name = body.name
            db.commit()
            db.refresh(device)
    else:
        claim_device(
            db,
            device,
            user_id=body.user_id,
            create_user=body.create_user,
            admin_id=body.admin_id,
            name=body.name,
        )

    return UnassignedDeviceOut.model_validate(device)


@router.post("/users/{user_id}/assign-manager", response_model=UnassignedUserOut)
def assign_user_manager(
    user_id: int,
    body: AssignManagerBody,
    _principal: Annotated[dict, Depends(require_super_admin)],
    db: Session = Depends(get_db),
):
    user = db.query(User).filter(User.id == user_id).first()
    if user is None:
        raise HTTPException(status_code=404, detail="User not found")

    if user.admin_id != body.admin_id:
        user = move_user(db, user_id, body.admin_id)

    manager_service.assign_users_to_manager(db, body.manager_id, [user_id])
    db.refresh(user)
    return UnassignedUserOut.model_validate(user)


@router.delete("/devices/{device_id}")
async def delete_unassigned_device(
    device_id: int,
    _principal: Annotated[dict, Depends(require_super_admin)],
    db: Session = Depends(get_db),
):
    device = db.query(Device).filter(Device.id == device_id).first()
    if device is None:
        raise HTTPException(status_code=404, detail="Device not found")
    result = await delete_fleet_device_cascade(db, device)
    return {"success": True, "message": f"Device {device_id} deleted", **result}


@router.get("/unassigned", response_model=UnassignedOut)
def list_unassigned(
    _principal: Annotated[dict, Depends(require_super_admin)],
    db: Session = Depends(get_db),
    include_devices: bool = Query(True),
):
    """List fleet-less user+vehicle pairs (and ownerless quarantine devices)."""
    del include_devices  # always include devices; kept for older clients
    users = (
        db.query(User)
        .filter(User.admin_id.is_(None))
        .order_by(User.id.asc())
        .all()
    )
    devices_by_user = {
        d.user_id: d
        for d in db.query(Device).filter(Device.user_id.isnot(None)).all()
        if d.user_id is not None
    }
    listed_device_ids: set[int] = set()
    items: list[UnassignedPairOut] = []
    for user in users:
        device = devices_by_user.get(user.id)
        if device is not None:
            listed_device_ids.add(device.id)
        items.append(
            UnassignedPairOut(
                user_id=user.id,
                username=user.username,
                full_name=user.full_name,
                phone_number=user.phone_number,
                device_id=device.id if device else None,
                vehicle_name=device.name if device else None,
            )
        )

    # Quarantine / fleet-less devices not already covered by an unassigned user row
    for device in (
        db.query(Device)
        .filter(Device.admin_id.is_(None))
        .order_by(Device.id.asc())
        .all()
    ):
        if device.id in listed_device_ids:
            continue
        owner = None
        if device.user_id is not None:
            owner = db.query(User).filter(User.id == device.user_id).first()
        items.append(
            UnassignedPairOut(
                user_id=owner.id if owner else None,
                username=owner.username if owner else None,
                full_name=owner.full_name if owner else None,
                phone_number=owner.phone_number if owner else None,
                device_id=device.id,
                vehicle_name=device.name,
            )
        )

    return UnassignedOut(items=items)
