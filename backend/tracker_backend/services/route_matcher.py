from __future__ import annotations

import logging
import math
from dataclasses import dataclass
from datetime import datetime, timedelta

from sqlalchemy import or_
from sqlalchemy.orm import Session

from tracker_backend.models import Device, DevicePosition, Route, RouteVehicle, Trip, TripRouteMatch
from tracker_backend.services import alert_monitor
from tracker_backend.services.position_writer import haversine_meters

logger = logging.getLogger("route_matcher")

ROUTE_MATCH_THRESHOLD_PERCENT = 60.0
# When multiple candidate slices clear ROUTE_MATCH_THRESHOLD_PERCENT, prefer
# the one covering more of the trip — but only if its match_percent is
# within this margin of the single best-scoring candidate. Protects against
# picking a longer slice whose quality is meaningfully worse just because
# it's longer; a trip that's genuinely 95% on-route for a short stretch and
# unrelated for the rest should NOT be reported as "matched" for the whole
# thing just to maximize coverage.
LENGTH_PREFERENCE_MARGIN_PERCENT = 8.0

_EARTH_RADIUS_M = 6371000.0


@dataclass
class RouteSliceMatch:
    start_index: int
    end_index: int
    match_percent: float
    deviation_segments: list[dict]


def _to_local_meters(
    lat: float,
    lon: float,
    ref_lat: float,
    ref_lon: float,
) -> tuple[float, float]:
    """Equirectangular projection of (lat, lon) relative to a reference point.

    Returns (east_meters, north_meters). Accurate enough for corridor checks
    over typical route-segment lengths when the reference is the GPS point.
    """
    ref_lat_r = math.radians(ref_lat)
    x = _EARTH_RADIUS_M * math.radians(lon - ref_lon) * math.cos(ref_lat_r)
    y = _EARTH_RADIUS_M * math.radians(lat - ref_lat)
    return x, y


def _point_to_segment_meters(
    px: float,
    py: float,
    ax: float,
    ay: float,
    bx: float,
    by: float,
) -> float:
    """Perpendicular (clamped) distance from point P to segment AB in local meters."""
    dx = bx - ax
    dy = by - ay
    if dx == 0.0 and dy == 0.0:
        return math.hypot(px - ax, py - ay)
    t = ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)
    t = max(0.0, min(1.0, t))
    return math.hypot(px - (ax + t * dx), py - (ay + t * dy))


def _route_segment_distance_meters(point: DevicePosition, route_path: list[dict]) -> float:
    """Minimum distance from a GPS point to the route polyline (meters).

    Uses point-to-segment distance for every consecutive vertex pair so a
    fix sitting mid-span on a long straight road is treated as on-route.
    Falls back to point-to-vertex (or inf) when the path has fewer than 2
    vertices.
    """
    if not route_path:
        return float("inf")
    if len(route_path) < 2:
        vertex = route_path[0]
        return haversine_meters(point.lat, point.lon, vertex["lat"], vertex["lon"])

    ref_lat, ref_lon = point.lat, point.lon
    px, py = 0.0, 0.0
    min_dist = float("inf")
    for i in range(len(route_path) - 1):
        a = route_path[i]
        b = route_path[i + 1]
        ax, ay = _to_local_meters(a["lat"], a["lon"], ref_lat, ref_lon)
        bx, by = _to_local_meters(b["lat"], b["lon"], ref_lat, ref_lon)
        dist = _point_to_segment_meters(px, py, ax, ay, bx, by)
        if dist < min_dist:
            min_dist = dist
    return min_dist


def _segment_bboxes(route_path: list[dict]) -> list[tuple[float, float, float, float]]:
    """Axis-aligned lat/lon boxes for each consecutive vertex pair."""
    boxes: list[tuple[float, float, float, float]] = []
    for i in range(len(route_path) - 1):
        a = route_path[i]
        b = route_path[i + 1]
        boxes.append((
            min(a["lat"], b["lat"]),
            max(a["lat"], b["lat"]),
            min(a["lon"], b["lon"]),
            max(a["lon"], b["lon"]),
        ))
    return boxes


