"""Manager-scoped route endpoints — `/api/manager/{manager_id}/routes*`.

Mirrors main.py's /api/routes* surface, filtered to devices this manager
can see. Gated on route_management for both reads and writes (new
permission — no need to split). Does not import from main.py (circular).
"""
import logging
from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from tracker_backend.deps import get_db, require_manager_permission, require_manager_scope
from tracker_backend.manager_panel import _assert_device_in_scope
from tracker_backend.models import (
    Device, Driver, DriverAssignment, Manager, Route,
    RouteVehicle, Trip,
)
from tracker_backend.schemas import (
    RouteCreate, RouteListOut, RouteMatchedTripOut, RouteOtherTripOut, RouteOut,
    RouteAssignedVehicleWithDriverOut, RoutePreviewOut, RouteUpdate,
    RouteVehicleAssign, RouteVehicleMatchOut, TripRouteDetailOut,
)
from tracker_backend.services import manager_service
from tracker_backend.services import route_assignment_service, route_matcher, routing_service

router = APIRouter(
    prefix="/api/manager/{manager_id}",
    tags=["manager-panel"],
    dependencies=[Depends(require_manager_scope)],
)

_log = logging.getLogger("routes")


def _route_point_dict(lat: float, lon: float) -> dict:
    return {"lat": lat, "lon": lon}


def _resolve_route_match_window(
    range_key: str,
    date_param: str | None,
    start_param: str | None,
    end_param: str | None,
):
    """Same window logic as main._resolve_route_match_window — kept local
    so this module never imports from main.
    """
    today = datetime.utcnow().date()

    if range_key == "today":
        start_dt = datetime.combine(today, datetime.min.time())
        return start_dt, start_dt + timedelta(days=1)

    if range_key == "week":
        week_start = today - timedelta(days=today.weekday())
        start_dt = datetime.combine(week_start, datetime.min.time())
        return start_dt, start_dt + timedelta(days=7)

    if range_key == "month":
        month_start = today.replace(day=1)
        next_month = (
            month_start.replace(year=month_start.year + 1, month=1)
            if month_start.month == 12
            else month_start.replace(month=month_start.month + 1)
        )
        start_dt = datetime.combine(month_start, datetime.min.time())
        end_dt = datetime.combine(next_month, datetime.min.time())
        return start_dt, end_dt

    if range_key == "date":
        if not date_param:
            raise HTTPException(status_code=400, detail="`date` is required when range=date")
        start_dt = datetime.strptime(date_param, "%Y-%m-%d")
        return start_dt, start_dt + timedelta(days=1)

    if range_key == "range":
        if not start_param or not end_param:
            raise HTTPException(status_code=400, detail="`start` and `end` are required when range=range")
        start_dt = datetime.strptime(start_param, "%Y-%m-%d")
        end_dt = datetime.strptime(end_param, "%Y-%m-%d") + timedelta(days=1)
        if end_dt <= start_dt:
            raise HTTPException(status_code=400, detail="`end` must be on or after `start`")
        return start_dt, end_dt

    raise HTTPException(
        status_code=400,
        detail="Invalid range. Use today, week, month, date, or range.",
    )


def _scoped_route_device_ids(db: Session, manager_id: int, route_id: int) -> set[int]:
    """Intersection of this route's assigned devices and the manager's fleet."""
    manager_device_ids = set(manager_service.get_device_ids_for_manager(db, manager_id))
    if not manager_device_ids:
        return set()
    assigned = {
        row.device_id
        for row in db.query(RouteVehicle.device_id).filter(
            RouteVehicle.route_id == route_id,
            RouteVehicle.end_time.is_(None),
        ).all()
    }
    return assigned & manager_device_ids


def _assert_route_in_scope(db: Session, manager_id: int, route_id: int) -> Route:
    """404 when the route is missing, or has assignments but none overlap
    this manager's devices. Empty (unassigned) routes are allowed so the
    create → assign flow can finish without a premature 404.
    """
    route = db.query(Route).filter(Route.id == route_id).first()
    if route is None:
        raise HTTPException(status_code=404, detail="Route not found")

    assigned_ids = {
        row.device_id
        for row in db.query(RouteVehicle.device_id).filter(
            RouteVehicle.route_id == route_id,
            RouteVehicle.end_time.is_(None),
        ).all()
    }
    if not assigned_ids:
        return route

    if not _scoped_route_device_ids(db, manager_id, route_id):
        raise HTTPException(status_code=404, detail="Route not found")
    return route


