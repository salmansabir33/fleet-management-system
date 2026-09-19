"""User create/delete helpers shared by admin and manager-panel routes.

Keep username uniqueness and the orphan-guards for delete in one place
so CreateUserModal's create→vehicle→rollback path behaves the same
whether the caller is admin or a scoped manager.
"""
from fastapi import HTTPException

from tracker_backend.models import Device, User
from tracker_backend.services import manager_service
from tracker_backend.services import auth_service
from tracker_backend.services.settings_catalog import default_bell_prefs, default_user_permissions
from tracker_backend.services.uploads import delete_upload, save_upload


def create_user_row(
    db,
    *,
    username: str,
    password: str,
    full_name: str | None = None,
    phone_number: str | None = None,
    manager_id: int | None = None,
    commit: bool = True,
) -> User:
    """Inserts a User after the username-uniqueness check. Optional
    `manager_id` is set on the same insert (manager-panel auto-assign).
    Pass commit=False to flush only (caller owns the transaction —
    used by the atomic manager create-user-with-vehicle endpoint).
    """
    existing = db.query(User).filter(User.username == username).first()
    if existing is not None:
        raise HTTPException(status_code=400, detail="A user with this username already exists")

    user = User(
        username=username,
        full_name=full_name,
        phone_number=phone_number,
        manager_id=manager_id,
        permissions=default_user_permissions(db),
        notification_prefs=default_bell_prefs(db, "user"),
    )
    auth_service.set_user_password(user, password)
    db.add(user)
    if commit:
        db.commit()
    else:
        db.flush()
    db.refresh(user)
    return user


async def delete_user_row(db, user: User) -> dict:
    """Deletes `user` and their paired vehicle (if any).

    When the user owns a device, this is the reverse of vehicle delete:
    `delete_fleet_device_cascade` removes the Traccar device, the local
    Device row, demotes the user if they are a manager (unassigning
    anyone reporting to them), then deletes the User.

    If they have no vehicle (e.g. Add User rolled back after a failed
    vehicle POST), a manager with no vehicle is still blocked so
    assigned users aren't left dangling; otherwise the User row and
    photo are removed directly.
    """
    owned_vehicle = db.query(Device).filter(Device.user_id == user.id).first()
    if owned_vehicle is not None:
        from tracker_backend.services.fleet_device_service import delete_fleet_device_cascade
        return await delete_fleet_device_cascade(db, owned_vehicle)

    if manager_service.get_manager_by_user_id(db, user.id) is not None:
        raise HTTPException(
            status_code=400,
            detail="This user is a manager — demote them before deleting.",
        )

    delete_upload(user.pic_path)
    db.delete(user)
    db.commit()
    return {"deleted_owner_username": user.username, "removed_manager": False}


async def set_user_pic(db, user: User, pic) -> User:
    """Replace `user.pic_path` with a newly uploaded image. Empty /
    nameless uploads are ignored so callers can pass the optional File
    through without a separate existence check.
    """
    if pic is None or not getattr(pic, "filename", None):
        return user

    new_path = await save_upload(pic, "users/photo")
    delete_upload(user.pic_path)
    user.pic_path = new_path
    db.commit()
    db.refresh(user)
    return user