def _meters_to_degree_pads(lat: float, meters: float) -> tuple[float, float]:
    """Approximate meter→degree pads at ``lat`` (lat pad, lon pad)."""
    lat_pad = meters / 111_320.0
    cos_lat = math.cos(math.radians(lat))
    # Guard polar / near-zero cos so lon pad stays finite.
    lon_pad = meters / (111_320.0 * max(0.05, abs(cos_lat)))
    return lat_pad, lon_pad


def _point_within_flags(
    trip_positions: list[DevicePosition],
    route: Route,
) -> list[bool]:
    """Per-point corridor membership for the full trip, using route.tolerance_meters.

    ORS road paths often have 1k–2k vertices. A naive P×S scan is multi-second
    on long trips; bbox culling + early-exit keeps the same boolean result
    while only testing nearby segments.
    """
    route_path = route.path or []
    if not route_path:
        return [False] * len(trip_positions)
    if len(route_path) < 2:
        vertex = route_path[0]
        tol = route.tolerance_meters
        return [
            haversine_meters(p.lat, p.lon, vertex["lat"], vertex["lon"]) <= tol
            for p in trip_positions
        ]

    tolerance = float(route.tolerance_meters)
    boxes = _segment_bboxes(route_path)
    flags: list[bool] = []

    for position in trip_positions:
        lat_pad, lon_pad = _meters_to_degree_pads(position.lat, tolerance)
        min_lat = position.lat - lat_pad
        max_lat = position.lat + lat_pad
        min_lon = position.lon - lon_pad
        max_lon = position.lon + lon_pad

        within = False
        ref_lat, ref_lon = position.lat, position.lon
        for i, (seg_min_lat, seg_max_lat, seg_min_lon, seg_max_lon) in enumerate(boxes):
            if (
                seg_max_lat < min_lat
                or seg_min_lat > max_lat
                or seg_max_lon < min_lon
                or seg_min_lon > max_lon
            ):
                continue
            a = route_path[i]
            b = route_path[i + 1]
            ax, ay = _to_local_meters(a["lat"], a["lon"], ref_lat, ref_lon)
            bx, by = _to_local_meters(b["lat"], b["lon"], ref_lat, ref_lon)
            if _point_to_segment_meters(0.0, 0.0, ax, ay, bx, by) <= tolerance:
                within = True
                break
        flags.append(within)

    return flags


def _build_deviation_segments(flags: list[bool], offset: int) -> list[dict]:
    segments: list[dict] = []
    start = None
    for idx, within_tolerance in enumerate(flags):
        if not within_tolerance and start is None:
            start = idx
        elif within_tolerance and start is not None:
            segments.append({
                "start_index": offset + start,
                "end_index": offset + idx - 1,
            })
            start = None
    if start is not None:
        segments.append({
            "start_index": offset + start,
            "end_index": offset + len(flags) - 1,
        })
    return segments


def _build_route_status_segments(flags: list[bool]) -> list[dict]:
    """Contiguous on_route true/false runs across the full flag list (offset 0)."""
    if not flags:
        return []
    segments: list[dict] = []
    start = 0
    current = flags[0]
    for idx in range(1, len(flags)):
        if flags[idx] != current:
            segments.append({
                "start_index": start,
                "end_index": idx - 1,
                "on_route": current,
            })
            start = idx
            current = flags[idx]
    segments.append({
        "start_index": start,
        "end_index": len(flags) - 1,
        "on_route": current,
    })
    return segments


def classify_trip_route_status(
    trip_positions: list[DevicePosition],
    route: Route,
) -> list[dict]:
    """Full-trip per-point corridor classification for map rendering.

    Independent of the winning matched-leg window. Does not affect
    match_percent, deviation_segments, or alerts.
    """
    return _build_route_status_segments(_point_within_flags(trip_positions, route))


def _select_best_slice_from_candidates(
    candidates: list[tuple[int, int, float]],
) -> tuple[int, int, float] | None:
    """Apply best_score / close_enough / longest-span selection.

    ``candidates`` are ``(start_index, end_index, match_percent)`` tuples that
    already cleared ``ROUTE_MATCH_THRESHOLD_PERCENT``.
    """
    if not candidates:
        return None

    best_score = max(c[2] for c in candidates)
    # Among candidates whose quality is close enough to the best score,
    # prefer the one covering the most of the trip (longest span) —
    # avoids silently truncating a tail that was still genuinely
    # on-route just because a shorter slice scored a bit higher.
    close_enough = [
        c for c in candidates
        if best_score - c[2] <= LENGTH_PREFERENCE_MARGIN_PERCENT
    ]
    best = max(close_enough, key=lambda c: c[1] - c[0])
    if best[2] < ROUTE_MATCH_THRESHOLD_PERCENT:
        return None
    return best


