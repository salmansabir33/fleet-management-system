"""
Geofence-based trip detection, called from poller.py on every poll AFTER
save_positions has run (trip detection relies on reading a fully
up-to-date Device row — last_seen_at, device_type, etc. are set by
save_positions).

A "trip" is defined as the interval between a device EXITING its assigned
geofence (start) and re-ENTERING it (end). In-memory state
`_inside_geofence` tracks whether each device was last seen inside its
geofence, so we can detect the exit/enter transitions. Resets on app
restart — the first observation after a restart just seeds the state
without creating a phantom trip (we don't know if it was mid-trip already).
"""

from datetime import datetime, timedelta
import logging

from sqlalchemy import or_
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import load_only

from tracker_backend.db import SessionLocal
from tracker_backend.models import Device, DevicePosition, Geofence, Trip
from tracker_backend.services.position_writer import (
    backfill_positions_from_traccar,
    haversine_meters,
    positions_have_gap,
)
from tracker_backend.services.fuel_price_reflow import get_applicable_fuel_price
from tracker_backend.services.report import (
    OVERSPEED_THRESHOLD_KMH,
    HARSH_BRAKE_DELTA_KMH,
    HARSH_ACCEL_DELTA_KMH,
)
from tracker_backend.services import manager_service
from tracker_backend.services import route_matcher
from tracker_backend.services import driver_service
from tracker_backend.services import route_assignment_service
from tracker_backend.services.alert_monitor import _raise_alert

logger = logging.getLogger("trip_tracker")


def _raise_trip_driver_pending_alert(db, device: Device, trip: Trip) -> None:
    """Notify admin/manager that a new trip needs driver confirmation."""
    driver, _ = driver_service.get_driver_for_trip(
        db, device.id, trip.start_time, trip.status
    )
    driver_label = driver.name if driver else "Unassigned"
    _raise_alert(
        db,
        device.id,
        driver_service.TRIP_DRIVER_PENDING_ALERT,
        "info",
        f"'{device.name}' trip started — confirm driver '{driver_label}'",
    )


def _raise_trip_route_pending_alert(db, device: Device, trip: Trip) -> None:
    """Notify admin/manager that a new trip needs route confirmation."""
    route = route_assignment_service.get_route_for_trip(db, device.id, trip.start_time)
    route_label = route.name if route else "Unassigned"
    _raise_alert(
        db,
        device.id,
        route_assignment_service.TRIP_ROUTE_PENDING_ALERT,
        "info",
        f"'{device.name}' trip started — confirm route '{route_label}'",
    )

# In-memory "is this device currently inside its geofence" — keyed by
# Device.id (the DB id, not traccar_device_id). Same pattern as
# position_writer.py's `_last_saved`. Resets on app restart, which is
# fine: the first poll after a restart just seeds the state.
_inside_geofence: dict[int, bool] = {}


