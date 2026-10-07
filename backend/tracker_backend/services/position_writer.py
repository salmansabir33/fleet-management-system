"""
Persists Traccar positions to MySQL, called from poller.py on every poll.
Only writes a new DevicePosition row per device when Traccar reports a
genuinely NEW fix_time AND the position actually moved, its motion_status
changed, the heartbeat interval elapsed, or a GPS anomaly was detected.

Traccar's /api/positions endpoint keeps re-serving the last known position
for offline devices forever (it never disappears from the response) — so
fix_time is the one field that reliably tells us "this is new data" vs
"this is the same stale cached fix being repeated." That check happens
FIRST, before any movement/speed logic, since speed/motion fields are
themselves stale and meaningless once a device has gone offline.

Live polling only sees the *current* fix. After backend downtime or a
device reconnecting with buffered history, that current fix jumps over
hours of movement that Traccar still has in /api/reports/route. Those
gaps are filled by backfill_positions_from_traccar (also used when a
trip closes, and when repairing already-completed trips).
"""

import logging
import math
from datetime import datetime, timedelta, timezone

from sqlalchemy import func, or_
from sqlalchemy.orm import load_only

from tracker_backend.db import SessionLocal
from tracker_backend.models import Device, DevicePosition

logger = logging.getLogger(__name__)

MOVE_THRESHOLD_METERS = 25
HEARTBEAT_INTERVAL = timedelta(minutes=5)
SPEED_MOVING_THRESHOLD_KMH = 2

# Anything implying faster than this is physically implausible for a road
# vehicle in normal traffic — almost certainly a bad GPS fix, not real travel.
MAX_PLAUSIBLE_SPEED_KMH = 180

# A live fix this far after the last stored row means we missed history
# (poller down, or the tracker was offline then dumped buffered points
# into Traccar). Fetch reports/route for the hole instead of writing a
# teleport from the last ping to "now".
GAP_BACKFILL_THRESHOLD = timedelta(minutes=10)

# Protocols reported by the Traccar mobile client app, as opposed to
# hardware GT06-family trackers. Matches the KMH_PROTOCOLS list already
# used in traccar.py for speed conversion.
MOBILE_PROTOCOLS = {"osmand", "tr20"}

# In-memory "what did we last save per device" — avoids a DB read every
# 5s just to check whether something changed. Resets on app restart;
# save_positions then seeds from the latest DevicePosition row so a
# restart can still detect a gap vs the last persisted fix.
_last_saved: dict[int, dict] = {}


def haversine_meters(lat1, lon1, lat2, lon2):
    R = 6371000
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    d_phi = math.radians(lat2 - lat1)
    d_lambda = math.radians(lon2 - lon1)
    a = (math.sin(d_phi / 2) ** 2
         + math.cos(phi1) * math.cos(phi2) * math.sin(d_lambda / 2) ** 2)
    return 2 * R * math.asin(math.sqrt(a))


def determine_motion_status(speed_kmh: float, ignition: bool | None) -> str:
    """
    moving  -> speed above threshold, regardless of ignition reading
    idle    -> ignition on, but not moving (engine running, vehicle stationary)
    stopped -> ignition off, not moving (parked)
    """
    if speed_kmh and speed_kmh > SPEED_MOVING_THRESHOLD_KMH:
        return "moving"
    if ignition:
        return "idle"
    return "stopped"


def parse_traccar_fix_time(fix_time_str: str) -> datetime:
    return datetime.fromisoformat(fix_time_str.replace("Z", "+00:00")).replace(tzinfo=None)


def naive_utc_iso(dt: datetime) -> str:
    if dt.tzinfo is not None:
        dt = dt.astimezone(timezone.utc).replace(tzinfo=None)
    return dt.replace(microsecond=0).strftime("%Y-%m-%dT%H:%M:%SZ")


# On-demand Playback uses a tighter hole than historical trip repair
# (30 min). A user-picked window can be short; waiting 30 min to notice
# missing GPS would leave Playback empty for ranges that Traccar still
# has. 15 min is still wide enough to ignore a parked stretch.
DEFAULT_ON_DEMAND_GAP_THRESHOLD = timedelta(minutes=15)


