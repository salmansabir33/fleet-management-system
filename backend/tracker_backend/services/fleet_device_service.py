"""Fleet device delete with owner cascade — shared by admin and manager routes."""
import httpx
from fastapi import HTTPException
from sqlalchemy.orm import Session

from tracker_backend.models import Device, Manager, User
from tracker_backend.services import manager_service
from tracker_backend.services.traccar import traccar_service
from tracker_backend.services.uploads import delete_upload, save_upload


async def delete_fleet_device_cascade(db: Session, device: Device) -> dict:
    """Deletes a fleet device from Traccar and the local DB. When the
    vehicle has an owner (Device.user_id), that user is deleted too.
    If the owner is a manager, their manager role is removed first
    (assigned users are unassigned) before the user row is deleted.
    """
    owner_id = device.user_id

    try:
        await traccar_service.delete_device(device.traccar_device_id)
    except httpx.HTTPStatusError as e:
        if e.response.status_code != 404:
            raise HTTPException(
                status_code=502,
                detail=f"Failed to remove device from Traccar: {e}",
            ) from e
    except Exception as e:
        raise HTTPException(
            status_code=502,
            detail=f"Failed to remove device from Traccar: {e}",
        ) from e

    delete_upload(device.pic_path)
    db.delete(device)
    db.flush()

    deleted_owner_username = None
    removed_manager = False

    if owner_id is not None:
        manager = manager_service.get_manager_by_user_id(db, owner_id)
        if manager is not None:
            db.query(User).filter(User.manager_id == manager.id).update(
                {User.manager_id: None},
                synchronize_session=False,
            )
            db.query(Manager).filter(Manager.id == manager.id).delete(
                synchronize_session=False,
            )
            removed_manager = True
            db.flush()

        owner = db.query(User).filter(User.id == owner_id).first()
        if owner is not None:
            deleted_owner_username = owner.username
            delete_upload(owner.pic_path)
            db.delete(owner)

    db.commit()

    return {
        "deleted_owner_username": deleted_owner_username,
        "removed_manager": removed_manager,
    }


async def set_device_pic(db: Session, device: Device, pic) -> Device:
    """Replace `device.pic_path` with a newly uploaded image."""
    if pic is None or not getattr(pic, "filename", None):
        return device

    new_path = await save_upload(pic, "vehicles/photo")
    old_path = device.pic_path
    device.pic_path = new_path
    db.add(device)
    db.commit()
    db.refresh(device)
    if old_path and old_path != new_path:
        delete_upload(old_path)
    return device
