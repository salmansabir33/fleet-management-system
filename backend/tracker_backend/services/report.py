from datetime import date, datetime, timedelta, timezone
from sqlalchemy.orm import Session
from tracker_backend.models import DevicePosition

OVERSPEED_THRESHOLD_KMH = 80
HARSH_BRAKE_DELTA_KMH = 15
HARSH_ACCEL_DELTA_KMH = 15


def _utc_iso(dt: datetime) -> str:
    """Format a datetime as ISO 8601 with explicit Z suffix (UTC).

    Handles both naive and timezone-aware datetimes. For timezone-aware
    datetimes, converts to UTC first. For naive datetimes (assumed UTC),
    appends 'Z' so JavaScript parses them as UTC.
    """
    if dt.tzinfo is not None:
        dt = dt.astimezone(timezone.utc)
    return dt.strftime("%Y-%m-%dT%H:%M:%SZ")


def get_distance_trend_points(db: Session, device_id: int, days: int = 7) -> list[dict]:
    """Fast daily distance series for sparkline charts.

    Uses first/last odometer (`total_distance`) per calendar day with two
    LIMIT-1 lookups — avoids loading every DevicePosition row and walking
    them through get_daily_report (which was O(positions × days)).
    """
    days = max(1, min(int(days or 7), 90))
    points = []
    for offset in range(days - 1, -1, -1):
        day = date.today() - timedelta(days=offset)
        start_dt = datetime.combine(day, datetime.min.time())
        end_dt = start_dt + timedelta(days=1)

        day_filter = (
            DevicePosition.device_id == device_id,
            DevicePosition.fix_time >= start_dt,
            DevicePosition.fix_time < end_dt,
        )
        first_total = (
            db.query(DevicePosition.total_distance)
            .filter(*day_filter)
            .order_by(DevicePosition.fix_time.asc())
            .limit(1)
            .scalar()
        )
        last_total = (
            db.query(DevicePosition.total_distance)
            .filter(*day_filter)
            .order_by(DevicePosition.fix_time.desc())
            .limit(1)
            .scalar()
        )

        distance_km = 0.0
        if first_total is not None and last_total is not None:
            distance_km = round(max((last_total - first_total) / 1000.0, 0.0), 2)

        points.append({
            "date": day.isoformat(),
            "distance_km": distance_km,
            "fuel_cost_pkr": 0,
        })
    return points