def positions_have_gap(
    positions: list[DevicePosition],
    start_time: datetime,
    end_time: datetime,
    threshold: timedelta,
) -> bool:
    """True if [start_time, end_time] is missing a stretch of stored GPS.

    Shared by trip-window repair (30 min threshold) and on-demand
    Playback (15 min). Same checks either way: window too short to
    matter, fewer than 2 points, hole before the first point, hole
    after the last, or a hole between any consecutive pair.
    """
    return bool(iter_position_gaps(positions, start_time, end_time, threshold))


def iter_position_gaps(
    positions: list[DevicePosition],
    start_time: datetime,
    end_time: datetime,
    threshold: timedelta,
) -> list[tuple[datetime, datetime]]:
    """Return [from, to] windows that are missing stored GPS by >= threshold.

    Empty when the window is too short to matter or coverage is dense enough.
    Used so Playback can Traccar-backfill only the holes, not the full range.
    """
    if start_time is None or end_time is None or end_time - start_time < threshold:
        return []
    if len(positions) < 2:
        return [(start_time, end_time)]

    gaps: list[tuple[datetime, datetime]] = []
    if positions[0].fix_time - start_time >= threshold:
        gaps.append((start_time, positions[0].fix_time))
    for prev, curr in zip(positions, positions[1:]):
        if curr.fix_time - prev.fix_time >= threshold:
            gaps.append((prev.fix_time, curr.fix_time))
    if end_time - positions[-1].fix_time >= threshold:
        gaps.append((positions[-1].fix_time, end_time))
    return gaps