def process_trip_detection(devices: list, positions: list):
    """Called every poll with the already-fetched devices/positions.

    For each position, checks whether the device is inside its assigned
    geofence and, on exit/enter transitions, opens or closes a Trip row.
    Commits per transition (not one giant commit at the end) so a crash
    mid-poll never loses an already-detected transition.
    """
    if not positions:
        return

    db = SessionLocal()
    try:
        for p in positions:
            traccar_device_id = p["deviceId"]

            # 1. Look up the Device row by traccar_device_id.
            device = (
                db.query(Device)
                .filter(Device.traccar_device_id == traccar_device_id)
                .first()
            )

            # 2. No device found, or no geofence assigned — skip entirely.
            if device is None or device.primary_geofence_id is None:
                continue

            # 3. Look up the Geofence row. If it was deleted (data
            #    inconsistency), skip this position.
            geofence = (
                db.query(Geofence)
                .filter(Geofence.id == device.primary_geofence_id)
                .first()
            )
            if geofence is None:
                continue
            if geofence.admin_id != device.admin_id:
                continue

            # Parse fix_time the same way position_writer.py parses it.
            fix_time = datetime.fromisoformat(
                p["fixTime"].replace("Z", "+00:00")
            ).replace(tzinfo=None)

            position_lat = p["latitude"]
            position_lon = p["longitude"]

            # 4. Distance from the geofence center to this position.
            distance_from_center = haversine_meters(
                geofence.center_lat,
                geofence.center_lon,
                position_lat,
                position_lon,
            )

            # 5. Inside if within the geofence radius.
            is_inside = distance_from_center <= geofence.radius_meters

            # 6. Previous in-memory state (None = never seen this device
            #    in this process's lifetime, e.g. just after a restart).
            was_inside = _inside_geofence.get(device.id)

            # 7. First observation — seed state, do NOT create a trip.
            #
            #    Self-heal: `_inside_geofence` resets to empty every time
            #    this process restarts (deploy, crash, or — very common
            #    during local dev — an auto-reloader). If the device is
            #    ALREADY back inside its geofence the first time we see
            #    it after a restart, and there's a Trip left over from
            #    before the restart that's still "in_progress", the
            #    normal exit->enter transition below will never fire
            #    again for it (state just seeds straight to True, so a
            #    future True->True observation is a no-op). Without this,
            #    that trip would stay stuck "in_progress" forever, only
            #    fixable by the device leaving and re-entering again.
            #    Reconciling against the DB here instead of blindly
            #    trusting memory closes it immediately.
            if was_inside is None:
                _inside_geofence[device.id] = is_inside
                if is_inside:
                    stale_open_trip = (
                        db.query(Trip)
                        .filter(Trip.device_id == device.id, Trip.status == "in_progress")
                        .order_by(Trip.start_time.desc())
                        .first()
                    )
                    if stale_open_trip is not None:
                        _close_trip(
                            db, stale_open_trip, device, fix_time, position_lat, position_lon
                        )
                continue

            # 8. Device just EXITED the geofence → open a new trip.
            if was_inside is True and not is_inside:
                # Defensive: backfill can already have an in_progress
                # row from a nearby stored position. Do not insert a
                # second open trip for the same device.
                already_open = (
                    db.query(Trip)
                    .filter(
                        Trip.device_id == device.id,
                        Trip.status == "in_progress",
                    )
                    .first()
                )
                if already_open is not None:
                    logger.warning(
                        "Prevented duplicate in_progress trip for "
                        "device_id=%s (existing trip_id=%s)",
                        device.id,
                        already_open.id,
                    )
                else:
                    trip_date = fix_time.date()

                    # trip_number = max existing trip_number for this
                    # device+date + 1, or 1 if none exist yet today.
                    max_trip_number = (
                        db.query(Trip)
                        .filter(
                            Trip.device_id == device.id,
                            Trip.trip_date == trip_date,
                        )
                        .order_by(Trip.trip_number.desc())
                        .first()
                    )
                    trip_number = (max_trip_number.trip_number + 1) if max_trip_number else 1

                    trip = Trip(
                        device_id=device.id,
                        geofence_id=geofence.id,
                        trip_date=trip_date,
                        trip_number=trip_number,
                        status="in_progress",
                        start_time=fix_time,
                        start_lat=position_lat,
                        start_lon=position_lon,
                    )
                    try:
                        db.add(trip)
                        db.commit()
                        _raise_trip_driver_pending_alert(db, device, trip)
                        _raise_trip_route_pending_alert(db, device, trip)
                        db.commit()
                    except IntegrityError:
                        db.rollback()
                        already_open = (
                            db.query(Trip)
                            .filter(
                                Trip.device_id == device.id,
                                Trip.status == "in_progress",
                            )
                            .first()
                        )
                        logger.warning(
                            "Caught duplicate-open-trip race for "
                            "device_id=%s (reused trip_id=%s)",
                            device.id,
                            already_open.id if already_open is not None else None,
                        )

            # 9. Device just RE-ENTERED the geofence → close the open trip.
            elif was_inside is False and is_inside:
                open_trip = (
                    db.query(Trip)
                    .filter(
                        Trip.device_id == device.id,
                        Trip.status == "in_progress",
                    )
                    .order_by(Trip.start_time.desc())
                    .first()
                )

                # Edge case: device was already inside when the app
                # started, so this is its first "enter" without a prior
                # tracked "exit" — no open trip to close, just continue.
                if open_trip is not None:
                    _close_trip(db, open_trip, device, fix_time, position_lat, position_lon)

            # 10. Always update the in-memory state for this device.
            _inside_geofence[device.id] = is_inside
    finally:
        db.close()