def _scan_route_slice_candidates(
    trip_positions: list[DevicePosition],
    route: Route,
) -> RouteSliceMatch | None:
    """Find the best contiguous trip sub-range that clears the match threshold.

    Pre-computes per-point corridor membership, then scans all windows —
    brief off-route blips inside an otherwise on-route stretch are tolerated
    naturally because they only dent the window ratio rather than breaking
    a fixed heuristic boundary.

    Window within-counts use a prefix-sum array (O(n) build, O(1) query)
    so the exhaustive O(n²) window scan does not re-sum each window from
    scratch.

    Deviation segments are built only for the single winning window after
    best_score / close_enough / longest-span selection — not for every
    threshold-clearing candidate (which would reintroduce near-O(n³) cost
    on mostly on-route trips).
    """
    if len(trip_positions) < 2:
        return None

    within_flags = _point_within_flags(trip_positions, route)

    # prefix[i] = number of True flags in within_flags[0:i]
    prefix = [0] * (len(within_flags) + 1)
    for i, flag in enumerate(within_flags):
        prefix[i + 1] = prefix[i] + (1 if flag else 0)

    # Phase 1: cheap scan — track lightweight (start, end, match_percent) only.
    candidates: list[tuple[int, int, float]] = []
    last_index = len(trip_positions) - 1

    for start_index in range(last_index):
        for end_index in range(start_index + 1, len(trip_positions)):
            window_len = end_index - start_index + 1
            within_count = prefix[end_index + 1] - prefix[start_index]
            match_percent = round((within_count / window_len) * 100, 2)
            if match_percent < ROUTE_MATCH_THRESHOLD_PERCENT:
                continue
            candidates.append((start_index, end_index, match_percent))

    # Phase 2: select the winner, then build deviation_segments once.
    best = _select_best_slice_from_candidates(candidates)
    if best is None:
        return None

    start_index, end_index, match_percent = best
    window_flags = within_flags[start_index:end_index + 1]
    return RouteSliceMatch(
        start_index=start_index,
        end_index=end_index,
        match_percent=match_percent,
        deviation_segments=_build_deviation_segments(window_flags, start_index),
    )


def _route_for_matching(db: Session, trip: Trip) -> Route | None:
    """Confirmed route wins; otherwise the assignment covering trip start."""
    confirmed_id = getattr(trip, "confirmed_route_id", None)
    if confirmed_id is not None:
        return db.query(Route).filter(Route.id == confirmed_id).first()

    assignment = (
        db.query(RouteVehicle)
        .filter(
            RouteVehicle.device_id == trip.device_id,
            RouteVehicle.start_time <= trip.start_time,
            or_(RouteVehicle.end_time.is_(None), RouteVehicle.end_time > trip.start_time),
        )
        .order_by(RouteVehicle.start_time.desc())
        .first()
    )
    if assignment is None:
        return None
    return db.query(Route).filter(Route.id == assignment.route_id).first()


def match_trip_to_routes(db: Session, trip: Trip) -> None:
    if trip.status != "completed" or trip.end_time is None:
        return

    trip_positions = (
        db.query(DevicePosition)
        .filter(
            DevicePosition.device_id == trip.device_id,
            DevicePosition.fix_time >= trip.start_time,
            DevicePosition.fix_time <= trip.end_time,
        )
        .order_by(DevicePosition.fix_time.asc())
        .all()
    )
    if len(trip_positions) < 2:
        return

    route = _route_for_matching(db, trip)
    if route is None:
        db.query(TripRouteMatch).filter(TripRouteMatch.trip_id == trip.id).delete()
        alert_monitor._resolve_alert(db, trip.device_id, "route_deviation")
        db.commit()
        return

    device = db.query(Device).filter(Device.id == trip.device_id).first()

    db.query(TripRouteMatch).filter(TripRouteMatch.trip_id == trip.id).delete()

    best_match = _scan_route_slice_candidates(trip_positions, route)
    if best_match is not None:
        db.add(TripRouteMatch(
            trip_id=trip.id,
            route_id=route.id,
            match_percent=best_match.match_percent,
            deviation_segments=best_match.deviation_segments,
            leg_start_index=best_match.start_index,
            leg_end_index=best_match.end_index,
        ))

    if best_match is not None and best_match.deviation_segments and device is not None:
        alert_monitor._raise_alert(
            db,
            trip.device_id,
            "route_deviation",
            "warning",
            f"'{device.name}' deviated from route '{route.name}'.",
        )
    else:
        alert_monitor._resolve_alert(db, trip.device_id, "route_deviation")

    db.commit()


