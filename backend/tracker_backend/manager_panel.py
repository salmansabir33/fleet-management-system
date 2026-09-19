"""Manager-scoped panel API — `/api/manager/{manager_id}/...`.

Separate from the admin `/api/managers*` CRUD: those stay unrestricted
for admins managing managers. These routes always filter to the
manager's assigned users / their owned devices, and gate mutating
endpoints with require_manager_permission.
"""
from datetime import date

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from sqlalchemy import func, or_
from sqlalchemy.orm import Session

from tracker_backend.deps import (
    get_db, get_manager_or_404, require_any_manager_permission,
    require_manager_permission, require_manager_read, require_manager_scope,
)
from tracker_backend.models import (
    Device, DeviceAlert, Driver, DriverAssignment, MaintenanceRecord,
    Manager, Trip, User,
)
from tracker_backend.schemas import (
    AdminDashboardSummaryOut, AdminTripOut, AlertOut,
    ConfirmableDriverOut, ConfirmableRouteOut, DashboardMaintenanceTrendsOut, DashboardTrendsOut,
    DeviceCreate, DeviceOut, DeviceUpdate, DriverAssignmentOut, DriverOut,
    ManagerCreateUserWithVehicle, TripCostsUpdate, TripDriverConfirm, TripRouteConfirm, TripOut,
    UserOut, UserUpdate, UserVehicleOut, validate_cnic,
)
from tracker_backend.services import driver_service, manager_service, maintenance_service, route_assignment_service, user_service
from tracker_backend.services.cache import traccar_cache
from tracker_backend.services.traccar import traccar_service
from tracker_backend.manager_panel_trips import build_manager_trips
from tracker_backend.services.dashboard_summary import (
    aggregate_trips_for_period,
    count_assigned_driver_buckets,
)
from tracker_backend.services.dashboard_trends import (
    TREND_PERIOD_DAYS,
    get_dashboard_maintenance_points,
    get_dashboard_trend_points,
)
from tracker_backend.services.uploads import save_upload

router = APIRouter(
    prefix="/api/manager/{manager_id}",
    tags=["manager-panel"],
    dependencies=[Depends(require_manager_scope)],
)

# Same idle defaults as main.create_fleet_device — kept local so this
# module doesn't import from main (circular).
IDLE_DEFAULTS_BY_VEHICLE_TYPE = {
    "bike": 0.15,
    "car": 0.6,
    "van": 0.9,
    "truck": 1.8,
}
DEFAULT_IDLE_FALLBACK = 0.8


def _pic_url(path: str | None) -> str | None:
    return f"/uploads/{path}" if path else None


def _device_out(db: Session, device: Device) -> DeviceOut:
    out = DeviceOut.model_validate(device)
    if device.user_id is not None:
        owner = db.query(User).filter(User.id == device.user_id).first()
        if owner is not None:
            out.owner_username = owner.username
            out.owner_full_name = owner.full_name
            out.owner_phone_number = owner.phone_number
    out.pic_url = _pic_url(device.pic_path)
    return out


def _user_out(db: Session, user: User) -> UserOut:
    out = UserOut.model_validate(user)
    out.is_manager = manager_service.get_manager_by_user_id(db, user.id) is not None
    out.pic_url = _pic_url(user.pic_path)
    vehicles = db.query(Device).filter(Device.user_id == user.id).all()
    out.vehicles = []
    for v in vehicles:
        vehicle_out = UserVehicleOut.model_validate(v)
        vehicle_out.pic_url = _pic_url(v.pic_path)
        out.vehicles.append(vehicle_out)
    return out


def _driver_out(db: Session, driver: Driver) -> DriverOut:
    out = DriverOut.model_validate(driver)
    out.license_pic_path = _pic_url(driver.license_pic_path)
    out.driver_pic_path = _pic_url(driver.driver_pic_path)
    open_assignment = driver_service.get_active_assignment_for_driver(db, driver.id)
    if open_assignment is not None:
        device = db.query(Device).filter(Device.id == open_assignment.device_id).first()
        if device is not None:
            out.current_device_id = device.id
            out.current_device_name = device.name
            out.current_device_plate = device.plate_number
        out.assigned_since = open_assignment.start_time
    return out


def _alert_out(alert: DeviceAlert, device: Device | None) -> AlertOut:
    return AlertOut.model_validate({
        "id": alert.id,
        "device_id": alert.device_id,
        "device_name": device.name if device else None,
        "device_plate": device.plate_number if device else None,
        "alert_type": alert.alert_type,
        "severity": alert.severity,
        "message": alert.message,
        "is_resolved": alert.is_resolved,
        "triggered_at": alert.triggered_at,
        "resolved_at": alert.resolved_at,
    })


def _assert_user_in_scope(db: Session, manager_id: int, user_id: int) -> None:
    if user_id not in manager_service.get_user_ids_for_manager(db, manager_id):
        raise HTTPException(status_code=404, detail="User not found")


def _assert_device_in_scope(db: Session, manager_id: int, device_id: int) -> Device:
    device_ids = manager_service.get_device_ids_for_manager(db, manager_id)
    if device_id not in device_ids:
        raise HTTPException(status_code=404, detail="Device not found")
    device = db.query(Device).filter(Device.id == device_id).first()
    if device is None:
        raise HTTPException(status_code=404, detail="Device not found")
    return device


def _assert_driver_in_scope(db: Session, manager_id: int, driver_id: int) -> Driver:
    """Driver must have an open assignment on one of this manager's
    devices — same rule as manager_list_drivers. 404 (not 403) so we
    don't leak that the driver exists outside this manager's fleet.
    """
    device_ids = manager_service.get_device_ids_for_manager(db, manager_id)
    if not device_ids:
        raise HTTPException(status_code=404, detail="Driver not found")
    open_on_scoped_device = (
        db.query(DriverAssignment)
        .filter(
            DriverAssignment.driver_id == driver_id,
            DriverAssignment.end_time.is_(None),
            DriverAssignment.device_id.in_(device_ids),
        )
        .first()
    )
    if open_on_scoped_device is None:
        raise HTTPException(status_code=404, detail="Driver not found")
    driver = db.query(Driver).filter(Driver.id == driver_id).first()
    if driver is None:
        raise HTTPException(status_code=404, detail="Driver not found")
    return driver