def get_trips_in_range(db, device_id: int, start_dt: datetime, end_dt: datetime) -> list[Trip]:
    """All trips for a device whose time window overlaps [start_dt, end_dt).

    This is time-based (start_time/end_time), NOT based on the trip's
    fixed `trip_date` — that distinction matters. `trip_date` is set
    once, when the trip opens, and never changes. A trip that opened
    late on day 1 and is still open on day 2 keeps `trip_date == day 1`
    forever, so filtering on `trip_date` alone makes an ongoing trip
    disappear from every day's report after the one it started on, even
    though it's still actively happening.

    A trip overlaps the range if:
    - it started before the range ends (start_time < end_dt), AND
    - it's either still open (end_time IS NULL — an open trip is
      "ongoing" and always overlaps forward, including into "now"), OR
      it's completed and ended at/after the range starts (end_time >=
      start_dt).

    Used by both the /api/trips endpoint and the vehicle-report
    endpoint so single-day and start/end-range queries share one
    implementation and one fix.
    """
    return (
        db.query(Trip)
        .filter(
            Trip.device_id == device_id,
            Trip.start_time < end_dt,
            or_(Trip.end_time.is_(None), Trip.end_time >= start_dt),
        )
        .order_by(Trip.start_time.asc())
        .all()
    )


def get_trips_in_range_fleet_wide(
    db,
    start_dt: datetime | None = None,
    end_dt: datetime | None = None,
    status: str | None = None,
    driver_id: int | None = None,
    device_id: int | None = None,
    manager_id: int | None = None,
    geofence_id: int | None = None,
    admin_id: int | None = None,
) -> list[Trip]:
    """All trips across the fleet whose time window overlaps [start_dt, end_dt).
    Pass start_dt=end_dt=None to skip the time window and return every trip.

    Same overlap logic as get_trips_in_range (time-based on start_time/
    end_time, NOT the fixed trip_date — see that function for why), but
    not scoped to a single device unless `device_id` is passed.

    Optional SQL filters:
    - `status` matches Trip.status directly (`in_progress` / `completed`).
    - `geofence_id` matches Trip.geofence_id directly (the area the trip
      exited from).
    - `device_id` scopes to one vehicle, same as get_trips_in_range.
    - `manager_id` resolves to that manager's assigned users, then to
      those users' vehicles, then filters Trip.device_id to that set.
      Returns [] immediately if the manager has no assigned users (or
      those users own no vehicles) — never runs an empty IN (...).

    `driver_id` is accepted so the call site can pass every filter
    through in one go, but it is intentionally NOT applied here.
    Driver assignment lives on DriverAssignment (time-ranged), not as
    a column on Trip, so it can only be resolved per-trip via
    driver_service.get_driver_for_trip AFTER this query. Do not
    "optimize" it into the SQL — that would silently return wrong
    results (trips whose vehicle currently has that driver, rather
    than trips that HAD that driver at start_time).

    Ordered by start_time DESC (newest first). This differs from
    get_trips_in_range's ascending order on purpose: that function
    feeds a single-device view that then renumbers trip_number 1..N
    across the range; this one is fleet-wide and keeps each trip's
    real per-device trip_number, so newest-first is the useful default.
    """
    # driver_id is unused here on purpose — see docstring. Referenced
    # so the signature stays in lockstep with list_all_trips' filters.
    _ = driver_id

    query = db.query(Trip)
    if start_dt is not None and end_dt is not None:
        query = query.filter(
            Trip.start_time < end_dt,
            or_(Trip.end_time.is_(None), Trip.end_time >= start_dt),
        )

    if status is not None:
        query = query.filter(Trip.status == status)

    if geofence_id is not None:
        query = query.filter(Trip.geofence_id == geofence_id)

    if manager_id is not None:
        assigned_users = manager_service.get_assigned_users(db, manager_id)
        if not assigned_users:
            return []
        user_ids = [u.id for u in assigned_users]
        manager_devices = (
            db.query(Device).filter(Device.user_id.in_(user_ids)).all()
        )
        manager_device_ids = [d.id for d in manager_devices]
        if not manager_device_ids:
            return []
        if device_id is not None:
            # Both filters: the requested vehicle must belong to this
            # manager, otherwise there's nothing to return.
            if device_id not in manager_device_ids:
                return []
            query = query.filter(Trip.device_id == device_id)
        else:
            query = query.filter(Trip.device_id.in_(manager_device_ids))
    elif device_id is not None:
        query = query.filter(Trip.device_id == device_id)

    if admin_id is not None:
        fleet_device_ids = [
            row[0] for row in db.query(Device.id).filter(Device.admin_id == admin_id).all()
        ]
        if not fleet_device_ids:
            return []
        query = query.filter(Trip.device_id.in_(fleet_device_ids))

    return query.order_by(Trip.start_time.desc()).all()