def _route_out_scoped(db: Session, manager_id: int, route: Route) -> RouteOut:
    """Same shape as main._route_out, but only exposes in-scope vehicles."""
    manager_device_ids = set(manager_service.get_device_ids_for_manager(db, manager_id))
    assignments = (
        db.query(RouteVehicle, Device)
        .join(Device, Device.id == RouteVehicle.device_id)
        .filter(
            RouteVehicle.route_id == route.id,
            RouteVehicle.end_time.is_(None),
            RouteVehicle.device_id.in_(manager_device_ids) if manager_device_ids else False,
        )
        .all()
    )
    return RouteOut(
        id=route.id,
        name=route.name,
        direction_label=route.direction_label,
        waypoints=route.waypoints or [],
        path=route.path or [],
        tolerance_meters=route.tolerance_meters,
        assigned_vehicles=[
            {"id": device.id, "name": device.name}
            for _assignment, device in assignments
        ],
        created_at=route.created_at,
    )


@router.post("/routes/preview", response_model=RoutePreviewOut)
async def manager_preview_route(
    payload: RouteCreate,
    manager: Manager = Depends(require_manager_permission("route_management")),
):
    path = await routing_service.get_road_path(
        [(point.lat, point.lon) for point in payload.waypoints]
    )
    return {
        "waypoints": payload.waypoints,
        "path": [_route_point_dict(lat, lon) for lat, lon in path],
    }


@router.post("/routes", response_model=RouteOut)
async def manager_create_route(
    payload: RouteCreate,
    manager: Manager = Depends(require_manager_permission("route_management")),
    db: Session = Depends(get_db),
):
    path = await routing_service.get_road_path(
        [(point.lat, point.lon) for point in payload.waypoints]
    )
    route = Route(
        name=payload.name,
        direction_label=payload.direction_label,
        waypoints=[point.model_dump() for point in payload.waypoints],
        path=[_route_point_dict(lat, lon) for lat, lon in path],
        tolerance_meters=payload.tolerance_meters or 400,
    )
    db.add(route)
    db.commit()
    db.refresh(route)
    # No vehicles assigned yet — backfill is a no-op until assign.
    try:
        route_matcher.backfill_route_matches(db, route)
    except Exception:
        db.rollback()
        _log.exception("Route match backfill failed for route_id=%s", route.id)
    return _route_out_scoped(db, manager.id, route)


@router.get("/routes", response_model=list[RouteListOut])
def manager_list_routes(
    manager: Manager = Depends(require_manager_permission("route_management")),
    db: Session = Depends(get_db),
):
    """Routes that have at least one of this manager's devices assigned.
    Admin lists every route; managers only see overlapping ones. Vehicle
    counts / names are filtered to the manager's fleet.
    """
    device_ids = manager_service.get_device_ids_for_manager(db, manager.id)
    if not device_ids:
        return []

    assignment_rows = (
        db.query(RouteVehicle, Device)
        .join(Device, Device.id == RouteVehicle.device_id)
        .filter(
            RouteVehicle.device_id.in_(device_ids),
            RouteVehicle.end_time.is_(None),
        )
        .order_by(Device.name.asc())
        .all()
    )
    if not assignment_rows:
        return []

    vehicles_by_route: dict[int, list[Device]] = {}
    scoped_device_ids: set[int] = set()
    for assignment, device in assignment_rows:
        vehicles_by_route.setdefault(assignment.route_id, []).append(device)
        scoped_device_ids.add(device.id)

    routes = (
        db.query(Route)
        .filter(Route.id.in_(vehicles_by_route.keys()))
        .order_by(Route.created_at.desc(), Route.id.desc())
        .all()
    )

    driver_name_by_device: dict[int, str] = {}
    active_rows = (
        db.query(DriverAssignment, Driver)
        .join(Driver, Driver.id == DriverAssignment.driver_id)
        .filter(
            DriverAssignment.device_id.in_(scoped_device_ids),
            DriverAssignment.end_time.is_(None),
        )
        .order_by(DriverAssignment.start_time.desc())
        .all()
    )
    for assignment, driver in active_rows:
        if assignment.device_id not in driver_name_by_device:
            driver_name_by_device[assignment.device_id] = driver.name

    return [
        RouteListOut(
            id=route.id,
            name=route.name,
            direction_label=route.direction_label,
            vehicle_count=len(vehicles_by_route.get(route.id, [])),
            assigned_vehicles=[
                RouteAssignedVehicleWithDriverOut(
                    id=device.id,
                    name=device.name,
                    driver_name=driver_name_by_device.get(device.id),
                )
                for device in vehicles_by_route.get(route.id, [])
            ],
            created_at=route.created_at,
        )
        for route in routes
    ]