def _scoped_live(
    db: Session,
    manager_id: int,
    compact: bool = False,
    device_id: int | None = None,
) -> list[dict]:
    """Same shape as /api/live's `live` array, filtered to this manager's devices.

    Pass device_id to return at most one vehicle (DB id). compact=True skips
    driver/owner enrichment. Non-compact enrichment is batched (no N+1).
    """
    device_ids = set(manager_service.get_device_ids_for_manager(db, manager_id))
    if not device_ids:
        return []
    if device_id is not None:
        if device_id not in device_ids:
            return []
        device_ids = {device_id}

    devices = db.query(Device).filter(Device.id.in_(device_ids)).all()
    traccar_to_db = {d.traccar_device_id: d.id for d in devices}
    devices_by_id = {d.id: d for d in devices}
    allowed_traccar = set(traccar_to_db.keys())

    live = []
    for item in traccar_cache.merged_live_view():
        traccar_id = item["device"]["id"]
        if traccar_id not in allowed_traccar:
            continue
        db_id = traccar_to_db.get(traccar_id)
        row = dict(item)
        row["db_id"] = db_id
        db_device = devices_by_id.get(db_id) if db_id is not None else None
        row["vehicle_type"] = db_device.vehicle_type if db_device else None
        row["plate_number"] = db_device.plate_number if db_device else None
        row["pic_url"] = _pic_url(db_device.pic_path) if db_device else None
        row["active_driver"] = None
        row["driver_alert"] = False
        row["owner"] = None
        live.append(row)

    if compact or not live:
        return live

    live_db_ids = [row["db_id"] for row in live if row["db_id"] is not None]
    if not live_db_ids:
        return live

    open_trips = {
        row[0]
        for row in (
            db.query(Trip.device_id)
            .filter(Trip.device_id.in_(live_db_ids), Trip.status == "in_progress")
            .distinct()
            .all()
        )
    }
    assignments = (
        db.query(DriverAssignment)
        .filter(
            DriverAssignment.device_id.in_(live_db_ids),
            DriverAssignment.end_time.is_(None),
        )
        .all()
    )
    assignment_by_device = {a.device_id: a for a in assignments}
    driver_ids = {a.driver_id for a in assignments}
    drivers_by_id = {
        d.id: d
        for d in (
            db.query(Driver).filter(Driver.id.in_(driver_ids)).all()
            if driver_ids else []
        )
    }
    owner_ids = {
        devices_by_id[db_id].user_id
        for db_id in live_db_ids
        if devices_by_id.get(db_id) is not None and devices_by_id[db_id].user_id is not None
    }
    owners_by_id = {
        u.id: u
        for u in (
            db.query(User).filter(User.id.in_(owner_ids)).all()
            if owner_ids else []
        )
    }
    manager_user_ids = set()
    if owners_by_id:
        for owner in owners_by_id.values():
            if manager_service.get_manager_by_user_id(db, owner.id) is not None:
                manager_user_ids.add(owner.id)

    for row in live:
        db_id = row["db_id"]
        if db_id is None:
            continue
        assignment = assignment_by_device.get(db_id)
        driver = drivers_by_id.get(assignment.driver_id) if assignment else None
        if driver is not None:
            row["active_driver"] = {
                "id": driver.id,
                "name": driver.name,
                "pic_url": _pic_url(driver.driver_pic_path),
            }
        row["driver_alert"] = db_id in open_trips and assignment is None
        db_device = devices_by_id.get(db_id)
        if db_device is not None and db_device.user_id is not None:
            owner = owners_by_id.get(db_device.user_id)
            if owner is not None:
                row["owner"] = {
                    "id": owner.id,
                    "username": owner.username,
                    "full_name": owner.full_name,
                    "is_manager": owner.id in manager_user_ids,
                    "pic_url": _pic_url(owner.pic_path),
                }
    return live