def calculate_trip_metrics(db, trip: Trip, device: Device):
    """Calculate distance, duration, idle time, fuel consumption, cost,
    and driving-behavior metrics for a trip based on its start_time and
    end_time. Sets the computed fields on the trip object but does NOT
    commit — the caller decides whether to commit.

    Handles both completed trips (end_time is set) and in-progress trips
    (end_time is None). For in-progress trips, the latest DevicePosition's
    fix_time is used as the effective end time so metrics always reflect
    the trip's progress so far. The trip's end_time/end_lat/end_lon fields
    are NOT modified for in-progress trips — only the computed metric
    fields (distance_km, duration_min, fuel fields, etc.) are updated.

    Used by both _close_trip (when a trip completes) and the list_trips /
    vehicle-report endpoints (to recalculate on fetch, ensuring trips
    always reflect the current calculation method and the latest
    DevicePosition data).

    All fuel/cost fields follow the None-safety convention used in
    report.py — a None input never silently becomes 0; it propagates
    as None so downstream consumers know the value is unknown.
    """
    # 1. Determine the effective end time — for completed trips this is
    #    trip.end_time; for in-progress trips (end_time is None) we use
    #    the latest DevicePosition's fix_time so metrics reflect the
    #    trip's progress so far.
    if trip.end_time is not None:
        effective_end_time = trip.end_time
    else:
        latest_position = (
            db.query(DevicePosition)
            .filter(
                DevicePosition.device_id == device.id,
                DevicePosition.fix_time >= trip.start_time,
            )
            .order_by(DevicePosition.fix_time.desc())
            .first()
        )
        if latest_position is not None:
            effective_end_time = latest_position.fix_time
        else:
            effective_end_time = trip.start_time

    # 2. All DevicePosition rows during the trip, ordered by fix_time.
    # Only columns used below — raw month-long open trips otherwise pull
    # address / altitude / full ORM weight for every ping.
    trip_positions = (
        db.query(DevicePosition)
        .options(
            load_only(
                DevicePosition.id,
                DevicePosition.device_id,
                DevicePosition.fix_time,
                DevicePosition.total_distance,
                DevicePosition.speed_kmh,
                DevicePosition.motion_status,
                DevicePosition.raw_attributes,
            )
        )
        .filter(
            DevicePosition.device_id == device.id,
            DevicePosition.fix_time >= trip.start_time,
            DevicePosition.fix_time <= effective_end_time,
        )
        .order_by(DevicePosition.fix_time.asc())
        .all()
    )

    # 3. distance_km — the device's own odometer (`total_distance`),
    #    first vs last reading across the trip's positions. Not a
    #    Haversine sum of GPS points: the odometer is device-accurate,
    #    point-to-point GPS distance drifts with fix frequency/noise.
    if len(trip_positions) < 2:
        distance_km = 0.0
    else:
        first_total = trip_positions[0].total_distance
        last_total = trip_positions[-1].total_distance
        if first_total is not None and last_total is not None:
            distance_km = round(max((last_total - first_total) / 1000.0, 0.0), 2)
        else:
            distance_km = 0.0

    # 4. duration_min — uses effective_end_time, which is trip.end_time
    #    for completed trips or the latest position's fix_time for
    #    in-progress trips.
    duration_min = (effective_end_time - trip.start_time).total_seconds() / 60

    # 5. idle_seconds — time spent in "idle" state = time until the next
    #    reading (mirrors the convention in report.py).
    if len(trip_positions) < 2:
        idle_seconds = 0
    else:
        idle_seconds = 0
        for i in range(len(trip_positions) - 1):
            row_a = trip_positions[i]
            row_b = trip_positions[i + 1]
            if row_a.motion_status == "idle":
                idle_seconds += (row_b.fix_time - row_a.fix_time).total_seconds()

    # 5b. Driving-behavior metrics for this trip — same method report.py
    #     uses for a full day (max speed, harsh brake/accel via speed
    #     delta or alarm attribute, overspeed count), plus idle_count:
    #     the number of separate times the vehicle went idle/stopped
    #     during THIS trip (distinct from harsh braking — this is "how
    #     many times did it pause", not "how hard did it brake").
    #
    #     Uses this device's own speed_limit_kmh / harsh_brake_delta_kmh /
    #     harsh_accel_delta_kmh when set, falling back to the fleet-wide
    #     defaults otherwise — same convention as report.py.
    overspeed_threshold_kmh = (
        device.speed_limit_kmh if device.speed_limit_kmh is not None else OVERSPEED_THRESHOLD_KMH
    )
    harsh_brake_delta_kmh = (
        device.harsh_brake_delta_kmh if device.harsh_brake_delta_kmh is not None else HARSH_BRAKE_DELTA_KMH
    )
    harsh_accel_delta_kmh = (
        device.harsh_accel_delta_kmh if device.harsh_accel_delta_kmh is not None else HARSH_ACCEL_DELTA_KMH
    )

    if len(trip_positions) == 0:
        max_speed_kmh = 0.0
        harsh_brake_count = 0
        harsh_accel_count = 0
        overspeed_count = 0
        idle_count = 0
    else:
        max_speed_kmh = max((p.speed_kmh or 0 for p in trip_positions), default=0.0)

        harsh_brake_count = 0
        harsh_accel_count = 0
        for i in range(len(trip_positions) - 1):
            current = trip_positions[i]
            next_pos = trip_positions[i + 1]
            attrs = current.raw_attributes or {}
            alarm = attrs.get("alarm", "")
            speed_delta = (next_pos.speed_kmh or 0) - (current.speed_kmh or 0)

            if alarm == "hardBraking" or speed_delta < -harsh_brake_delta_kmh:
                harsh_brake_count += 1
            if alarm == "hardAcceleration" or speed_delta > harsh_accel_delta_kmh:
                harsh_accel_count += 1

        overspeed_count = sum(
            1 for p in trip_positions if p.speed_kmh and p.speed_kmh > overspeed_threshold_kmh
        )

        idle_count = 0
        previous_status = None
        for p in trip_positions:
            if p.motion_status in ("idle", "stopped") and previous_status not in ("idle", "stopped"):
                idle_count += 1
            previous_status = p.motion_status

    # 6. Fuel averages from the Device row (already loaded).
    fuel_avg_running = device.fuel_avg_running
    fuel_avg_idle = device.fuel_avg_idle

    # 7. driving_fuel_liters — None if no running average configured.
    if fuel_avg_running is not None and fuel_avg_running > 0:
        driving_fuel_liters = round(distance_km / fuel_avg_running, 2)
    else:
        driving_fuel_liters = None

    # 8. idle_fuel_liters — None if no idle average configured.
    if fuel_avg_idle is not None:
        idle_fuel_liters = round((idle_seconds / 3600) * fuel_avg_idle, 2)
    else:
        idle_fuel_liters = None

    # 9. total_fuel_liters — consistent with report.py: treat idle as 0
    #    when the idle average isn't configured (instead of forcing the
    #    whole total to None). Only requires driving fuel to be known.
    if driving_fuel_liters is not None:
        idle_for_total = idle_fuel_liters if idle_fuel_liters is not None else 0
        total_fuel_liters = round(driving_fuel_liters + idle_for_total, 2)
    else:
        total_fuel_liters = None

    # 10. price_per_liter_used — None if device has no fuel type.
    if device.fuel_type_id is not None:
        price_per_liter_used = get_applicable_fuel_price(
            db, device.fuel_type_id, trip.trip_date, admin_id=device.admin_id
        )
    else:
        price_per_liter_used = None

    # 11. fuel_cost_pkr — only if BOTH total fuel and price are known.
    if total_fuel_liters is not None and price_per_liter_used is not None:
        fuel_cost_pkr = round(total_fuel_liters * price_per_liter_used, 2)
    else:
        fuel_cost_pkr = None

    # 12. Set all computed fields on the trip object (caller commits).
    #     NOTE: end_time/end_lat/end_lon are NOT set here for in-progress
    #     trips — they stay None until _close_trip sets them.
    trip.distance_km = distance_km
    trip.duration_min = duration_min
    trip.driving_fuel_liters = driving_fuel_liters
    trip.idle_fuel_liters = idle_fuel_liters
    trip.total_fuel_liters = total_fuel_liters
    trip.price_per_liter_used = price_per_liter_used
    trip.fuel_cost_pkr = fuel_cost_pkr
    trip.max_speed_kmh = round(max_speed_kmh, 2)
    trip.harsh_brake_count = harsh_brake_count
    trip.harsh_accel_count = harsh_accel_count
    trip.overspeed_count = overspeed_count
    trip.idle_count = idle_count