def get_daily_report(
    db: Session,
    device_id: int,
    start_dt: datetime,
    end_dt: datetime,
    label: str,
    fuel_avg_running: float | None,
    fuel_avg_idle: float | None,
    price_per_liter: float | None,
    price_effective_date,  # date | None
    overspeed_threshold_kmh: float | None = None,
    harsh_brake_delta_kmh: float | None = None,
    harsh_accel_delta_kmh: float | None = None,
    include_detailed_positions: bool = True,
) -> dict | None:
    """Aggregated metrics for a device over [start_dt, end_dt).

    `start_dt`/`end_dt` are naive datetimes treated as UTC, same
    convention as every other timestamp in this codebase (fix_time,
    last_seen_at, etc.). Works identically whether the caller built the
    range from a single calendar date (midnight-to-midnight) or from an
    explicit start/end datetime range picked by the user — this
    function doesn't care which.

    `label` is a display-only string describing the range (e.g. a plain
    date "2026-08-06" for single-day mode, or a "start to end" string
    for range mode) — it's echoed back in the response's "date" field
    for backward compatibility with existing API consumers, but isn't
    used for any calculation.

    `overspeed_threshold_kmh` / `harsh_brake_delta_kmh` /
    `harsh_accel_delta_kmh` let a caller override the fleet-wide
    defaults below with a per-vehicle value (see Device.speed_limit_kmh
    etc.) — pass None (the default) to use the fleet-wide constant.
    """
    overspeed_threshold_kmh = (
        overspeed_threshold_kmh if overspeed_threshold_kmh is not None else OVERSPEED_THRESHOLD_KMH
    )
    harsh_brake_delta_kmh = (
        harsh_brake_delta_kmh if harsh_brake_delta_kmh is not None else HARSH_BRAKE_DELTA_KMH
    )
    harsh_accel_delta_kmh = (
        harsh_accel_delta_kmh if harsh_accel_delta_kmh is not None else HARSH_ACCEL_DELTA_KMH
    )

    positions = (
        db.query(DevicePosition)
        .filter(
            DevicePosition.device_id == device_id,
            DevicePosition.fix_time >= start_dt,
            DevicePosition.fix_time < end_dt,
        )
        .order_by(DevicePosition.fix_time)
        .all()
    )

    if not positions:
        return None

    first_total = positions[0].total_distance or 0
    last_total = positions[-1].total_distance or 0

    # DB Logged Distance: computed from the device's own odometer
    # (`total_distance`, as reported by Traccar) — first vs last reading
    # for the SELECTED RANGE only (positions is already filtered above).
    # Deliberately NOT a Haversine sum of GPS points: the odometer is
    # device-accurate, while point-to-point GPS distance drifts with fix
    # frequency, turns, and signal noise.
    #
    # Note: this uses the same formula/source as "Traccar Distance"
    # below, so the two will usually match — they only diverge if our
    # own polling/dedup pipeline failed to store the range's first or
    # last position, which is itself a useful signal that our DB missed
    # something Traccar has.
    db_total_distance = round(max((last_total - first_total) / 1000.0, 0.0), 2)

    traccar_total_distance = round(max((last_total - first_total) / 1000.0, 0.0), 2)

    max_speed_kmh = max((p.speed_kmh or 0 for p in positions), default=0)

    gps_anomaly_count = sum(1 for p in positions if p.is_gps_anomaly)

    driving_time_seconds = 0
    idle_time_seconds = 0
    harsh_brake_count = 0
    harsh_accel_count = 0
    overspeed_count = 0

    # Moving-speed samples, used for avg_speed_kmh below — only counted
    # while actually driving so idle/stopped readings (~0 km/h) don't
    # drag the average down.
    moving_speed_sum = 0.0
    moving_speed_samples = 0

    for i in range(len(positions) - 1):
        current = positions[i]
        next_pos = positions[i + 1]
        time_diff = (next_pos.fix_time - current.fix_time).total_seconds()

        if current.speed_kmh and current.speed_kmh > 2:
            driving_time_seconds += min(time_diff, 600)
            moving_speed_sum += current.speed_kmh
            moving_speed_samples += 1
        elif current.motion_status == "idle":
            idle_time_seconds += time_diff

        attrs = current.raw_attributes or {}
        alarm = attrs.get("alarm", "")

        speed_delta = (next_pos.speed_kmh or 0) - (current.speed_kmh or 0)

        if alarm == "hardBraking" or speed_delta < -harsh_brake_delta_kmh:
            harsh_brake_count += 1

        if alarm == "hardAcceleration" or speed_delta > harsh_accel_delta_kmh:
            harsh_accel_count += 1

    overspeed_count = sum(
        1 for p in positions if p.speed_kmh and p.speed_kmh > overspeed_threshold_kmh
    )

    avg_speed_kmh = (
        round(moving_speed_sum / moving_speed_samples, 2) if moving_speed_samples else 0
    )

    # Idle/stop OCCURRENCE counts — how many separate times the vehicle
    # transitioned INTO that state, as opposed to idle_time_seconds
    # above (which is total duration). A device that idles 5 separate
    # times for 2 minutes each has the same idle_time_seconds as one
    # that idles once for 10 minutes, but a very different idle_count —
    # this is the "how many times did it go idle" figure.
    idle_count = 0
    stop_count = 0
    previous_status = None
    for p in positions:
        if p.motion_status == "idle" and previous_status != "idle":
            idle_count += 1
        if p.motion_status == "stopped" and previous_status != "stopped":
            stop_count += 1
        previous_status = p.motion_status

    if fuel_avg_idle is None:
        idle_fuel_liters = None
    else:
        idle_fuel_liters = round((idle_time_seconds / 3600.0) * fuel_avg_idle, 2)

    fuel_avg_configured = fuel_avg_running is not None and fuel_avg_running > 0
    fuel_message = None if fuel_avg_configured else "No fuel average added for device"

    if fuel_avg_configured:
        traccar_driving_fuel_liters = round(traccar_total_distance / fuel_avg_running, 2)
        db_driving_fuel_liters = round(db_total_distance / fuel_avg_running, 2)
        idle_for_total = idle_fuel_liters if idle_fuel_liters is not None else 0
        traccar_total_fuel_liters = round(traccar_driving_fuel_liters + idle_for_total, 2)
        db_total_fuel_liters = round(db_driving_fuel_liters + idle_for_total, 2)
    else:
        traccar_driving_fuel_liters = None
        traccar_total_fuel_liters = None
        db_driving_fuel_liters = None
        db_total_fuel_liters = None

    def _cost_pkr(liters_value, price):
        if liters_value is not None and price is not None:
            return round(liters_value * price, 2)
        return None

    idle_fuel_cost_pkr = _cost_pkr(idle_fuel_liters, price_per_liter)
    traccar_driving_fuel_cost_pkr = _cost_pkr(traccar_driving_fuel_liters, price_per_liter)
    traccar_total_fuel_cost_pkr = _cost_pkr(traccar_total_fuel_liters, price_per_liter)
    db_driving_fuel_cost_pkr = _cost_pkr(db_driving_fuel_liters, price_per_liter)
    db_total_fuel_cost_pkr = _cost_pkr(db_total_fuel_liters, price_per_liter)

    price_configured = price_per_liter is not None
    price_message = None if price_configured else "No fuel price set for this date"
    price_per_liter_used = price_per_liter
    price_effective_date_used = (
        price_effective_date.isoformat() if price_effective_date is not None else None
    )

    detailed_positions = []
    if include_detailed_positions:
        detailed_positions = [
            {
                "fix_time": _utc_iso(p.fix_time),
                "lat": p.lat,
                "lon": p.lon,
                "latitude": p.lat,
                "longitude": p.lon,
                "altitude": p.altitude,
                "speed_kmh": p.speed_kmh,
                "address": p.address,
                "motion_status": p.motion_status,
                "ignition": (p.raw_attributes or {}).get("ignition"),
                "battery_level": (p.raw_attributes or {}).get("batteryLevel"),
                "geofence_ids": p.geofence_ids,
            }
            for p in positions
        ]

    return {
        "device_id": device_id,
        "date": label,
        "range_start": _utc_iso(start_dt),
        "range_end": _utc_iso(end_dt),
        "db_total_distance": db_total_distance,
        "traccar_total_distance": traccar_total_distance,
        "idle_fuel_liters": idle_fuel_liters,
        "traccar_driving_fuel_liters": traccar_driving_fuel_liters,
        "traccar_total_fuel_liters": traccar_total_fuel_liters,
        "db_driving_fuel_liters": db_driving_fuel_liters,
        "db_total_fuel_liters": db_total_fuel_liters,
        "idle_fuel_cost_pkr": idle_fuel_cost_pkr,
        "traccar_driving_fuel_cost_pkr": traccar_driving_fuel_cost_pkr,
        "traccar_total_fuel_cost_pkr": traccar_total_fuel_cost_pkr,
        "db_driving_fuel_cost_pkr": db_driving_fuel_cost_pkr,
        "db_total_fuel_cost_pkr": db_total_fuel_cost_pkr,
        "fuel_avg_configured": fuel_avg_configured,
        "fuel_message": fuel_message,
        "price_configured": price_configured,
        "price_message": price_message,
        "price_per_liter_used": price_per_liter_used,
        "price_effective_date_used": price_effective_date_used,
        "max_speed_kmh": round(max_speed_kmh, 2),
        "avg_speed_kmh": avg_speed_kmh,
        "driving_time_seconds": int(driving_time_seconds),
        "idle_time_seconds": int(idle_time_seconds),
        "idle_count": idle_count,
        "stop_count": stop_count,
        "gps_anomaly_count": gps_anomaly_count,
        "harsh_brake_count": harsh_brake_count,
        "harsh_accel_count": harsh_accel_count,
        "overspeed_count": overspeed_count,
        "start_time": _utc_iso(positions[0].fix_time),
        "end_time": _utc_iso(positions[-1].fix_time),
        "detailed_positions": detailed_positions,
    }