def _scoped_dashboard_summary(
    db: Session,
    manager_id: int,
    period: str = "day",
) -> AdminDashboardSummaryOut:
    device_ids = manager_service.get_device_ids_for_manager(db, manager_id)
    today = date.today()

    if not device_ids:
        return AdminDashboardSummaryOut(
            trips_today=0,
            vehicles_due_maintenance=0,
            vehicles_overdue_maintenance=0,
            maintenance_records_ytd=0,
            trips_completed_today=0,
            trips_ongoing_today=0,
            trips_total_distance_km=0.0,
            trips_total_fuel_cost_pkr=0.0,
            trips_total_toll_cost_pkr=0.0,
            trips_total_challan_cost_pkr=0.0,
            trips_total_cost_pkr=0.0,
            drivers_total=0,
            drivers_active=0,
            drivers_on_trip=0,
            drivers_on_leave=0,
            drivers_available=0,
        )

    today_stats = aggregate_trips_for_period(db, period=period, device_ids=device_ids)
    drivers_on_trip, drivers_available = count_assigned_driver_buckets(
        db, device_ids=device_ids
    )

    vehicles_due_maintenance, vehicles_overdue_maintenance = (
        maintenance_service.count_due_vehicles(db, device_ids=device_ids)
    )

    year_start = date(today.year, 1, 1)
    maintenance_records_ytd = (
        db.query(func.count(MaintenanceRecord.id))
        .filter(
            MaintenanceRecord.device_id.in_(device_ids),
            MaintenanceRecord.record_date >= year_start,
            MaintenanceRecord.is_baseline.is_(False),
        )
        .scalar()
        or 0
    )

    driver_ids = [
        row[0]
        for row in (
            db.query(DriverAssignment.driver_id)
            .filter(
                DriverAssignment.device_id.in_(device_ids),
                DriverAssignment.end_time.is_(None),
            )
            .distinct()
            .all()
        )
    ]
    if driver_ids:
        drivers_total = len(driver_ids)
        drivers_active = (
            db.query(func.count(Driver.id))
            .filter(Driver.id.in_(driver_ids), Driver.status == "active")
            .scalar()
            or 0
        )
        drivers_on_leave = (
            db.query(func.count(Driver.id))
            .filter(Driver.id.in_(driver_ids), Driver.status == "on_leave")
            .scalar()
            or 0
        )
    else:
        drivers_total = drivers_active = drivers_on_leave = 0

    return AdminDashboardSummaryOut(
        trips_today=today_stats.trips_today,
        vehicles_due_maintenance=vehicles_due_maintenance,
        vehicles_overdue_maintenance=vehicles_overdue_maintenance,
        maintenance_records_ytd=maintenance_records_ytd,
        trips_completed_today=today_stats.trips_completed_today,
        trips_ongoing_today=today_stats.trips_ongoing_today,
        trips_total_distance_km=today_stats.trips_total_distance_km,
        trips_total_fuel_cost_pkr=today_stats.trips_total_fuel_cost_pkr,
        trips_total_toll_cost_pkr=today_stats.trips_total_toll_cost_pkr,
        trips_total_challan_cost_pkr=today_stats.trips_total_challan_cost_pkr,
        trips_total_cost_pkr=today_stats.trips_total_cost_pkr,
        drivers_total=drivers_total,
        drivers_active=drivers_active,
        drivers_on_trip=drivers_on_trip,
        drivers_on_leave=drivers_on_leave,
        drivers_available=drivers_available,
    )


# ── reads (GET /vehicles|drivers|trips|alerts hard-403; dashboard omits) ─

@router.get("/dashboard")
def manager_dashboard(
    period: str = "day",
    manager: Manager = Depends(get_manager_or_404),
    db: Session = Depends(get_db),
):
    """Scoped live feed + summary — same pieces AdminDashboard needs,
    filtered to this manager's devices/users.

    Does not 403 the whole payload: live is omitted without
    live_tracking, summary without reports_analytics.
    Trip summary totals respect `period`; live feed is always current.
    """
    if period not in TREND_PERIOD_DAYS:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid period {period!r}. Expected one of: {', '.join(TREND_PERIOD_DAYS)}",
        )

    perms = manager.permissions or {}
    live = _scoped_live(db, manager.id, compact=True) if perms.get("live_tracking") else None
    summary = (
        _scoped_dashboard_summary(db, manager.id, period=period)
        if perms.get("reports_analytics")
        else None
    )
    user_count = len(manager_service.get_user_ids_for_manager(db, manager.id))
    return {
        "success": True,
        "count": len(live) if live is not None else 0,
        "cache_status": traccar_cache.status(),
        "live": live,
        "summary": summary,
        "user_count": user_count,
    }


@router.get("/dashboard/trends", response_model=DashboardTrendsOut)
def manager_dashboard_trends(
    period: str = "month",
    manager: Manager = Depends(require_manager_read("trip_history")),
    db: Session = Depends(get_db),
):
    """Same bucketed series as admin Fleet Trends, scoped to this fleet."""
    if period not in TREND_PERIOD_DAYS:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid period {period!r}. Expected one of: {', '.join(TREND_PERIOD_DAYS)}",
        )
    device_ids = manager_service.get_device_ids_for_manager(db, manager.id)
    return DashboardTrendsOut(
        period=period,
        points=get_dashboard_trend_points(db, period, device_ids=device_ids),
    )


@router.get("/dashboard/maintenance-trends", response_model=DashboardMaintenanceTrendsOut)
def manager_dashboard_maintenance_trends(
    period: str = "month",
    manager: Manager = Depends(require_manager_read("maintenance")),
    db: Session = Depends(get_db),
):
    """Daily maintenance visits and cost, scoped to this manager's fleet."""
    if period not in TREND_PERIOD_DAYS:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid period {period!r}. Expected one of: {', '.join(TREND_PERIOD_DAYS)}",
        )
    device_ids = manager_service.get_device_ids_for_manager(db, manager.id)
    return DashboardMaintenanceTrendsOut(
        period=period,
        points=get_dashboard_maintenance_points(db, period, device_ids=device_ids),
    )


@router.get("/users", response_model=list[UserOut])
def manager_list_users(
    q: str | None = None,
    manager: Manager = Depends(require_manager_read("user_management")),
    db: Session = Depends(get_db),
):
    user_ids = manager_service.get_user_ids_for_manager(db, manager.id)
    if not user_ids:
        return []
    query = db.query(User).filter(User.id.in_(user_ids))
    if q:
        like = f"%{q}%"
        query = query.filter(or_(User.username.ilike(like), User.full_name.ilike(like)))
    users = query.order_by(User.username.asc()).all()
    return [_user_out(db, u) for u in users]


@router.get("/users/{user_id}", response_model=UserOut)
def manager_get_user(
    user_id: int,
    manager: Manager = Depends(require_manager_read("user_management")),
    db: Session = Depends(get_db),
):
    """Single user in this manager's scope. 404 (not 403) when the user
    exists but isn't assigned — same convention as _assert_user_in_scope.
    """
    _assert_user_in_scope(db, manager.id, user_id)
    user = db.query(User).filter(User.id == user_id).first()
    if user is None:
        raise HTTPException(status_code=404, detail="User not found")
    return _user_out(db, user)