def _close_trip(db, trip: Trip, device: Device, end_time: datetime, end_lat: float, end_lon: float):
    """Close an in-progress trip: set end fields, compute metrics, commit."""
    trip.end_time = end_time
    trip.end_lat = end_lat
    trip.end_lon = end_lon
    trip.status = "completed"
    # Pull any history the live poller missed (downtime / buffered dumps)
    # BEFORE metrics and route matching, so both see the full trail.
    try:
        backfill_positions_from_traccar(db, device, trip.start_time, end_time)
    except Exception:
        logger.exception("Position backfill failed for trip_id=%s", trip.id)
    calculate_trip_metrics(db, trip, device)
    try:
        driver_service.release_trip_driver_borrow(db, trip, at_time=end_time)
    except Exception:
        logger.exception("Driver borrow release failed for trip_id=%s", trip.id)
    db.commit()
    try:
        route_matcher.match_trip_to_routes(db, trip)
    except Exception:
        db.rollback()
        logger.exception("Route matching failed for trip_id=%s", trip.id)


POSITION_GAP_REPAIR_LOOKBACK_DAYS = 90
# Historical repair uses a looser hole than live polling (10 min). A 10 min
# parked stretch would otherwise hit Traccar for almost every overnight trip.
POSITION_GAP_REPAIR_THRESHOLD = timedelta(minutes=30)


