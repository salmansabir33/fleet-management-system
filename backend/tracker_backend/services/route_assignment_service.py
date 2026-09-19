"""Vehicle <-> route assignment and per-trip route confirmation.

A vehicle can have only one open route assignment at a time
(end_time IS NULL). The same route can be assigned to many vehicles.
Assigning a vehicle to a new route closes whatever was open on that
vehicle first. History is never deleted, only closed.

Per-trip confirmation is independent of the vehicle's default route:
confirming a trip stores who the route was for that trip and does not
reassign the vehicle. Unlike drivers, routes are shared — there is no
borrow/unassign on confirm.
"""
from datetime import datetime
import logging

from sqlalchemy import and_, exists, or_

from tracker_backend.models import Device, DeviceAlert, Route, RouteVehicle, Trip

logger = logging.getLogger("route_assignment")

TRIP_ROUTE_PENDING_ALERT = "trip_route_pending_confirmation"


def get_active_assignment_for_device(db, device_id: int) -> RouteVehicle | None:
    return (
        db.query(RouteVehicle)
        .filter(RouteVehicle.device_id == device_id, RouteVehicle.end_time.is_(None))
        .order_by(RouteVehicle.start_time.desc())
        .first()
    )


def get_active_assignments_for_route(db, route_id: int) -> list[RouteVehicle]:
    return (
        db.query(RouteVehicle)
        .filter(RouteVehicle.route_id == route_id, RouteVehicle.end_time.is_(None))
        .order_by(RouteVehicle.start_time.desc())
        .all()
    )


def assign_route(db, route_id: int, device_id: int, at_time: datetime | None = None) -> tuple[RouteVehicle, bool]:
    """Assign `device_id` to `route_id`, closing the vehicle's previous
    open assignment if it was a different route.

    Returns (assignment, created) where `created` is False when the
    vehicle was already on this route (idempotent no-op).
    """
    at_time = at_time or datetime.utcnow()

    device_open = get_active_assignment_for_device(db, device_id)
    if device_open is not None and device_open.route_id == route_id:
        return device_open, False

    if device_open is not None:
        device_open.end_time = at_time

    new_assignment = RouteVehicle(
        route_id=route_id,
        device_id=device_id,
        start_time=at_time,
        end_time=None,
    )
    db.add(new_assignment)
    db.commit()
    db.refresh(new_assignment)
    return new_assignment, True


def unassign_route(
    db, route_id: int, device_id: int, at_time: datetime | None = None
) -> RouteVehicle | None:
    """Closes the device's open assignment if it is currently on `route_id`."""
    at_time = at_time or datetime.utcnow()
    open_assignment = get_active_assignment_for_device(db, device_id)
    if open_assignment is None or open_assignment.route_id != route_id:
        return None
    open_assignment.end_time = at_time
    db.commit()
    db.refresh(open_assignment)
    return open_assignment


def get_covering_assignment(db, device_id: int, at_time: datetime) -> RouteVehicle | None:
    if at_time is None:
        return None
    return (
        db.query(RouteVehicle)
        .filter(
            RouteVehicle.device_id == device_id,
            RouteVehicle.start_time <= at_time,
            or_(RouteVehicle.end_time.is_(None), RouteVehicle.end_time > at_time),
        )
        .order_by(RouteVehicle.start_time.desc())
        .first()
    )


def get_route_for_trip(db, device_id: int, trip_start: datetime) -> Route | None:
    """Route assigned to `device_id` at `trip_start`, if any."""
    assignment = get_covering_assignment(db, device_id, trip_start)
    if assignment is None:
        return None
    return db.query(Route).filter(Route.id == assignment.route_id).first()


def get_match_route_for_trip(db, trip: Trip) -> Route | None:
    """Route GPS matching should use: confirmed wins, else assigned-at-start."""
    if getattr(trip, "confirmed_route_id", None) is not None:
        return db.query(Route).filter(Route.id == trip.confirmed_route_id).first()
    return get_route_for_trip(db, trip.device_id, trip.start_time)


def _resolve_pending_confirmation_alert(db, device_id: int) -> None:
    open_alert = (
        db.query(DeviceAlert)
        .filter_by(
            device_id=device_id,
            alert_type=TRIP_ROUTE_PENDING_ALERT,
            is_resolved=False,
        )
        .first()
    )
    if open_alert is not None:
        open_alert.is_resolved = True
        open_alert.resolved_at = datetime.utcnow()