@router.get("/vehicles")
def manager_list_vehicles(
    compact: bool = False,
    device_id: int | None = None,
    manager: Manager = Depends(require_manager_read("live_tracking")),
    db: Session = Depends(get_db),
):
    """Live-shaped vehicle list (same as /api/live) for the Vehicles page.
    Gated on live_tracking — this is the live fleet view, not vehicle CRUD.
    Pass compact=true to skip per-device driver/owner lookups.
    Pass device_id to fetch a single vehicle by DB id (detail page polls).
    """
    live = _scoped_live(db, manager.id, compact=compact, device_id=device_id)
    return {
        "success": True,
        "count": len(live),
        "cache_status": traccar_cache.status(),
        "live": live,
    }


@router.get("/maintenance/vehicles")
def manager_list_maintenance_vehicles(
    manager: Manager = Depends(require_manager_read("maintenance")),
    db: Session = Depends(get_db),
):
    """Same live-shaped, manager-scoped vehicle list as GET /vehicles, but
    gated on `maintenance` so the Maintenance picker works without also
    requiring live_tracking. Does not change /api/maintenance/* payloads.
    """
    live = _scoped_live(db, manager.id)
    return {
        "success": True,
        "count": len(live),
        "cache_status": traccar_cache.status(),
        "live": live,
    }


@router.get("/drivers", response_model=list[DriverOut])
def manager_list_drivers(
    manager: Manager = Depends(require_manager_read("driver_management")),
    db: Session = Depends(get_db),
):
    """Drivers with an open assignment on any of this manager's vehicles."""
    device_ids = manager_service.get_device_ids_for_manager(db, manager.id)
    if not device_ids:
        return []
    driver_ids = [
        row[0]
        for row in (
            db.query(DriverAssignment.driver_id)
            .filter(
                DriverAssignment.device_id.in_(device_ids),
                DriverAssignment.end_time.is_(None),
            )
            .distinct()
            .all()
        )
    ]
    if not driver_ids:
        return []
    drivers = db.query(Driver).filter(Driver.id.in_(driver_ids)).order_by(Driver.name.asc()).all()
    return [_driver_out(db, d) for d in drivers]


@router.get("/drivers/{driver_id}", response_model=DriverOut)
def manager_get_driver(
    driver_id: int,
    manager: Manager = Depends(require_manager_read("driver_management")),
    db: Session = Depends(get_db),
):
    """Single driver — 404 if not currently assigned on this manager's fleet."""
    driver = _assert_driver_in_scope(db, manager.id, driver_id)
    return _driver_out(db, driver)


def _assignment_out(db: Session, assignment: DriverAssignment, driver: Driver | None = None) -> DriverAssignmentOut:
    device = db.query(Device).filter(Device.id == assignment.device_id).first()
    if driver is None:
        driver = db.query(Driver).filter(Driver.id == assignment.driver_id).first()
    return DriverAssignmentOut(
        id=assignment.id,
        driver_id=assignment.driver_id,
        device_id=assignment.device_id,
        device_name=device.name if device else None,
        device_plate=device.plate_number if device else None,
        driver_name=driver.name if driver else None,
        driver_pic_url=_pic_url(driver.driver_pic_path) if driver else None,
        start_time=assignment.start_time,
        end_time=assignment.end_time,
    )


@router.get("/drivers/{driver_id}/assignments", response_model=list[DriverAssignmentOut])
def manager_list_driver_assignments(
    driver_id: int,
    manager: Manager = Depends(require_manager_read("driver_management")),
    db: Session = Depends(get_db),
):
    """Assignment history limited to this manager's vehicles."""
    driver = _assert_driver_in_scope(db, manager.id, driver_id)
    manager_device_ids = set(manager_service.get_device_ids_for_manager(db, manager.id))
    assignments = [
        a for a in driver_service.get_assignments_for_driver(db, driver_id)
        if a.device_id in manager_device_ids
    ]
    return [_assignment_out(db, a, driver) for a in assignments]