def backfill_route_matches(
    db: Session,
    route: Route,
    device_ids: list[int] | None = None,
    lookback_days: int | None = 90,
    seen_trip_ids: set[int] | None = None,
) -> dict:
    """Retroactively matches already-completed trips against a route.

    Called right after a route is created, or right after one or more
    vehicles are newly assigned to an existing route, so historical
    trips that predate the route/assignment aren't permanently invisible
    to the matching system.

    `lookback_days` limits how far back to search (default: 90 days).
    Pass ``None`` to cover all historical completed trips with no cutoff.

    `seen_trip_ids`, when provided, skips any trip already present in the
    set and records each newly processed trip id. This matters because
    ``match_trip_to_routes`` rematches a trip against its confirmed
    route (or the assignment covering trip start), so a full-system
    recompute that walks routes one-by-one would otherwise re-match
    the same trip once per overlapping historical assignment.

    Returns ``{"trips_attempted": int, "failures": int}``.
    """
    if device_ids is None:
        device_ids = [
            assignment.device_id
            for assignment in db.query(RouteVehicle).filter(RouteVehicle.route_id == route.id).all()
        ]
    if not device_ids:
        return {"trips_attempted": 0, "failures": 0}

    trip_query = (
        db.query(Trip)
        .filter(
            Trip.device_id.in_(device_ids),
            Trip.status == "completed",
        )
    )
    if lookback_days is not None:
        cutoff = datetime.utcnow() - timedelta(days=lookback_days)
        trip_query = trip_query.filter(Trip.end_time >= cutoff)

    trips = trip_query.order_by(Trip.end_time.asc()).all()

    trips_attempted = 0
    failures = 0
    # Log every N newly-processed trips so a single route with a huge
    # historical backlog does not stay silent between per-route summaries.
    _PROGRESS_EVERY_N_TRIPS = 50
    for trip in trips:
        if seen_trip_ids is not None:
            if trip.id in seen_trip_ids:
                continue
            seen_trip_ids.add(trip.id)
        trips_attempted += 1
        try:
            match_trip_to_routes(db, trip)
        except Exception:
            failures += 1
            db.rollback()
            logger.exception(
                "Route matching backfill failed for trip_id=%s route_id=%s",
                trip.id,
                route.id,
            )
        if trips_attempted % _PROGRESS_EVERY_N_TRIPS == 0:
            logger.info(
                "Route '%s' (id=%s) backfill progress: %d trips processed "
                "(%d failures so far)",
                route.name,
                route.id,
                trips_attempted,
                failures,
            )

    return {"trips_attempted": trips_attempted, "failures": failures}


def recompute_all_route_matches(db: Session) -> dict:
    """Recompute route match data for every route and every assigned device.

    Iterates dynamically over all routes currently in the database and
    delegates each route to ``backfill_route_matches(..., lookback_days=None)``
    — the same code path used by per-route recalculate, but with no
    lookback cutoff. A shared ``seen_trip_ids`` set ensures each trip is
    rematched only once even when its device has historical assignments
    to multiple routes (``match_trip_to_routes`` matches a single
    confirmed/assigned-at-start route per trip).

    Existing TripRouteMatch rows are overwritten with freshly computed
    values; the operation is idempotent and safe to run multiple times.

    Returns a summary dict with counts of routes processed, trips attempted,
    and any failures.
    """
    routes = db.query(Route).order_by(Route.id.asc()).all()
    seen_trip_ids: set[int] = set()
    total_trips = 0
    total_failures = 0
    route_count = len(routes)

    logger.info(
        "recompute_all_route_matches starting: %d routes to process",
        route_count,
    )

    for route_idx, route in enumerate(routes, start=1):
        assigned_devices = (
            db.query(RouteVehicle)
            .filter(RouteVehicle.route_id == route.id)
            .count()
        )
        result = backfill_route_matches(
            db,
            route,
            lookback_days=None,
            seen_trip_ids=seen_trip_ids,
        )
        total_trips += result["trips_attempted"]
        total_failures += result["failures"]
        logger.info(
            "Finished route '%s' (id=%s): %d/%d routes, %d assigned devices, "
            "%d trips processed so far (%d failures)",
            route.name,
            route.id,
            route_idx,
            route_count,
            assigned_devices,
            total_trips,
            total_failures,
        )

    logger.info(
        "recompute_all_route_matches complete: routes=%d trips_attempted=%d failures=%d",
        route_count,
        total_trips,
        total_failures,
    )
    return {
        "routes_processed": len(routes),
        "trips_attempted": total_trips,
        "failures": total_failures,
    }


