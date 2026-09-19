"""Manager <-> user assignment logic, plus manager promotion/demotion.

A Manager is a User promoted to oversee a group of other Users. Unlike
driver assignments (see driver_service.py) there's no time-ranged
history here — User.manager_id is a plain "who does this user report
to right now" pointer, overwritten directly by assign/unassign. A user
reports to at most one manager at a time; a manager oversees any number
of users.

"Total vehicles" for a manager (see the Managers admin page) isn't a
separate relationship — it's just every vehicle (Device) owned by every
User currently assigned to that manager, since vehicles are owned by
users, not by managers directly.
"""
from tracker_backend.models import User, Manager, Device, PermissionDefinition
from tracker_backend.services.settings_catalog import default_bell_prefs


def get_manager_by_user_id(db, user_id: int) -> Manager | None:
    return db.query(Manager).filter(Manager.user_id == user_id).first()

def promote_user_to_manager(db, user_id: int) -> Manager:
    """Promotes a User to Manager. Idempotent: promoting a user who is
    already a manager just returns their existing Manager row instead
    of erroring or creating a duplicate.

    If this user was themselves assigned to another manager
    (User.manager_id set), that assignment is cleared as part of the
    promotion — a manager shouldn't still show up as one of another
    manager's assigned users. After the new Manager row is created,
    the promoted user is self-assigned (User.manager_id = the new
    Manager.id) so they count in their own assigned-users / vehicles
    totals. Mirrors demote_manager's convention of doing this cleanup
    explicitly at the app level rather than relying on a DB constraint.
    """
    existing = get_manager_by_user_id(db, user_id)
    if existing is not None:
        return existing

    user = db.query(User).filter(User.id == user_id).first()
    if user is not None and user.manager_id is not None:
        user.manager_id = None

    active_keys = (
        db.query(PermissionDefinition)
        .filter(PermissionDefinition.is_active.is_(True))
        .all()
    )
    permissions = {row.key: True for row in active_keys}
    notification_prefs = default_bell_prefs(db, "manager")
    manager = Manager(
        user_id=user_id,
        permissions=permissions,
        notification_prefs=notification_prefs,
    )
    db.add(manager)
    db.commit()
    db.refresh(manager)

    if user is not None:
        user.manager_id = manager.id
        db.commit()
        db.refresh(manager)
        db.refresh(user)

    return manager


def demote_manager(db, manager_id: int) -> None:
    """Removes a Manager row (demotes back to a plain User). The
    underlying User row is untouched. Every User currently assigned to
    this manager is unassigned first (manager_id -> NULL) — the FK on
    users.manager_id has no ON DELETE clause (matches this project's
    convention for nullable FKs, e.g. Device.fuel_type_id), so this has
    to happen explicitly before the delete, not left to the database.
    """
    db.query(User).filter(User.manager_id == manager_id).update({User.manager_id: None})
    db.query(Manager).filter(Manager.id == manager_id).delete()
    db.commit()


def assign_users_to_manager(db, manager_id: int, user_ids: list[int]) -> list[User]:
    """Points each given user's manager_id at `manager_id`, overwriting
    whatever manager (if any) they previously reported to. Skips ids
    that don't exist rather than erroring, so one bad id in a batch
    doesn't fail the whole assignment.
    """
    users = db.query(User).filter(User.id.in_(user_ids)).all()
    for user in users:
        user.manager_id = manager_id
    db.commit()
    for user in users:
        db.refresh(user)
    return users


def unassign_user(db, user_id: int) -> User | None:
    """Clears a single user's manager_id. Returns None if the user
    doesn't exist or wasn't assigned to anyone.
    """
    user = db.query(User).filter(User.id == user_id).first()
    if user is None or user.manager_id is None:
        return None
    user.manager_id = None
    db.commit()
    db.refresh(user)
    return user


def get_assigned_users(db, manager_id: int) -> list[User]:
    return db.query(User).filter(User.manager_id == manager_id).order_by(User.username.asc()).all()


def get_unassigned_users(db) -> list[User]:
    """Every user not currently reporting to ANY manager — this is the
    candidate list for the "Assign Users" modal (a user already on a
    manager isn't offered again; re-assign them from that manager's
    panel, or unassign first, to avoid accidental silent reassignment).
    """
    return db.query(User).filter(User.manager_id.is_(None)).order_by(User.username.asc()).all()

def get_non_manager_users(db) -> list[User]:
    """Every user who is NOT already a manager — the candidate list for
    the "Add New Manager" modal.
    """
    manager_user_ids = {m.user_id for m in db.query(Manager.user_id).all()}
    query = db.query(User)
    if manager_user_ids:
        query = query.filter(User.id.notin_(manager_user_ids))
    return query.order_by(User.username.asc()).all()


def get_vehicles_for_users(db, user_ids: list[int]) -> list[Device]:
    if not user_ids:
        return []
    return db.query(Device).filter(Device.user_id.in_(user_ids)).all()


def get_user_ids_for_manager(db, manager_id: int) -> list[int]:
    """IDs of every User currently assigned to this manager — the
    scoping allow-list for manager-panel user reads/writes.
    """
    return [u.id for u in get_assigned_users(db, manager_id)]


def get_device_ids_for_manager(db, manager_id: int) -> list[int]:
    """IDs of every Device owned by any user assigned to this manager —
    vehicles aren't linked to managers directly (see module docstring).
    """
    user_ids = get_user_ids_for_manager(db, manager_id)
    return [d.id for d in get_vehicles_for_users(db, user_ids)]