@router.get("/drivers/{driver_id}/detail")
def manager_get_driver_detail(
    driver_id: int,
    date: str | None = None,
    start: str | None = None,
    end: str | None = None,
    manager: Manager = Depends(require_manager_read("driver_management")),
    db: Session = Depends(get_db),
):
    """Same shape as admin GET /api/drivers/{id}/detail, but assignments
    and trips are limited to this manager's devices.
    """
    from datetime import datetime, timedelta

    from tracker_backend.models import Geofence
    from tracker_backend.services.report import _utc_iso
    from tracker_backend.services.trip_tracker import (
        calculate_trip_metrics,
        get_trips_in_range,
    )

    driver = _assert_driver_in_scope(db, manager.id, driver_id)
    manager_device_ids = set(manager_service.get_device_ids_for_manager(db, manager.id))

    if start and end:
        start_dt = datetime.fromisoformat(start.replace("Z", ""))
        end_dt = datetime.fromisoformat(end.replace("Z", ""))
        if end_dt <= start_dt:
            raise HTTPException(status_code=400, detail="`end` must be after `start`")
        label = f"{start_dt.isoformat()} to {end_dt.isoformat()}"
    else:
        date_str = date or datetime.utcnow().date().isoformat()
        try:
            start_dt = datetime.strptime(date_str, "%Y-%m-%d")
        except ValueError:
            raise HTTPException(
                status_code=400, detail=f"Invalid date: {date_str!r}, expected 'YYYY-MM-DD'"
            )
        end_dt = start_dt + timedelta(days=1)
        label = date_str

    assignments = driver_service.get_assignments_for_driver_in_range(
        db, driver_id, start_dt, end_dt,
    )
    assignments = [a for a in assignments if a.device_id in manager_device_ids]

    device_ids = {a.device_id for a in assignments}
    devices_by_id = (
        {d.id: d for d in db.query(Device).filter(Device.id.in_(device_ids)).all()}
        if device_ids else {}
    )

    assignments_out = []
    pending_trips = []
    metrics_dirty = False
    running_totals = driver_service.empty_driver_detail_totals()

    for a in assignments:
        device = devices_by_id.get(a.device_id)
        device_name = device.name if device else f"Device {a.device_id}"
        assignments_out.append({
            "id": a.id,
            "device_id": a.device_id,
            "device_name": device_name,
            "device_plate": device.plate_number if device else None,
            "start_time": _utc_iso(a.start_time),
            "end_time": _utc_iso(a.end_time) if a.end_time else None,
        })

        window_start = max(start_dt, a.start_time)
        window_end = min(end_dt, a.end_time) if a.end_time else end_dt
        if window_end <= window_start or device is None:
            continue

        trips = get_trips_in_range(db, a.device_id, window_start, window_end)
        for trip in trips:
            if not driver_service.trip_attributed_to_driver(trip, driver_id, a):
                continue
            if trip.status == "in_progress" or trip.distance_km is None:
                calculate_trip_metrics(db, trip, device)
                metrics_dirty = True
            pending_trips.append((trip, device_name, a.id))

    confirmed_extra = (
        db.query(Trip)
        .filter(
            Trip.confirmed_driver_id == driver_id,
            Trip.start_time < end_dt,
            or_(Trip.end_time.is_(None), Trip.end_time >= start_dt),
        )
        .all()
    )
    pending_ids = {t.id for t, _, _ in pending_trips}
    for trip in confirmed_extra:
        if trip.id in pending_ids:
            continue
        device = devices_by_id.get(trip.device_id)
        if device is None:
            device = db.query(Device).filter(Device.id == trip.device_id).first()
            if device is not None:
                devices_by_id[device.id] = device
        device_name = device.name if device else f"Device {trip.device_id}"
        if device is not None and (trip.status == "in_progress" or trip.distance_km is None):
            calculate_trip_metrics(db, trip, device)
            metrics_dirty = True
        pending_trips.append((trip, device_name, None))
        pending_ids.add(trip.id)

    if metrics_dirty:
        db.commit()

    unique_pending = []
    seen_trip_ids = set()
    for item in pending_trips:
        trip_id = item[0].id
        if trip_id in seen_trip_ids:
            continue
        seen_trip_ids.add(trip_id)
        unique_pending.append(item)
    pending_trips = unique_pending

    geofence_ids = {trip.geofence_id for trip, _, _ in pending_trips if trip.geofence_id}
    geofence_names_by_id = {}
    if geofence_ids:
        for gf in db.query(Geofence).filter(Geofence.id.in_(geofence_ids)).all():
            geofence_names_by_id[gf.id] = gf.name

    display_number = driver_service.completed_trip_ranks_for_driver(db, driver_id)

    all_trips_out = []
    for trip, device_name, assignment_id in pending_trips:
        row = driver_service.serialize_driver_detail_trip(
            trip,
            device_name=device_name,
            geofence_name=geofence_names_by_id.get(trip.geofence_id),
            assignment_id=assignment_id,
        )
        row["trip_number"] = display_number.get(trip.id)
        all_trips_out.append(row)
        driver_service.accumulate_driver_detail_totals(running_totals, trip)

    all_trips_out.sort(key=lambda t: t["end_time"] or t["start_time"] or "", reverse=True)
    running_totals = driver_service.finalize_driver_detail_totals(running_totals)

    return {
        "driver": _driver_out(db, driver),
        "date": label,
        "range_start": _utc_iso(start_dt),
        "range_end": _utc_iso(end_dt),
        "assignments": assignments_out,
        "trips": all_trips_out,
        "totals": running_totals,
    }


@router.get("/trips", response_model=list[AdminTripOut])
def manager_list_trips(
    trip_date: date | None = None,
    start: str | None = None,
    end: str | None = None,
    status: str | None = None,
    driver_id: int | None = None,
    device_id: int | None = None,
    geofence_id: int | None = None,
    manager: Manager = Depends(require_manager_read("trip_history")),
    db: Session = Depends(get_db),
):
    """Fleet-wide trip list already accepts manager_id — reuse that filter."""
    return build_manager_trips(
        db,
        manager_id=manager.id,
        trip_date=trip_date,
        start=start,
        end=end,
        status=status,
        driver_id=driver_id,
        device_id=device_id,
        geofence_id=geofence_id,
    )


@router.patch("/trips/{trip_id}", response_model=TripOut)
def manager_update_trip_costs(
    trip_id: int,
    payload: TripCostsUpdate,
    manager: Manager = Depends(require_manager_permission("trip_history")),
    db: Session = Depends(get_db),
):
    """Toll/challan edits from the Trips details modal — scoped to a
    device in this manager's fleet.
    """
    trip = db.query(Trip).filter(Trip.id == trip_id).first()
    if trip is None:
        raise HTTPException(status_code=404, detail="Trip not found")
    _assert_device_in_scope(db, manager.id, trip.device_id)

    for field, value in payload.dict(exclude_unset=True).items():
        setattr(trip, field, value)

    db.commit()
    db.refresh(trip)

    trip_out = TripOut.model_validate(trip)
    driver_service.populate_trip_out_drivers(db, trip_out, trip)
    route_assignment_service.populate_trip_out_routes(db, trip_out, trip)
    return trip_out


@router.post("/trips/{trip_id}/confirm-driver", response_model=TripOut)
def manager_confirm_trip_driver(
    trip_id: int,
    payload: TripDriverConfirm,
    manager: Manager = Depends(require_manager_permission("trip_history")),
    db: Session = Depends(get_db),
):
    trip = db.query(Trip).filter(Trip.id == trip_id).first()
    if trip is None:
        raise HTTPException(status_code=404, detail="Trip not found")
    _assert_device_in_scope(db, manager.id, trip.device_id)

    trip = driver_service.confirm_trip_driver(
        db, trip, payload.driver_id, confirmed_by_user_id=manager.user_id
    )
    trip_out = TripOut.model_validate(trip)
    driver_service.populate_trip_out_drivers(db, trip_out, trip)
    route_assignment_service.populate_trip_out_routes(db, trip_out, trip)
    return trip_out