@router.get("/routes/{route_id}", response_model=RouteOut)
def manager_get_route(
    route_id: int,
    manager: Manager = Depends(require_manager_permission("route_management")),
    db: Session = Depends(get_db),
):
    route = _assert_route_in_scope(db, manager.id, route_id)
    return _route_out_scoped(db, manager.id, route)


@router.patch("/routes/{route_id}", response_model=RouteOut)
async def manager_update_route(
    route_id: int,
    payload: RouteUpdate,
    manager: Manager = Depends(require_manager_permission("route_management")),
    db: Session = Depends(get_db),
):
    route = _assert_route_in_scope(db, manager.id, route_id)

    updates = payload.dict(exclude_unset=True)
    if "waypoints" in updates and updates["waypoints"] is not None:
        path = await routing_service.get_road_path(
            [(point.lat, point.lon) for point in payload.waypoints]
        )
        route.waypoints = [point.model_dump() for point in payload.waypoints]
        route.path = [_route_point_dict(lat, lon) for lat, lon in path]

    for field in ("name", "direction_label", "tolerance_meters"):
        if field in updates:
            setattr(route, field, updates[field])

    db.commit()
    db.refresh(route)
    return _route_out_scoped(db, manager.id, route)


@router.delete("/routes/{route_id}")
def manager_delete_route(
    route_id: int,
    manager: Manager = Depends(require_manager_permission("route_management")),
    db: Session = Depends(get_db),
):
    """Deletes the route when it overlaps this manager's fleet. Empty
    routes are also deletable (create→abandon). Routes that only touch
    other managers' vehicles 404.
    """
    route = _assert_route_in_scope(db, manager.id, route_id)
    # Stricter than get: refuse delete when the route has any
    # out-of-scope vehicles (would wipe another manager's assignments).
    assigned_ids = {
        row.device_id
        for row in db.query(RouteVehicle.device_id).filter(
            RouteVehicle.route_id == route_id,
            RouteVehicle.end_time.is_(None),
        ).all()
    }
    if assigned_ids:
        scoped = _scoped_route_device_ids(db, manager.id, route_id)
        if scoped != assigned_ids:
            raise HTTPException(status_code=404, detail="Route not found")
    db.delete(route)
    db.commit()
    return {"success": True, "message": f"Route {route_id} deleted"}


@router.post("/routes/{route_id}/vehicles")
def manager_assign_route_vehicle(
    route_id: int,
    payload: RouteVehicleAssign,
    manager: Manager = Depends(require_manager_permission("route_management")),
    db: Session = Depends(get_db),
):
    route = _assert_route_in_scope(db, manager.id, route_id)
    _assert_device_in_scope(db, manager.id, payload.device_id)

    _assignment, created = route_assignment_service.assign_route(
        db, route_id, payload.device_id
    )
    if created:
        try:
            route_matcher.backfill_route_matches(db, route, device_ids=[payload.device_id])
        except Exception:
            db.rollback()
            _log.exception(
                "Route match backfill failed for route_id=%s device_id=%s",
                route_id,
                payload.device_id,
            )

    return {"success": True}


@router.delete("/routes/{route_id}/vehicles/{device_id}")
def manager_unassign_route_vehicle(
    route_id: int,
    device_id: int,
    manager: Manager = Depends(require_manager_permission("route_management")),
    db: Session = Depends(get_db),
):
    _assert_route_in_scope(db, manager.id, route_id)
    _assert_device_in_scope(db, manager.id, device_id)
    assignment = route_assignment_service.unassign_route(db, route_id, device_id)
    if assignment is None:
        raise HTTPException(status_code=404, detail="Route assignment not found")
    return {"success": True}


@router.post("/routes/{route_id}/recalculate")
def manager_recalculate_route_matches(
    route_id: int,
    manager: Manager = Depends(require_manager_permission("route_management")),
    db: Session = Depends(get_db),
):
    route = _assert_route_in_scope(db, manager.id, route_id)
    scoped_ids = list(_scoped_route_device_ids(db, manager.id, route_id))
    try:
        route_matcher.backfill_route_matches(db, route, device_ids=scoped_ids)
    except Exception:
        db.rollback()
        _log.exception("Route match backfill failed for route_id=%s", route_id)
    return {"success": True}