def _trip_positions_have_gap(positions: list, start_time: datetime, end_time: datetime) -> bool:
    """True if this trip window is missing a stretch of stored GPS."""
    return positions_have_gap(positions, start_time, end_time, POSITION_GAP_REPAIR_THRESHOLD)


def backfill_gapped_trip_positions(db=None) -> dict:
    """Fill Traccar history into device_positions for trips with GPS holes.

    Complements backfill_missed_trips, which only replays geofence
    enter/exit against *already stored* rows and cannot invent a trail
    the poller never wrote. After inserting, metrics and route matches
    are recomputed so the Routes page indexes the full path.

    Idempotent: a trip whose positions are already dense is skipped;
    backfill_positions_from_traccar itself skips existing fix_times.
    """
    owns_session = db is None
    if owns_session:
        db = SessionLocal()

    repaired = 0
    inserted_total = 0
    cutoff = datetime.utcnow() - timedelta(days=POSITION_GAP_REPAIR_LOOKBACK_DAYS)
    try:
        trips = (
            db.query(Trip)
            .filter(Trip.start_time >= cutoff)
            .order_by(Trip.start_time.asc())
            .all()
        )
        devices_by_id = {}
        for trip in trips:
            end_time = trip.end_time or datetime.utcnow()
            positions = (
                db.query(DevicePosition)
                .filter(
                    DevicePosition.device_id == trip.device_id,
                    DevicePosition.fix_time >= trip.start_time,
                    DevicePosition.fix_time <= end_time,
                )
                .order_by(DevicePosition.fix_time.asc())
                .all()
            )
            if not _trip_positions_have_gap(positions, trip.start_time, end_time):
                continue

            logger.info(
                "Repairing gapped trip_id=%s device_id=%s (%s .. %s, %s stored points)",
                trip.id, trip.device_id, trip.start_time, end_time, len(positions),
            )

            device = devices_by_id.get(trip.device_id)
            if device is None:
                device = db.query(Device).filter(Device.id == trip.device_id).first()
                devices_by_id[trip.device_id] = device
            if device is None:
                continue

            try:
                inserted = backfill_positions_from_traccar(
                    db, device, trip.start_time, end_time,
                )
            except Exception:
                logger.exception(
                    "Position backfill failed for existing trip_id=%s", trip.id
                )
                continue

            if not inserted:
                continue

            inserted_total += inserted
            calculate_trip_metrics(db, trip, device)
            db.commit()
            if trip.status == "completed" and trip.end_time is not None:
                try:
                    route_matcher.match_trip_to_routes(db, trip)
                except Exception:
                    db.rollback()
                    logger.exception(
                        "Route matching failed after position backfill for trip_id=%s",
                        trip.id,
                    )
            repaired += 1
            logger.info(
                "Repaired gapped trip_id=%s with %s new positions",
                trip.id, inserted,
            )
        return {"repaired_trips": repaired, "inserted_positions": inserted_total}
    finally:
        if owns_session:
            db.close()