@router.get("/trips/{trip_id}/confirmable-drivers", response_model=list[ConfirmableDriverOut])
def manager_list_confirmable_drivers(
    trip_id: int,
    manager: Manager = Depends(require_manager_read("trip_history")),
    db: Session = Depends(get_db),
):
    trip = db.query(Trip).filter(Trip.id == trip_id).first()
    if trip is None:
        raise HTTPException(status_code=404, detail="Trip not found")
    _assert_device_in_scope(db, manager.id, trip.device_id)
    drivers = driver_service.get_confirmable_drivers(db, trip_id)
    return [
        ConfirmableDriverOut(**driver_service.serialize_confirmable_driver(db, d))
        for d in drivers
    ]


@router.post("/trips/{trip_id}/confirm-route", response_model=TripOut)
def manager_confirm_trip_route(
    trip_id: int,
    payload: TripRouteConfirm,
    manager: Manager = Depends(require_manager_permission("trip_history")),
    db: Session = Depends(get_db),
):
    trip = db.query(Trip).filter(Trip.id == trip_id).first()
    if trip is None:
        raise HTTPException(status_code=404, detail="Trip not found")
    _assert_device_in_scope(db, manager.id, trip.device_id)

    trip = route_assignment_service.confirm_trip_route(
        db, trip, payload.route_id, confirmed_by_user_id=manager.user_id
    )
    trip_out = TripOut.model_validate(trip)
    driver_service.populate_trip_out_drivers(db, trip_out, trip)
    route_assignment_service.populate_trip_out_routes(db, trip_out, trip)
    return trip_out


@router.get("/trips/{trip_id}/confirmable-routes", response_model=list[ConfirmableRouteOut])
def manager_list_confirmable_routes(
    trip_id: int,
    manager: Manager = Depends(require_manager_read("trip_history")),
    db: Session = Depends(get_db),
):
    trip = db.query(Trip).filter(Trip.id == trip_id).first()
    if trip is None:
        raise HTTPException(status_code=404, detail="Trip not found")
    _assert_device_in_scope(db, manager.id, trip.device_id)
    routes = route_assignment_service.get_confirmable_routes(db)
    return [
        ConfirmableRouteOut(**route_assignment_service.serialize_confirmable_route(db, route))
        for route in routes
    ]


@router.get("/alerts", response_model=list[AlertOut])
def manager_list_alerts(
    severity: str | None = None,
    device_id: int | None = None,
    resolved: bool | None = None,
    limit: int = 200,
    manager: Manager = Depends(require_manager_read("alerts_notifications")),
    db: Session = Depends(get_db),
):
    device_ids = manager_service.get_device_ids_for_manager(db, manager.id)
    if not device_ids:
        return []
    if device_id is not None:
        if device_id not in device_ids:
            return []
        device_ids = [device_id]

    query = db.query(DeviceAlert).filter(DeviceAlert.device_id.in_(device_ids))
    if severity is not None:
        query = query.filter(DeviceAlert.severity == severity)
    if resolved is not None:
        query = query.filter(DeviceAlert.is_resolved == resolved)

    alerts = query.order_by(DeviceAlert.triggered_at.desc()).limit(limit).all()
    devices_by_id = {
        d.id: d for d in db.query(Device).filter(Device.id.in_({a.device_id for a in alerts})).all()
    } if alerts else {}
    return [_alert_out(a, devices_by_id.get(a.device_id)) for a in alerts]


# ── mutations (permission-gated) ─────────────────────────────────────

async def _create_device_with_traccar(
    db: Session,
    *,
    name: str,
    imei: str,
    user_id: int | None,
    vehicle_type: str | None = None,
    plate_number: str | None = None,
    fuel_type_id: int | None = None,
    fuel_avg_running: float | None = None,
    fuel_avg_idle: float | None = None,
    fuel_avg_idle_provided: bool = False,
    primary_geofence_id: int | None = None,
    speed_limit_kmh: float | None = None,
    harsh_brake_delta_kmh: float | None = None,
    harsh_accel_delta_kmh: float | None = None,
) -> Device:
    """Registers in Traccar then inserts a Device row (flush only —
    caller commits). Shared by manager_create_vehicle and the atomic
    create-user-with-vehicle endpoint.
    """
    if user_id is not None:
        clash = db.query(Device).filter(Device.user_id == user_id).first()
        if clash is not None:
            raise HTTPException(
                status_code=400,
                detail="This user already owns a vehicle — each user can own at most one.",
            )

    try:
        traccar_device = await traccar_service.create_device(name, imei)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Failed to register device in Traccar: {e}")

    resolved_idle = fuel_avg_idle
    fuel_avg_idle_auto = True
    if fuel_avg_running is not None and not fuel_avg_idle_provided:
        resolved_idle = IDLE_DEFAULTS_BY_VEHICLE_TYPE.get(vehicle_type, DEFAULT_IDLE_FALLBACK)
        fuel_avg_idle_auto = True
    elif fuel_avg_idle_provided:
        fuel_avg_idle_auto = False

    device = Device(
        traccar_device_id=traccar_device["id"],
        name=name,
        vehicle_type=vehicle_type,
        plate_number=plate_number,
        fuel_type_id=fuel_type_id,
        fuel_avg_running=fuel_avg_running,
        fuel_avg_idle=resolved_idle,
        fuel_avg_idle_auto=fuel_avg_idle_auto,
        primary_geofence_id=primary_geofence_id,
        speed_limit_kmh=speed_limit_kmh,
        harsh_brake_delta_kmh=harsh_brake_delta_kmh,
        harsh_accel_delta_kmh=harsh_accel_delta_kmh,
        user_id=user_id,
    )
    db.add(device)
    db.flush()
    db.refresh(device)
    return device


