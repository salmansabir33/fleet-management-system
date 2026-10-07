"""Shared trip-list assembly for admin and manager panels.

Extracted so manager_panel.py stays readable; used by main.list_all_trips
and the manager trips endpoint.
"""
from datetime import date, datetime, timedelta

from sqlalchemy.orm import Session, aliased

from tracker_backend.models import Device, Manager, User
from tracker_backend.schemas import AdminTripOut, TripOut
from tracker_backend.services import driver_service
from tracker_backend.services import route_assignment_service
from tracker_backend.services.trip_tracker import (
    calculate_trip_metrics,
    get_trips_in_range_fleet_wide,
)


def _parse_flexible_datetime(value: str) -> datetime:
    cleaned = value.strip()
    if cleaned.endswith("Z"):
        cleaned = cleaned[:-1] + "+00:00"
    try:
        return datetime.fromisoformat(cleaned)
    except ValueError:
        for fmt in ("%Y-%m-%dT%H:%M", "%Y-%m-%d %H:%M:%S", "%Y-%m-%d"):
            try:
                return datetime.strptime(cleaned, fmt)
            except ValueError:
                continue
        raise


def _resolve_time_range(trip_date: str | None, start: str | None, end: str | None):
    if start and end:
        start_dt = _parse_flexible_datetime(start)
        end_dt = _parse_flexible_datetime(end)
        return start_dt, end_dt, None, None
    day = date.fromisoformat(trip_date) if trip_date else date.today()
    start_dt = datetime.combine(day, datetime.min.time())
    end_dt = start_dt + timedelta(days=1)
    return start_dt, end_dt, None, day


def build_admin_trips(
    db: Session,
    *,
    trip_date: date | None = None,
    start: str | None = None,
    end: str | None = None,
    status: str | None = None,
    driver_id: int | None = None,
    device_id: int | None = None,
    manager_id: int | None = None,
    geofence_id: int | None = None,
    admin_id: int | None = None,
) -> list[AdminTripOut]:
    """Fleet (or manager-scoped) trip list with cheap list-path work.

    Completed trips keep stored metrics (already finalized on close).
    Only in-progress trips are recalculated so open-trip numbers stay live.
    Drivers are resolved in batch to avoid N+1 queries.
    """
    if trip_date is None and not start and not end:
        start_dt, end_dt = None, None
    else:
        start_dt, end_dt, _label, _price_date = _resolve_time_range(
            trip_date.isoformat() if trip_date else None, start, end
        )
    trips = get_trips_in_range_fleet_wide(
        db, start_dt, end_dt,
        status=status,
        driver_id=driver_id,
        device_id=device_id,
        manager_id=manager_id,
        geofence_id=geofence_id,
        admin_id=admin_id,
    )

    device_ids = {t.device_id for t in trips}
    devices_by_id = {
        d.id: d for d in db.query(Device).filter(Device.id.in_(device_ids)).all()
    } if device_ids else {}

    # Live metrics only for open trips — completed rows already have
    # distance/fuel/behavior fields from close/backfill and do not need
    # a full DevicePosition scan on every list request.
    metrics_dirty = False
    for trip in trips:
        if trip.status != "in_progress":
            continue
        device = devices_by_id.get(trip.device_id)
        if device:
            calculate_trip_metrics(db, trip, device)
            metrics_dirty = True
    if metrics_dirty:
        db.commit()

    owner_user_ids = {
        d.user_id for d in devices_by_id.values() if d.user_id is not None
    }
    user_name_by_owner_id: dict[int, str | None] = {}
    manager_name_by_owner_id: dict[int, str | None] = {}
    if owner_user_ids:
        ManagerUser = aliased(User)
        for owner_id, owner_full_name, owner_username, manager_full_name, manager_username in (
            db.query(
                User.id,
                User.full_name,
                User.username,
                ManagerUser.full_name,
                ManagerUser.username,
            )
            .outerjoin(Manager, User.manager_id == Manager.id)
            .outerjoin(ManagerUser, Manager.user_id == ManagerUser.id)
            .filter(User.id.in_(owner_user_ids))
            .all()
        ):
            user_name_by_owner_id[owner_id] = owner_full_name or owner_username
            manager_name_by_owner_id[owner_id] = manager_full_name or manager_username

    drivers_by_trip_id = driver_service.resolve_drivers_for_trips(db, trips)
    confirmed_by_trip_id = driver_service.resolve_confirmed_drivers_for_trips(db, trips)
    routes_by_trip_id = route_assignment_service.resolve_routes_for_trips(db, trips)
    confirmed_routes_by_trip_id = route_assignment_service.resolve_confirmed_routes_for_trips(db, trips)

    response = []
    for trip in trips:
        driver, driver_alert = drivers_by_trip_id.get(trip.id, (None, False))
        confirmed = confirmed_by_trip_id.get(trip.id)
        if driver_id is not None:
            effective_id = driver_service.effective_trip_driver_id(trip, driver)
            if effective_id != driver_id:
                continue

        device = devices_by_id.get(trip.device_id)
        base = TripOut.model_validate(trip)
        base.driver_id = driver.id if driver else None
        base.driver_name = driver.name if driver else None
        base.driver_pic_url = (
            f"/uploads/{driver.driver_pic_path}"
            if driver and driver.driver_pic_path else None
        )
        base.driver_alert = driver_alert
        driver_service.apply_confirmation_fields(base, trip, confirmed)
        assigned_route = routes_by_trip_id.get(trip.id)
        base.route_id = assigned_route.id if assigned_route else None
        base.route_name = assigned_route.name if assigned_route else None
        route_assignment_service.apply_route_confirmation_fields(
            base, trip, confirmed_routes_by_trip_id.get(trip.id)
        )
        owner_id = device.user_id if device else None
        response.append(AdminTripOut(
            **base.model_dump(),
            vehicle_name=device.name if device else f"Device {trip.device_id}",
            user_name=user_name_by_owner_id.get(owner_id) if owner_id is not None else None,
            manager_name=manager_name_by_owner_id.get(owner_id) if owner_id is not None else None,
        ))
    return response


def build_manager_trips(
    db: Session,
    *,
    manager_id: int,
    trip_date: date | None = None,
    start: str | None = None,
    end: str | None = None,
    status: str | None = None,
    driver_id: int | None = None,
    device_id: int | None = None,
    geofence_id: int | None = None,
) -> list[AdminTripOut]:
    return build_admin_trips(
        db,
        trip_date=trip_date,
        start=start,
        end=end,
        status=status,
        driver_id=driver_id,
        device_id=device_id,
        manager_id=manager_id,
        geofence_id=geofence_id,
    )