def backfill_missed_trips(db=None):
    """One-off reconciliation over each device's full position history.

    Live trip detection (process_trip_detection) only reacts to
    exit/enter transitions WHILE the poll loop is running. That leaves
    two gaps:

      1. A trip that started and ended entirely while this backend
         wasn't running (or before it had ever run) never gets a Trip
         row at all — there was no live poll watching either edge.
      2. A trip left "in_progress" across a restart, whose matching
         "enter" event is only visible in position rows that were
         already saved by the time this process started — the
         self-heal in process_trip_detection only catches the device
         being inside the geofence RIGHT NOW at first observation, not
         an enter/exit pair that fully happened in the past while
         nothing was watching.

    This walks each device's DevicePosition history in fix_time order,
    replays the same geofence in/out logic used live, and creates or
    closes Trip rows for any transition not already reflected in the
    trips table. New trips are matched against existing ones by
    (device_id, start_time) — start_time is set from the exact fix_time
    an exit was detected at, so this reliably avoids creating a
    duplicate for a trip the live tracker already recorded correctly.

    Meant to run once at startup, before the live poll loop starts, so
    it fixes anything already broken/missing as of the last time this
    code ran — but it's idempotent (thanks to the start_time dedupe)
    and safe to call again at any time, e.g. from an admin endpoint.
    """
    owns_session = db is None
    if owns_session:
        db = SessionLocal()
    try:
        devices = (
            db.query(Device).filter(Device.primary_geofence_id.isnot(None)).all()
        )
        for device in devices:
            _backfill_device_trips(db, device)
    finally:
        if owns_session:
            db.close()