@router.post("/vehicles", response_model=DeviceOut)
async def manager_create_vehicle(
    payload: DeviceCreate,
    manager: Manager = Depends(require_manager_permission("vehicle_management")),
    db: Session = Depends(get_db),
):
    # New vehicle must be owned by one of this manager's assigned users.
    if payload.user_id is None:
        raise HTTPException(status_code=400, detail="user_id is required when creating a vehicle in manager scope")
    _assert_user_in_scope(db, manager.id, payload.user_id)

    payload_fields = payload.dict(exclude_unset=True)
    device = await _create_device_with_traccar(
        db,
        name=payload.name,
        imei=payload.imei,
        user_id=payload.user_id,
        vehicle_type=payload.vehicle_type,
        plate_number=payload.plate_number,
        fuel_type_id=payload.fuel_type_id,
        fuel_avg_running=payload.fuel_avg_running,
        fuel_avg_idle=payload.fuel_avg_idle,
        fuel_avg_idle_provided="fuel_avg_idle" in payload_fields,
        primary_geofence_id=payload.primary_geofence_id,
        speed_limit_kmh=payload.speed_limit_kmh,
        harsh_brake_delta_kmh=payload.harsh_brake_delta_kmh,
        harsh_accel_delta_kmh=payload.harsh_accel_delta_kmh,
    )
    db.commit()
    db.refresh(device)
    return _device_out(db, device)


@router.get("/vehicles/{device_id}", response_model=DeviceOut)
def manager_get_vehicle(
    device_id: int,
    manager: Manager = Depends(require_manager_read("live_tracking")),
    db: Session = Depends(get_db),
):
    device = _assert_device_in_scope(db, manager.id, device_id)
    return _device_out(db, device)


@router.post("/vehicles/{device_id}/photo", response_model=DeviceOut)
async def manager_upload_vehicle_photo(
    device_id: int,
    pic: UploadFile = File(...),
    manager: Manager = Depends(
        require_any_manager_permission("user_management", "vehicle_management")
    ),
    db: Session = Depends(get_db),
):
    from tracker_backend.services.fleet_device_service import set_device_pic

    device = _assert_device_in_scope(db, manager.id, device_id)
    await set_device_pic(db, device, pic)
    return _device_out(db, device)


@router.delete("/vehicles/{device_id}")
async def manager_delete_vehicle(
    device_id: int,
    manager: Manager = Depends(require_manager_permission("vehicle_management")),
    db: Session = Depends(get_db),
):
    from tracker_backend.services.fleet_device_service import delete_fleet_device_cascade

    device = _assert_device_in_scope(db, manager.id, device_id)
    result = await delete_fleet_device_cascade(db, device)
    message = f"Device {device_id} deleted"
    if result["deleted_owner_username"]:
        message += f" along with owner {result['deleted_owner_username']}"
        if result["removed_manager"]:
            message += " (manager role removed)"
    return {"success": True, "message": message, **result}


@router.patch("/vehicles/{device_id}", response_model=DeviceOut)
def manager_update_vehicle(
    device_id: int,
    payload: DeviceUpdate,
    manager: Manager = Depends(require_manager_permission("vehicle_management")),
    db: Session = Depends(get_db),
):
    device = _assert_device_in_scope(db, manager.id, device_id)
    payload_fields = payload.dict(exclude_unset=True)

    if "user_id" in payload_fields and payload_fields["user_id"] != device.user_id:
        raise HTTPException(
            status_code=400,
            detail="Vehicle ownership cannot be changed. Delete the user (and their vehicle) instead.",
        )
    payload_fields.pop("user_id", None)

    for field, value in payload_fields.items():
        setattr(device, field, value)

    running_being_set = "fuel_avg_running" in payload_fields and payload_fields["fuel_avg_running"] is not None
    idle_explicitly_provided = "fuel_avg_idle" in payload_fields

    if running_being_set and not idle_explicitly_provided:
        effective_vehicle_type = payload_fields.get("vehicle_type", device.vehicle_type)
        device.fuel_avg_idle = IDLE_DEFAULTS_BY_VEHICLE_TYPE.get(
            effective_vehicle_type, DEFAULT_IDLE_FALLBACK
        )
        device.fuel_avg_idle_auto = True
    elif idle_explicitly_provided:
        device.fuel_avg_idle_auto = False

    db.commit()
    db.refresh(device)
    return _device_out(db, device)


@router.post("/drivers", response_model=DriverOut)
async def manager_create_driver(
    manager: Manager = Depends(require_manager_permission("driver_management")),
    db: Session = Depends(get_db),
    name: str = Form(...),
    id_card_number: str = Form(...),
    phone_number: str | None = Form(None),
    license_number: str | None = Form(None),
    license_expiry: date | None = Form(None),
    status: str = Form("active"),
    date_joined: date | None = Form(None),
    license_pic: UploadFile | None = File(None),
    driver_pic: UploadFile | None = File(None),
):
    validate_cnic(id_card_number)

    existing = db.query(Driver).filter(Driver.id_card_number == id_card_number).first()
    if existing is not None:
        raise HTTPException(status_code=400, detail="A driver with this ID card number already exists")

    license_pic_path = await save_upload(license_pic, "drivers/license") if license_pic and license_pic.filename else None
    driver_pic_path = await save_upload(driver_pic, "drivers/photo") if driver_pic and driver_pic.filename else None

    driver = Driver(
        name=name,
        id_card_number=id_card_number,
        phone_number=phone_number,
        license_number=license_number,
        license_expiry=license_expiry,
        status=status,
        date_joined=date_joined,
        license_pic_path=license_pic_path,
        driver_pic_path=driver_pic_path,
    )
    db.add(driver)
    db.commit()
    db.refresh(driver)
    return _driver_out(db, driver)