def build_trip_route_detail(db: Session, trip_id: int, route_id: int, max_points: int | None = 4000):
    """Map overlay for a trip attributed to `route_id`. GPS match is optional."""
    from sqlalchemy.orm import load_only
    from tracker_backend.models import DevicePosition
    from tracker_backend.schemas import TripRouteDetailOut
    from tracker_backend.services import driver_service, position_writer, route_assignment_service

    trip = db.query(Trip).filter(Trip.id == trip_id).first()
    route = db.query(Route).filter(Route.id == route_id).first()
    if trip is None or route is None:
        return None
    if not route_assignment_service.trip_is_attributed_to_route(db, trip, route_id):
        return None

    device = db.query(Device).filter(Device.id == trip.device_id).first()
    if device is None:
        return None

    match = (
        db.query(TripRouteMatch)
        .filter(TripRouteMatch.trip_id == trip_id, TripRouteMatch.route_id == route_id)
        .first()
    )

    positions = (
        db.query(DevicePosition)
        .options(
            load_only(
                DevicePosition.id,
                DevicePosition.device_id,
                DevicePosition.lat,
                DevicePosition.lon,
                DevicePosition.speed_kmh,
                DevicePosition.course,
                DevicePosition.fix_time,
            )
        )
        .filter(
            DevicePosition.device_id == trip.device_id,
            DevicePosition.fix_time >= trip.start_time,
            DevicePosition.fix_time <= trip.end_time,
        )
        .order_by(DevicePosition.fix_time.asc())
        .all()
    )
    positions = position_writer.thin_route_positions(positions, max_points)
    actual_path = [{"lat": p.lat, "lon": p.lon, "fix_time": p.fix_time} for p in positions]

    driver, _driver_alert = driver_service.get_driver_for_trip(
        db, trip.device_id, trip.start_time, trip.status,
    )
    avg_speed_kmh = None
    if trip.distance_km is not None and trip.duration_min not in (None, 0):
        avg_speed_kmh = round(trip.distance_km / (trip.duration_min / 60.0), 2)

    fuel_avg = None
    if trip.total_fuel_liters not in (None, 0) and trip.distance_km not in (None, 0):
        fuel_avg = round(trip.total_fuel_liters / trip.distance_km, 2)

    last_index = max(len(actual_path) - 1, 0)
    return TripRouteDetailOut(
        trip_id=trip.id,
        route_id=route.id,
        route_name=route.name,
        trip_date=route_assignment_service.trip_display_date(trip),
        route_path=[],
        actual_path=actual_path,
        deviation_segments=(match.deviation_segments or []) if match is not None else [],
        leg_start_index=match.leg_start_index if match is not None and match.leg_start_index is not None else 0,
        leg_end_index=(
            match.leg_end_index
            if match is not None and match.leg_end_index is not None
            else last_index
        ),
        route_status_segments=classify_trip_route_status(positions, route),
        driver_name=driver.name if driver else None,
        vehicle_name=device.name,
        distance_km=trip.distance_km,
        avg_speed_kmh=avg_speed_kmh,
        duration_min=trip.duration_min,
        fuel_avg=fuel_avg,
        fuel_cost_pkr=trip.fuel_cost_pkr,
        price_per_liter_used=trip.price_per_liter_used,
        toll_tax_pkr=trip.toll_tax_pkr,
        challan_pkr=trip.challan_pkr,
    )