@router.get("/routes/{route_id}/vehicles", response_model=list[RouteVehicleMatchOut])
def manager_list_route_match_vehicles(
    route_id: int,
    range: str = "today",
    date: str | None = None,
    start: str | None = None,
    end: str | None = None,
    manager: Manager = Depends(require_manager_permission("route_management")),
    db: Session = Depends(get_db),
):
    _assert_route_in_scope(db, manager.id, route_id)
    scoped_ids = _scoped_route_device_ids(db, manager.id, route_id)
    if not scoped_ids:
        return []

    start_dt, end_dt = _resolve_route_match_window(range, date, start, end)
    return route_assignment_service.list_assigned_route_vehicle_trip_counts(
        db, route_id, start_dt, end_dt, device_ids=scoped_ids,
    )


@router.get("/routes/{route_id}/other-trips", response_model=list[RouteOtherTripOut])
def manager_list_route_other_trips(
    route_id: int,
    range: str = "today",
    date: str | None = None,
    start: str | None = None,
    end: str | None = None,
    manager: Manager = Depends(require_manager_permission("route_management")),
    db: Session = Depends(get_db),
):
    _assert_route_in_scope(db, manager.id, route_id)
    scoped_ids = _scoped_route_device_ids(db, manager.id, route_id)
    if not scoped_ids:
        return []

    start_dt, end_dt = _resolve_route_match_window(range, date, start, end)
    trips = route_assignment_service.list_other_trips_for_route(
        db, route_id, start_dt, end_dt, device_ids=scoped_ids,
    )
    percents = route_assignment_service.match_percent_by_trip_id(
        db, route_id, [trip.id for trip in trips],
    )
    device_ids = {trip.device_id for trip in trips}
    devices = (
        db.query(Device).filter(Device.id.in_(device_ids)).all() if device_ids else []
    )
    name_by_id = {device.id: device.name for device in devices}
    return [
        RouteOtherTripOut(
            trip_id=trip.id,
            device_id=trip.device_id,
            vehicle_name=name_by_id.get(trip.device_id) or "—",
            date=route_assignment_service.trip_display_date(trip),
            start_time=trip.start_time,
            end_time=trip.end_time,
            match_percent=percents.get(trip.id, 0) or 0,
        )
        for trip in trips
        if route_assignment_service.trip_display_date(trip) is not None
    ]


@router.get(
    "/routes/{route_id}/vehicles/{device_id}/trips",
    response_model=list[RouteMatchedTripOut],
)
def manager_list_route_vehicle_trips(
    route_id: int,
    device_id: int,
    range: str = "today",
    date: str | None = None,
    start: str | None = None,
    end: str | None = None,
    manager: Manager = Depends(require_manager_permission("route_management")),
    db: Session = Depends(get_db),
):
    _assert_route_in_scope(db, manager.id, route_id)
    _assert_device_in_scope(db, manager.id, device_id)

    start_dt, end_dt = _resolve_route_match_window(range, date, start, end)
    trips = route_assignment_service.list_device_trips_attributed_to_route(
        db, route_id, device_id, start_dt, end_dt,
    )
    percents = route_assignment_service.match_percent_by_trip_id(
        db, route_id, [trip.id for trip in trips],
    )
    return [
        RouteMatchedTripOut(
            trip_id=trip.id,
            date=route_assignment_service.trip_display_date(trip),
            start_time=trip.start_time,
            end_time=trip.end_time,
            match_percent=percents.get(trip.id, 0) or 0,
        )
        for trip in trips
        if route_assignment_service.trip_display_date(trip) is not None
    ]


@router.get("/trips/{trip_id}/route-detail", response_model=TripRouteDetailOut)
def manager_get_trip_route_detail(
    trip_id: int,
    route_id: int,
    max_points: int | None = 4000,
    manager: Manager = Depends(require_manager_permission("route_management")),
    db: Session = Depends(get_db),
):
    """Needed by the Routes page trip drawer — same shape as admin."""
    if max_points is not None and max_points < 2:
        raise HTTPException(status_code=400, detail="max_points must be at least 2")

    _assert_route_in_scope(db, manager.id, route_id)
    detail = route_matcher.build_trip_route_detail(db, trip_id, route_id, max_points)
    if detail is None:
        raise HTTPException(status_code=404, detail="Trip route match not found")
    trip = db.query(Trip).filter(Trip.id == trip_id).first()
    _assert_device_in_scope(db, manager.id, trip.device_id)
    return detail