def confirm_trip_route(
    db,
    trip: Trip,
    route_id: int,
    confirmed_by_user_id: int | None = None,
    at_time: datetime | None = None,
) -> Trip:
    """Confirm which route this trip used. Trip-only; does not reassign
    the vehicle. Rematches GPS when the trip is already completed.
    """
    from fastapi import HTTPException

    at_time = at_time or datetime.utcnow()
    route = db.query(Route).filter(Route.id == route_id).first()
    if route is None:
        raise HTTPException(status_code=404, detail="Route not found")

    trip.confirmed_route_id = route_id
    trip.route_confirmed_at = at_time
    trip.route_confirmed_by_user_id = confirmed_by_user_id

    _resolve_pending_confirmation_alert(db, trip.device_id)
    db.commit()
    db.refresh(trip)

    if trip.status == "completed" and trip.end_time is not None:
        from tracker_backend.services import route_matcher
        try:
            route_matcher.match_trip_to_routes(db, trip)
        except Exception:
            logger.exception(
                "Route rematch after confirm failed for trip_id=%s route_id=%s",
                trip.id,
                route_id,
            )

    return trip


def get_confirmable_routes(db) -> list[Route]:
    return db.query(Route).order_by(Route.name.asc(), Route.id.asc()).all()


def apply_route_confirmation_fields(trip_out, trip: Trip, confirmed_route: Route | None) -> None:
    """Populate confirmation-related TripOut route fields in place."""
    if trip.confirmed_route_id is not None and confirmed_route is not None:
        trip_out.route_confirmation_status = "confirmed"
        trip_out.confirmed_route_id = confirmed_route.id
        trip_out.confirmed_route_name = confirmed_route.name
    else:
        trip_out.route_confirmation_status = "pending"
        trip_out.confirmed_route_id = None
        trip_out.confirmed_route_name = None


def resolve_confirmed_routes_for_trips(db, trips) -> dict[int, Route | None]:
    if not trips:
        return {}
    route_ids = {
        trip.confirmed_route_id
        for trip in trips
        if getattr(trip, "confirmed_route_id", None) is not None
    }
    routes_by_id = {
        route.id: route
        for route in (
            db.query(Route).filter(Route.id.in_(route_ids)).all() if route_ids else []
        )
    }
    return {
        trip.id: routes_by_id.get(trip.confirmed_route_id)
        for trip in trips
    }


def resolve_routes_for_trips(db, trips) -> dict[int, Route | None]:
    """Batch version of get_route_for_trip for trip list endpoints."""
    if not trips:
        return {}

    device_ids = {trip.device_id for trip in trips if trip.device_id is not None}
    trip_starts = [trip.start_time for trip in trips if trip.start_time is not None]
    if not device_ids or not trip_starts:
        return {trip.id: None for trip in trips}

    min_start = min(trip_starts)
    max_start = max(trip_starts)

    assignments = (
        db.query(RouteVehicle)
        .filter(
            RouteVehicle.device_id.in_(device_ids),
            RouteVehicle.start_time <= max_start,
            or_(RouteVehicle.end_time.is_(None), RouteVehicle.end_time > min_start),
        )
        .order_by(RouteVehicle.start_time.desc())
        .all()
    )

    assignments_by_device: dict[int, list[RouteVehicle]] = {}
    route_ids: set[int] = set()
    for assignment in assignments:
        assignments_by_device.setdefault(assignment.device_id, []).append(assignment)
        route_ids.add(assignment.route_id)

    routes_by_id = {
        route.id: route
        for route in (
            db.query(Route).filter(Route.id.in_(route_ids)).all() if route_ids else []
        )
    }

    result: dict[int, Route | None] = {}
    for trip in trips:
        covering = None
        for assignment in assignments_by_device.get(trip.device_id, []):
            if assignment.start_time > trip.start_time:
                continue
            if assignment.end_time is not None and assignment.end_time <= trip.start_time:
                continue
            covering = assignment
            break
        result[trip.id] = routes_by_id.get(covering.route_id) if covering else None
    return result


def populate_trip_out_routes(db, trip_out, trip: Trip) -> None:
    """Fill assigned + confirmed route fields on a TripOut instance."""
    route = get_route_for_trip(db, trip.device_id, trip.start_time)
    trip_out.route_id = route.id if route else None
    trip_out.route_name = route.name if route else None

    confirmed = None
    if getattr(trip, "confirmed_route_id", None) is not None:
        confirmed = db.query(Route).filter(Route.id == trip.confirmed_route_id).first()
    apply_route_confirmation_fields(trip_out, trip, confirmed)


def covering_assignment_for_route_exists(route_id: int):
    """Correlated EXISTS: vehicle had this route assigned at trip.start_time."""
    return exists().where(
        and_(
            RouteVehicle.device_id == Trip.device_id,
            RouteVehicle.route_id == route_id,
            RouteVehicle.start_time <= Trip.start_time,
            or_(RouteVehicle.end_time.is_(None), RouteVehicle.end_time > Trip.start_time),
        )
    )