def _positions_in_range(
    db,
    device: Device,
    from_time: datetime,
    to_time: datetime,
    fetch_cap: int | None = None,
) -> list[DevicePosition]:
    # Route/Playback only needs the slim columns returned by /api/route —
    # skip raw_attributes / address / etc. on large month-sized scans.
    filters = (
        DevicePosition.device_id == device.id,
        DevicePosition.fix_time >= from_time,
        DevicePosition.fix_time <= to_time,
    )
    base = (
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
        .filter(*filters)
        .order_by(DevicePosition.fix_time.asc())
    )
    if fetch_cap is None or fetch_cap < 2:
        return base.all()

    count = (
        db.query(func.count(DevicePosition.id))
        .filter(*filters)
        .scalar()
    ) or 0
    if count <= fetch_cap:
        return base.all()

    # Evenly sample ~fetch_cap rows (always keep first/last) so month-sized
    # Playback does not materialize every heartbeat before thinning.
    stride = max(1, count // fetch_cap)
    numbered = (
        db.query(
            DevicePosition.id.label("pid"),
            func.row_number()
            .over(order_by=DevicePosition.fix_time.asc())
            .label("rn"),
            func.count()
            .over()
            .label("cnt"),
        )
        .filter(*filters)
        .subquery()
    )
    id_rows = (
        db.query(numbered.c.pid)
        .filter(
            or_(
                numbered.c.rn == 1,
                numbered.c.rn == numbered.c.cnt,
                ((numbered.c.rn - 1) % stride) == 0,
            )
        )
        .all()
    )
    keep_ids = [row[0] for row in id_rows]
    if not keep_ids:
        return base.all()

    by_id = {
        row.id: row
        for row in (
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
            .filter(DevicePosition.id.in_(keep_ids))
            .all()
        )
    }
    # Preserve chronological order from the numbered selection.
    return [by_id[i] for i in keep_ids if i in by_id]


# Small pad so Traccar inclusive endpoints and second-precision keys
# still pull points that sit on the gap boundary.
_GAP_BACKFILL_PAD = timedelta(seconds=30)
# Long Playback windows (week/month) already have dense poller data in DB;
# Traccar-filling every overnight/parking hole makes Previous Month unusable.
_SKIP_GAP_BACKFILL_AFTER = timedelta(days=2)
# Cap how many holes a short-range replay will repair in one request.
_MAX_ON_DEMAND_GAP_BACKFILLS = 6


def ensure_positions_for_range(
    db,
    device: Device,
    from_time: datetime,
    to_time: datetime,
    gap_threshold: timedelta = DEFAULT_ON_DEMAND_GAP_THRESHOLD,
    fill_gaps: bool | None = None,
    fetch_cap: int | None = None,
) -> list[DevicePosition]:
    """DB-first position fetch for an arbitrary time window (not tied to a
    Trip row).

    Playback (`GET /api/route`) always passes fill_gaps=False — missing
    history is repaired by background jobs (poller live gaps, trip-close
    backfill, backfill_gapped_trip_positions, backfill_gapped_device_ranges),
    not while the user waits on Show.

    When fill_gaps is True, holes >= gap_threshold are pulled from Traccar
    via backfill_positions_from_traccar (idempotent) then re-queried.
    When fill_gaps is None, auto-disabled for windows longer than 2 days.

    fetch_cap: optional max rows to load before Playback thinning
    (keeps first/last + even samples).
    """
    if fill_gaps is None:
        fill_gaps = (to_time - from_time) < _SKIP_GAP_BACKFILL_AFTER

    positions = _positions_in_range(db, device, from_time, to_time, fetch_cap=fetch_cap)
    if not fill_gaps:
        return positions

    gaps = iter_position_gaps(positions, from_time, to_time, gap_threshold)
    if not gaps:
        return positions

    if len(gaps) > _MAX_ON_DEMAND_GAP_BACKFILLS:
        # Prefer the longest holes (real outages) over many short parking gaps.
        gaps = sorted(gaps, key=lambda g: g[1] - g[0], reverse=True)[:_MAX_ON_DEMAND_GAP_BACKFILLS]

    for gap_from, gap_to in gaps:
        padded_from = max(from_time, gap_from - _GAP_BACKFILL_PAD)
        padded_to = min(to_time, gap_to + _GAP_BACKFILL_PAD)
        backfill_positions_from_traccar(db, device, padded_from, padded_to)
    db.commit()
    return _positions_in_range(db, device, from_time, to_time, fetch_cap=fetch_cap)


def thin_route_positions(
    positions: list[DevicePosition],
    max_points: int | None,
) -> list[DevicePosition]:
    """Downsample a long route for Playback while keeping first/last and
    points where speed or course changed materially.
    """
    if max_points is None or max_points < 2 or len(positions) <= max_points:
        return positions

    n = len(positions)
    keep: set[int] = {0, n - 1}
    for i in range(1, n - 1):
        prev, curr = positions[i - 1], positions[i]
        speed_delta = abs((curr.speed_kmh or 0) - (prev.speed_kmh or 0))
        course_delta = abs((curr.course or 0) - (prev.course or 0))
        if course_delta > 180:
            course_delta = 360 - course_delta
        if speed_delta >= 5 or course_delta >= 25:
            keep.add(i)

    if len(keep) > max_points:
        # Too many change points — evenly sample the keep set (always ends).
        ordered = sorted(keep)
        sampled = {
            ordered[round(i * (len(ordered) - 1) / (max_points - 1))]
            for i in range(max_points)
        }
        sampled.add(0)
        sampled.add(n - 1)
        return [positions[i] for i in sorted(sampled)]

    # Fill remaining slots with even spacing across the full range.
    remaining = max_points - len(keep)
    if remaining > 0:
        for i in range(1, remaining + 1):
            idx = round(i * (n - 1) / (remaining + 1))
            keep.add(idx)

    return [positions[i] for i in sorted(keep)]


# Device-wide calendar repair (Period Playback completeness). Same 30 min
# hole size as trip repair — not the old 15 min Playback on-demand value —
# so overnight parking with heartbeats is not treated as an outage.
DEVICE_GAP_REPAIR_LOOKBACK_DAYS = 90
DEVICE_GAP_REPAIR_THRESHOLD = timedelta(minutes=30)
MAX_DEVICES_PER_GAP_REPAIR_RUN = 50
MAX_DEVICE_GAP_HOLES_PER_RUN = 40
MAX_DEVICE_GAP_HOLES_PER_DEVICE = 8


def backfill_gapped_device_ranges(db=None) -> dict:
    """Fill Traccar history into device_positions for device time-range holes.

    Complements backfill_gapped_trip_positions (trip windows only). Scans
    each device's stored trail over the lookback window, finds holes >=
    30 minutes, and backfills those windows only. Idempotent; commits per
    device so one Traccar failure cannot roll back others.

    Skips devices with fewer than 2 points in-range (no trail to repair
    into — avoids a 90-day full-window Traccar pull). Caps devices/holes
    per run so a bad host cannot run forever.
    """
    owns_session = db is None
    if owns_session:
        db = SessionLocal()

    repaired_devices = 0
    inserted_total = 0
    holes_filled = 0
    end_time = datetime.utcnow()
    cutoff = end_time - timedelta(days=DEVICE_GAP_REPAIR_LOOKBACK_DAYS)
    try:
        devices = (
            db.query(Device)
            .filter(Device.traccar_device_id.isnot(None))
            .order_by(Device.id.asc())
            .limit(MAX_DEVICES_PER_GAP_REPAIR_RUN)
            .all()
        )
        for device in devices:
            if holes_filled >= MAX_DEVICE_GAP_HOLES_PER_RUN:
                break

            positions = (
                db.query(DevicePosition)
                .options(
                    load_only(
                        DevicePosition.id,
                        DevicePosition.device_id,
                        DevicePosition.fix_time,
                    )
                )
                .filter(
                    DevicePosition.device_id == device.id,
                    DevicePosition.fix_time >= cutoff,
                    DevicePosition.fix_time <= end_time,
                )
                .order_by(DevicePosition.fix_time.asc())
                .all()
            )
            if len(positions) < 2:
                continue

            gaps = iter_position_gaps(
                positions, cutoff, end_time, DEVICE_GAP_REPAIR_THRESHOLD,
            )
            if not gaps:
                continue

            # Prefer longest holes (real outages); hard-cap per device.
            gaps = sorted(gaps, key=lambda g: g[1] - g[0], reverse=True)
            gaps = gaps[:MAX_DEVICE_GAP_HOLES_PER_DEVICE]

            device_inserted = 0
            for gap_from, gap_to in gaps:
                if holes_filled >= MAX_DEVICE_GAP_HOLES_PER_RUN:
                    break
                padded_from = max(cutoff, gap_from - _GAP_BACKFILL_PAD)
                padded_to = min(end_time, gap_to + _GAP_BACKFILL_PAD)
                try:
                    inserted = backfill_positions_from_traccar(
                        db, device, padded_from, padded_to,
                    )
                except Exception:
                    logger.exception(
                        "Device-range position backfill failed for device_id=%s "
                        "window %s .. %s",
                        device.id, padded_from, padded_to,
                    )
                    db.rollback()
                    continue

                holes_filled += 1
                if inserted:
                    device_inserted += inserted
                    inserted_total += inserted

            if device_inserted:
                db.commit()
                repaired_devices += 1
                logger.info(
                    "Repaired gapped device_id=%s with %s new positions",
                    device.id, device_inserted,
                )
            else:
                # Flush any empty transaction state from skipped inserts.
                try:
                    db.commit()
                except Exception:
                    db.rollback()

        return {
            "repaired_devices": repaired_devices,
            "inserted_positions": inserted_total,
            "holes_filled": holes_filled,
        }
    finally:
        if owns_session:
            db.close()


def _fix_key(dt: datetime) -> datetime:
    return dt.replace(microsecond=0)


def _get_or_create_device(db, devices_by_id, traccar_device_id):
    device = db.query(Device).filter_by(traccar_device_id=traccar_device_id).first()
    if device:
        return device
    name = devices_by_id.get(traccar_device_id, {}).get("name", f"Device {traccar_device_id}")
    # Quarantine row: admin_id/user_id stay None until claimed via Super Admin
    # Unassigned or fleet claim.
    device = Device(traccar_device_id=traccar_device_id, name=name)
    db.add(device)
    db.flush()  # get device.id without a full commit yet
    logger.warning(
        "Created quarantine Device id=%s traccar_device_id=%s name=%r "
        "(admin_id/user_id null until claimed)",
        device.id,
        traccar_device_id,
        name,
    )
    return device


def _last_ref_from_row(row: DevicePosition) -> dict:
    return {
        "lat": row.lat,
        "lon": row.lon,
        "fix_time": row.fix_time,
        "motion_status": row.motion_status,
    }


def _load_last_from_db(db, device: Device) -> dict | None:
    row = (
        db.query(DevicePosition)
        .filter(DevicePosition.device_id == device.id)
        .order_by(DevicePosition.fix_time.desc())
        .first()
    )
    return _last_ref_from_row(row) if row else None


def _evaluate_insert(last: dict | None, lat, lon, fix_time, speed_kmh, motion_status):
    """Same insert gates as live polling. Returns (should_insert, is_gps_anomaly)."""
    if last is None:
        return True, False

    distance_m = haversine_meters(last["lat"], last["lon"], lat, lon)
    hours_elapsed = (fix_time - last["fix_time"]).total_seconds() / 3600

    is_gps_anomaly = False
    if hours_elapsed > 0:
        implied_speed_kmh = (distance_m / 1000) / hours_elapsed
        is_gps_anomaly = implied_speed_kmh > MAX_PLAUSIBLE_SPEED_KMH

    moved_significantly = (
        not is_gps_anomaly
        and (distance_m > MOVE_THRESHOLD_METERS or speed_kmh > SPEED_MOVING_THRESHOLD_KMH)
    )
    status_changed = last["motion_status"] != motion_status
    heartbeat_due = (fix_time - last["fix_time"]) >= HEARTBEAT_INTERVAL
    should_insert = moved_significantly or status_changed or heartbeat_due or is_gps_anomaly
    return should_insert, is_gps_anomaly


def _add_position_row(db, device: Device, p: dict, fix_time: datetime, motion_status: str, is_gps_anomaly: bool):
    attrs = p.get("attributes") or {}
    raw_distance = p.get("distance") or attrs.get("distance")
    raw_total = p.get("totalDistance") or attrs.get("totalDistance")
    protocol = p.get("protocol")
    ignition = attrs.get("ignition")
    speed_kmh = p.get("speed_kmh", 0)

    db.add(DevicePosition(
        device_id=device.id,
        lat=p["latitude"],
        lon=p["longitude"],
        altitude=p.get("altitude"),
        speed_kmh=speed_kmh,
        course=p.get("course"),
        accuracy=p.get("accuracy"),
        protocol=protocol,
        address=p.get("address"),
        ignition=ignition,
        motion=attrs.get("motion"),
        battery_level=attrs.get("batteryLevel"),
        distance=float(raw_distance) if raw_distance is not None else None,
        total_distance=float(raw_total) if raw_total is not None else None,
        geofence_ids=p.get("geofenceIds"),
        motion_status=motion_status,
        is_gps_anomaly=is_gps_anomaly,
        raw_attributes=attrs,
        fix_time=fix_time,
    ))


def backfill_positions_from_traccar(db, device: Device, from_time: datetime, to_time: datetime) -> int:
    """Copy missing Traccar history into device_positions for [from_time, to_time].

    Idempotent: existing fix_times (second precision) are skipped. Insert
    gates match live polling so backfilled density stays consistent.
    Returns the number of new rows flushed onto `db` (does not commit).
    """
    if device is None or device.traccar_device_id is None:
        return 0
    if from_time is None or to_time is None or from_time >= to_time:
        return 0

    # Imported here to keep traccar.py free of this module (and to avoid
    # pulling httpx work into every position_writer import at test time
    # before settings are loaded — settings are already loaded by traccar).
    from tracker_backend.services.traccar import traccar_service

    try:
        route = traccar_service.get_route_sync(
            device.traccar_device_id,
            naive_utc_iso(from_time),
            naive_utc_iso(to_time),
        )
    except Exception as exc:
        logger.warning(
            "Traccar route backfill failed for device_id=%s window %s .. %s: %s",
            device.id, from_time, to_time, exc,
        )
        return 0

    existing_rows = (
        db.query(DevicePosition.fix_time)
        .filter(
            DevicePosition.device_id == device.id,
            DevicePosition.fix_time >= from_time,
            DevicePosition.fix_time <= to_time,
        )
        .all()
    )
    existing_keys = {_fix_key(row[0]) for row in existing_rows}

    predecessor = (
        db.query(DevicePosition)
        .filter(
            DevicePosition.device_id == device.id,
            DevicePosition.fix_time < from_time,
        )
        .order_by(DevicePosition.fix_time.desc())
        .first()
    )
    last = _last_ref_from_row(predecessor) if predecessor else None

    inserted = 0
    newest_good = last
    for p in route:
        lat = p.get("latitude")
        lon = p.get("longitude")
        if lat is None or lon is None or not p.get("fixTime"):
            continue

        fix_time = parse_traccar_fix_time(p["fixTime"])
        key = _fix_key(fix_time)
        attrs = p.get("attributes") or {}
        speed_kmh = p.get("speed_kmh", 0)
        motion_status = determine_motion_status(speed_kmh, attrs.get("ignition"))
        if key in existing_keys:
            last = {
                "lat": lat,
                "lon": lon,
                "fix_time": fix_time,
                "motion_status": motion_status,
            }
            newest_good = last
            continue

        should_insert, is_gps_anomaly = _evaluate_insert(
            last, lat, lon, fix_time, speed_kmh, motion_status,
        )
        if not should_insert:
            continue

        _add_position_row(db, device, p, fix_time, motion_status, is_gps_anomaly)
        existing_keys.add(key)
        inserted += 1
        if not is_gps_anomaly:
            last = {
                "lat": lat,
                "lon": lon,
                "fix_time": fix_time,
                "motion_status": motion_status,
            }
            newest_good = last

    if inserted:
        db.flush()
        if newest_good is not None:
            current = _last_saved.get(device.traccar_device_id)
            if current is None or newest_good["fix_time"] >= current["fix_time"]:
                _last_saved[device.traccar_device_id] = newest_good
        logger.info(
            "Backfilled %s DevicePosition rows for device_id=%s (%s .. %s)",
            inserted, device.id, from_time, to_time,
        )
    return inserted


def save_positions(devices: list, positions: list):
    """Called every poll with the already-fetched devices/positions — no extra Traccar call
    unless a device's fix_time jumped far enough to imply missing history.
    """
    if not positions:
        return

    devices_by_id = {d["id"]: d for d in devices}

    db = SessionLocal()
    try:
        # Ensure every known device exists in our table, even ones that
        # have never sent a position yet (offline, never activated).
        for d in devices:
            _get_or_create_device(db, devices_by_id, d["id"])

        for p in positions:
            traccar_device_id = p["deviceId"]
            attrs = p.get("attributes", {})
            fix_time = parse_traccar_fix_time(p["fixTime"])
            speed_kmh = p.get("speed_kmh", 0)
            ignition = attrs.get("ignition")

            motion_status = determine_motion_status(speed_kmh, ignition)

            device = _get_or_create_device(db, devices_by_id, traccar_device_id)

            # Unconditional — real fix_time from the device's own clock,
            # not "when we polled." This is the anti-theft/silence signal,
            # and it correctly stops advancing once fix_time stops changing.
            device.last_seen_at = fix_time

            # Auto-classify device type from the protocol on this position.
            protocol = p.get("protocol")
            if protocol:
                device.device_type = "mobile" if protocol in MOBILE_PROTOCOLS else "hardware"

            # Maintenance feature — auto-fill engine hours when Traccar
            # reports them. Traccar reports "hours" in milliseconds, per
            # convention, so divide by 3_600_000 to get hours. Only
            # hardware trackers with an engine-hours sensor send this;
            # for devices that never report it (mobile), the user sets
            # it manually via PATCH /api/maintenance/devices/{id}/engine-hours.
            # Unconditional, like last_seen_at/device_type above.
            raw_hours_ms = attrs.get("hours")
            if raw_hours_ms is not None:
                device.engine_hours = float(raw_hours_ms) / 3_600_000

            last = _last_saved.get(traccar_device_id)
            if last is None:
                last = _load_last_from_db(db, device)
                if last:
                    _last_saved[traccar_device_id] = last

            # HARD GATE: if Traccar is just re-serving the same cached fix
            # (fix_time unchanged since last time we saw this device),
            # nothing new actually happened — skip entirely, regardless
            # of what speed/motion fields say, since those are stale too
            # when the underlying fix itself is stale. This is what stops
            # an offline device from generating a new row every 5 seconds
            # forever.
            if last and _fix_key(fix_time) == _fix_key(last["fix_time"]):
                continue

            if last and fix_time > last["fix_time"] and (fix_time - last["fix_time"]) >= GAP_BACKFILL_THRESHOLD:
                backfill_positions_from_traccar(db, device, last["fix_time"], fix_time)
                last = _load_last_from_db(db, device) or last
                if last:
                    _last_saved[traccar_device_id] = last
                if last and _fix_key(fix_time) == _fix_key(last["fix_time"]):
                    continue

            should_insert, is_gps_anomaly = _evaluate_insert(
                last, p["latitude"], p["longitude"], fix_time, speed_kmh, motion_status,
            )

            if should_insert:
                _add_position_row(db, device, p, fix_time, motion_status, is_gps_anomaly)

                # Critical: only advance the "last known good" reference
                # when the point WASN'T flagged as an anomaly, so a single
                # glitch can't cascade into repeated false anomalies.
                if not is_gps_anomaly:
                    _last_saved[traccar_device_id] = {
                        "lat": p["latitude"],
                        "lon": p["longitude"],
                        "fix_time": fix_time,
                        "motion_status": motion_status,
                    }

        db.commit()
    finally:
        db.close()