def _backfill_device_trips(db, device: Device):
    """Reconciles Trip rows for a single device against its full
    DevicePosition history. See backfill_missed_trips for the overall
    approach.
    """
    geofence = (
        db.query(Geofence).filter(Geofence.id == device.primary_geofence_id).first()
    )
    if geofence is None:
        return
    if geofence.admin_id != device.admin_id:
        return

    positions = (
        db.query(DevicePosition)
        .filter(DevicePosition.device_id == device.id)
        .order_by(DevicePosition.fix_time.asc())
        .all()
    )
    if not positions:
        return

    existing_trips = (
        db.query(Trip)
        .filter(Trip.device_id == device.id)
        .order_by(Trip.start_time.asc())
        .all()
    )
    existing_by_start = {t.start_time: t for t in existing_trips}

    # Seed the next trip_number to hand out per calendar date from
    # what's already in the DB, so any newly-created trips continue the
    # existing per-day numbering instead of colliding with it (this
    # mirrors the max-trip_number-for-the-date query in
    # process_trip_detection, just computed once up front here since
    # we're about to walk a potentially large batch of positions).
    next_trip_number_by_date: dict = {}
    for t in existing_trips:
        next_trip_number_by_date[t.trip_date] = max(
            next_trip_number_by_date.get(t.trip_date, 0), t.trip_number
        )

    was_inside = None
    current_open_trip = None
    made_changes = False

    for p in positions:
        distance = haversine_meters(geofence.center_lat, geofence.center_lon, p.lat, p.lon)
        is_inside = distance <= geofence.radius_meters

        # First position ever seen for this device — just establishes a
        # starting state, same convention as the live tracker.
        if was_inside is None:
            was_inside = is_inside
            continue

        # EXIT — open a trip, reusing one that already exists at this
        # exact start_time instead of creating a duplicate.
        if was_inside is True and not is_inside:
            existing = existing_by_start.get(p.fix_time)
            if existing is not None:
                current_open_trip = existing
            else:
                # Live detection (process_trip_detection) uses RAW
                # Traccar positions; this backfill only sees rows that
                # made it into device_positions. The live exit timestamp
                # is often never persisted, so the exact start_time
                # lookup above misses the already-open trip and would
                # insert a second in_progress row for the same physical
                # trip. Reuse any in_progress row for this device
                # regardless of start_time, and do not rewrite that
                # start_time — the earlier value is the real exit.
                open_trip = (
                    db.query(Trip)
                    .filter(
                        Trip.device_id == device.id,
                        Trip.status == "in_progress",
                    )
                    .order_by(Trip.start_time.asc())
                    .first()
                )
                if open_trip is not None:
                    current_open_trip = open_trip
                else:
                    trip_date = p.fix_time.date()
                    next_number = next_trip_number_by_date.get(trip_date, 0) + 1
                    next_trip_number_by_date[trip_date] = next_number
                    new_trip = Trip(
                        device_id=device.id,
                        geofence_id=geofence.id,
                        trip_date=trip_date,
                        trip_number=next_number,
                        status="in_progress",
                        start_time=p.fix_time,
                        start_lat=p.lat,
                        start_lon=p.lon,
                    )
                    try:
                        # Savepoint so IntegrityError rolls back only
                        # this insert. A full session rollback here
                        # would also drop earlier flushed trip rows
                        # from the same device walk.
                        with db.begin_nested():
                            db.add(new_trip)
                            db.flush()  # get new_trip.id, and make it visible to later lookups this pass
                        existing_by_start[p.fix_time] = new_trip
                        current_open_trip = new_trip
                        made_changes = True
                        _raise_trip_driver_pending_alert(db, device, new_trip)
                        _raise_trip_route_pending_alert(db, device, new_trip)
                    except IntegrityError:
                        raced_open = (
                            db.query(Trip)
                            .filter(
                                Trip.device_id == device.id,
                                Trip.status == "in_progress",
                            )
                            .order_by(Trip.start_time.asc())
                            .first()
                        )
                        current_open_trip = raced_open
                        logger.warning(
                            "Caught duplicate-open-trip race during "
                            "backfill for device_id=%s (reused trip_id=%s)",
                            device.id,
                            raced_open.id if raced_open is not None else None,
                        )

        # ENTER — close whatever trip is currently tracked as open, if
        # it isn't closed already (an existing completed trip found
        # above just means the live tracker already handled this pair
        # correctly — nothing to do).
        elif was_inside is False and is_inside:
            if current_open_trip is not None and current_open_trip.status == "in_progress":
                _close_trip(db, current_open_trip, device, p.fix_time, p.lat, p.lon)
                made_changes = True
            current_open_trip = None

        was_inside = is_inside

    if made_changes:
        db.commit()
    else:
        db.rollback()