def trip_attributed_to_route_clause(route_id: int):
    """Pending → assigned-at-start; confirmed → confirmed_route_id only."""
    return or_(
        Trip.confirmed_route_id == route_id,
        and_(
            Trip.confirmed_route_id.is_(None),
            covering_assignment_for_route_exists(route_id),
        ),
    )


def query_trips_attributed_to_route(
    db,
    route_id: int,
    start_dt: datetime,
    end_dt: datetime,
    device_ids: list[int] | None = None,
):
    """Completed trips in the window that belong to `route_id` by confirmation."""
    query = db.query(Trip).filter(
        Trip.status == "completed",
        Trip.end_time.isnot(None),
        Trip.start_time < end_dt,
        Trip.end_time >= start_dt,
        trip_attributed_to_route_clause(route_id),
    )
    if device_ids is not None:
        if not device_ids:
            return query.filter(Trip.id.in_([]))
        query = query.filter(Trip.device_id.in_(device_ids))
    return query


def trip_is_attributed_to_route(db, trip: Trip, route_id: int) -> bool:
    route = get_match_route_for_trip(db, trip)
    return route is not None and route.id == route_id


def list_assigned_route_vehicle_trip_counts(
    db,
    route_id: int,
    start_dt: datetime,
    end_dt: datetime,
    device_ids: list[int] | None = None,
) -> list[dict]:
    """Currently assigned vehicles that have attributed trips in the window."""
    assigned_ids = [row.device_id for row in get_active_assignments_for_route(db, route_id)]
    if device_ids is not None:
        allowed = set(device_ids)
        assigned_ids = [device_id for device_id in assigned_ids if device_id in allowed]
    if not assigned_ids:
        return []

    trips = query_trips_attributed_to_route(
        db, route_id, start_dt, end_dt, device_ids=assigned_ids,
    ).all()
    counts: dict[int, int] = {}
    for trip in trips:
        counts[trip.device_id] = counts.get(trip.device_id, 0) + 1

    devices = db.query(Device).filter(Device.id.in_(assigned_ids)).all()
    devices.sort(key=lambda device: ((device.name or "").lower(), device.id))
    return [
        {"device_id": device.id, "vehicle_name": device.name, "trip_count": counts[device.id]}
        for device in devices
        if counts.get(device.id, 0) > 0
    ]


def list_other_trips_for_route(
    db,
    route_id: int,
    start_dt: datetime,
    end_dt: datetime,
    device_ids: list[int] | None = None,
) -> list[Trip]:
    """Attributed trips whose vehicle is not currently assigned to this route."""
    assigned_ids = {row.device_id for row in get_active_assignments_for_route(db, route_id)}
    query = query_trips_attributed_to_route(db, route_id, start_dt, end_dt, device_ids=device_ids)
    if assigned_ids:
        query = query.filter(~Trip.device_id.in_(assigned_ids))
    return query.order_by(Trip.start_time.desc()).all()


def list_device_trips_attributed_to_route(
    db,
    route_id: int,
    device_id: int,
    start_dt: datetime,
    end_dt: datetime,
) -> list[Trip]:
    return (
        query_trips_attributed_to_route(
            db, route_id, start_dt, end_dt, device_ids=[device_id],
        )
        .order_by(Trip.start_time.desc())
        .all()
    )


def serialize_confirmable_route(db, route: Route) -> dict:
    assignments = get_active_assignments_for_route(db, route.id)
    device_ids = [row.device_id for row in assignments]
    devices = (
        db.query(Device).filter(Device.id.in_(device_ids)).all() if device_ids else []
    )
    name_by_id = {device.id: device.name for device in devices}
    names = [name_by_id[device_id] for device_id in device_ids if device_id in name_by_id]
    return {
        "id": route.id,
        "name": route.name,
        "current_device_names": names,
    }


def match_percent_by_trip_id(db, route_id: int, trip_ids: list[int]) -> dict[int, float]:
    if not trip_ids:
        return {}
    from tracker_backend.models import TripRouteMatch
    rows = (
        db.query(TripRouteMatch)
        .filter(TripRouteMatch.route_id == route_id, TripRouteMatch.trip_id.in_(trip_ids))
        .all()
    )
    return {row.trip_id: row.match_percent for row in rows}


def trip_display_date(trip: Trip):
    if trip.trip_date is not None:
        return trip.trip_date
    if trip.start_time is not None:
        return trip.start_time.date()
    return None