@router.patch("/drivers/{driver_id}", response_model=DriverOut)
async def manager_update_driver(
    driver_id: int,
    manager: Manager = Depends(require_manager_permission("driver_management")),
    db: Session = Depends(get_db),
    name: str | None = Form(None),
    id_card_number: str | None = Form(None),
    phone_number: str | None = Form(None),
    license_number: str | None = Form(None),
    license_expiry: date | None = Form(None),
    status: str | None = Form(None),
    date_joined: date | None = Form(None),
    license_pic: UploadFile | None = File(None),
    driver_pic: UploadFile | None = File(None),
):
    driver = _assert_driver_in_scope(db, manager.id, driver_id)
    await driver_service.apply_driver_form_update(
        db,
        driver,
        name=name,
        id_card_number=id_card_number,
        phone_number=phone_number,
        license_number=license_number,
        license_expiry=license_expiry,
        status=status,
        date_joined=date_joined,
        license_pic=license_pic,
        driver_pic=driver_pic,
    )
    return _driver_out(db, driver)


@router.post("/drivers/{driver_id}/assign")
def manager_assign_driver(
    driver_id: int,
    device_id: int,
    manager: Manager = Depends(require_manager_permission("driver_management")),
    db: Session = Depends(get_db),
):
    driver = _assert_driver_in_scope(db, manager.id, driver_id)
    device = _assert_device_in_scope(db, manager.id, device_id)
    assignment = driver_service.assign_driver(db, driver_id, device_id)
    return {
        "success": True,
        "message": f"{driver.name} assigned to {device.name}",
        "assignment": {
            "id": assignment.id,
            "driver_id": assignment.driver_id,
            "device_id": assignment.device_id,
            "start_time": assignment.start_time,
            "end_time": assignment.end_time,
        },
    }


@router.post("/drivers/{driver_id}/unassign")
def manager_unassign_driver(
    driver_id: int,
    manager: Manager = Depends(require_manager_permission("driver_management")),
    db: Session = Depends(get_db),
):
    driver = _assert_driver_in_scope(db, manager.id, driver_id)
    closed = driver_service.unassign_driver(db, driver_id)
    if closed is None:
        raise HTTPException(status_code=400, detail="Driver is not currently assigned to a vehicle")
    return {"success": True, "message": f"{driver.name} unassigned"}


@router.patch("/users/{user_id}", response_model=UserOut)
def manager_update_user(
    user_id: int,
    payload: UserUpdate,
    manager: Manager = Depends(require_manager_permission("user_management")),
    db: Session = Depends(get_db),
):
    _assert_user_in_scope(db, manager.id, user_id)
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    payload_fields = payload.dict(exclude_unset=True)

    if "username" in payload_fields and payload_fields["username"] != user.username:
        clash = db.query(User).filter(
            User.username == payload_fields["username"], User.id != user_id
        ).first()
        if clash is not None:
            raise HTTPException(status_code=400, detail="A user with this username already exists")

    for field, value in payload_fields.items():
        setattr(user, field, value)

    db.commit()
    db.refresh(user)
    return _user_out(db, user)


@router.post("/users/{user_id}/photo", response_model=UserOut)
async def manager_upload_user_photo(
    user_id: int,
    pic: UploadFile = File(...),
    manager: Manager = Depends(require_manager_permission("user_management")),
    db: Session = Depends(get_db),
):
    _assert_user_in_scope(db, manager.id, user_id)
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    await user_service.set_user_pic(db, user, pic)
    return _user_out(db, user)


@router.post("/users", response_model=UserOut)
async def manager_create_user(
    payload: ManagerCreateUserWithVehicle,
    manager: Manager = Depends(require_manager_permission("user_management")),
    db: Session = Depends(get_db),
):
    """Atomic Add User for managers: creates the user (manager_id set
    on insert) and their mandatory vehicle in one request. Gated on
    user_management only — this is one product action, not Add Vehicle.
    Rolls back the user (and leaves no DB orphan) if Traccar/device
    creation fails after the user flush.
    """
    user_in = payload.user
    vehicle_in = payload.vehicle
    vehicle_fields = vehicle_in.dict(exclude_unset=True)

    user = user_service.create_user_row(
        db,
        username=user_in.username,
        password=user_in.password,
        full_name=user_in.full_name,
        phone_number=user_in.phone_number,
        manager_id=manager.id,
        commit=False,
    )

    try:
        await _create_device_with_traccar(
            db,
            name=vehicle_in.name,
            imei=vehicle_in.imei,
            user_id=user.id,
            vehicle_type=vehicle_in.vehicle_type,
            plate_number=vehicle_in.plate_number,
            fuel_type_id=vehicle_in.fuel_type_id,
            fuel_avg_running=vehicle_in.fuel_avg_running,
            fuel_avg_idle=vehicle_in.fuel_avg_idle,
            fuel_avg_idle_provided="fuel_avg_idle" in vehicle_fields,
            primary_geofence_id=vehicle_in.primary_geofence_id,
            speed_limit_kmh=vehicle_in.speed_limit_kmh,
            harsh_brake_delta_kmh=vehicle_in.harsh_brake_delta_kmh,
            harsh_accel_delta_kmh=vehicle_in.harsh_accel_delta_kmh,
        )
        db.commit()
    except Exception:
        db.rollback()
        raise

    db.refresh(user)
    return _user_out(db, user)


@router.delete("/users/{user_id}")
async def manager_delete_user(
    user_id: int,
    manager: Manager = Depends(require_manager_permission("user_management")),
    db: Session = Depends(get_db),
):
    """Scoped delete — same cascade as admin delete_user (user + paired
    vehicle), but 404 if the user isn't assigned to this manager.
    """
    _assert_user_in_scope(db, manager.id, user_id)
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    result = await user_service.delete_user_row(db, user)
    return {"detail": "User deleted", **result}
