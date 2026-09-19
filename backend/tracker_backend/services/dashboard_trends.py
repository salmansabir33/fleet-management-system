"""Fleet trend series for the admin/manager dashboard chart.

The dashboard used to fetch GET /api/trips for the whole lookback window
and aggregate in the browser. That endpoint recalculates GPS metrics and
resolves drivers for every trip, so Last 30 Days stayed empty for a long
time. This module reads only the stored metric columns and returns the
already-bucketed points the chart needs.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

from sqlalchemy.orm import Session

from tracker_backend.models import MaintenanceRecord, Trip

# Pakistan does not observe DST; match frontend pktTime.js (fixed UTC+5).
PKT = timezone(timedelta(hours=5))


def _to_pkt(utc_dt: datetime | None) -> datetime | None:
    if utc_dt is None:
        return None
    if utc_dt.tzinfo is None:
        utc_dt = utc_dt.replace(tzinfo=timezone.utc)
    return utc_dt.astimezone(PKT)


TREND_PERIOD_DAYS = {
    "day": 1,
    "3days": 3,
    "week": 7,
    "month": 30,
    "alltime": 0,
}


def _hour_label(hour: int) -> str:
    if hour == 0:
        return "12 AM"
    if hour < 12:
        return f"{hour} AM"
    if hour == 12:
        return "12 PM"
    return f"{hour - 12} PM"


def _day_label(pkt_date) -> str:
    return f"{pkt_date.strftime('%a')} {pkt_date.day}"


def _month_key(year: int, month: int) -> str:
    return f"{year:04d}-{month:02d}"


def _month_label(year: int, month: int) -> str:
    return datetime(year, month, 1).strftime("%b %Y")


def _iter_months(start, end):
    """Yield (year, month) from start date through end date, inclusive."""
    year, month = start.year, start.month
    while (year, month) <= (end.year, end.month):
        yield year, month
        if month == 12:
            year += 1
            month = 1
        else:
            month += 1


def empty_trend_points(period: str) -> list[dict]:
    """Zero-filled buckets matching the chart x-axis for `period`."""
    now_pkt = datetime.now(PKT)
    if period == "day":
        return [
            {
                "key": f"h-{hour}",
                "label": _hour_label(hour),
                "distance": 0.0,
                "fuelLiters": 0.0,
                "fuelCost": 0.0,
            }
            for hour in range(24)
        ]

    days = TREND_PERIOD_DAYS.get(period, 30)
    if not days:
        return []
    points = []
    today = now_pkt.date()
    for offset in range(days - 1, -1, -1):
        day = today - timedelta(days=offset)
        points.append({
            "key": day.isoformat(),
            "label": _day_label(day),
            "distance": 0.0,
            "fuelLiters": 0.0,
            "fuelCost": 0.0,
        })
    return points


def _empty_month_trend_points(start, end) -> list[dict]:
    return [
        {
            "key": _month_key(year, month),
            "label": _month_label(year, month),
            "distance": 0.0,
            "fuelLiters": 0.0,
            "fuelCost": 0.0,
        }
        for year, month in _iter_months(start, end)
    ]


def _public_points(points: list[dict]) -> list[dict]:
    return [
        {
            "label": point["label"],
            "distance": round(point["distance"], 1),
            "fuelLiters": round(point["fuelLiters"], 1),
            "fuelCost": round(point["fuelCost"]),
        }
        for point in points
    ]


def _trip_bucket_key(period: str, pkt: datetime) -> str:
    if period == "day":
        return f"h-{pkt.hour}"
    if period == "alltime":
        return _month_key(pkt.year, pkt.month)
    return pkt.date().isoformat()


def aggregate_trip_rows(rows, period: str) -> list[dict]:
    """Fold (start_time, distance, fuel_liters, fuel_cost) rows into chart buckets."""
    if period == "alltime":
        parsed = []
        for start_time, distance_km, fuel_liters, fuel_cost in rows:
            if start_time is None:
                continue
            pkt = _to_pkt(start_time)
            if pkt is None:
                continue
            parsed.append((pkt, distance_km, fuel_liters, fuel_cost))
        if not parsed:
            return []
        start = min(item[0].date().replace(day=1) for item in parsed)
        end = datetime.now(PKT).date().replace(day=1)
        points = _empty_month_trend_points(start, end)
    else:
        points = empty_trend_points(period)
        parsed = []
        for start_time, distance_km, fuel_liters, fuel_cost in rows:
            if start_time is None:
                continue
            pkt = _to_pkt(start_time)
            if pkt is None:
                continue
            parsed.append((pkt, distance_km, fuel_liters, fuel_cost))

    bucket_map = {point["key"]: point for point in points}
    for pkt, distance_km, fuel_liters, fuel_cost in parsed:
        bucket = bucket_map.get(_trip_bucket_key(period, pkt))
        if bucket is None:
            continue
        bucket["distance"] += float(distance_km or 0)
        bucket["fuelLiters"] += float(fuel_liters or 0)
        bucket["fuelCost"] += float(fuel_cost or 0)

    return _public_points(points)


def get_dashboard_trend_points(
    db: Session,
    period: str,
    device_ids: list[int] | None = None,
) -> list[dict]:
    """SQL-lite read of stored trip metrics, then bucket in Pakistan time."""
    if period not in TREND_PERIOD_DAYS:
        period = "month"

    today = datetime.now(PKT).date()

    if device_ids is not None and not device_ids:
        return [] if period == "alltime" else _public_points(empty_trend_points(period))

    query = db.query(
        Trip.start_time,
        Trip.distance_km,
        Trip.total_fuel_liters,
        Trip.fuel_cost_pkr,
    ).filter(Trip.trip_date <= today)
    if period != "alltime":
        start_date = today - timedelta(days=TREND_PERIOD_DAYS[period] - 1)
        query = query.filter(Trip.trip_date >= start_date)
    if device_ids is not None:
        query = query.filter(Trip.device_id.in_(device_ids))

    return aggregate_trip_rows(query.all(), period)


def empty_maintenance_points(period: str) -> list[dict]:
    """Daily buckets for maintenance visits/cost. `day` is a single today bar
    because records only store a calendar date, not a time."""
    now_pkt = datetime.now(PKT)
    today = now_pkt.date()
    days = TREND_PERIOD_DAYS.get(period, 30)
    if not days:
        return []
    points = []
    for offset in range(days - 1, -1, -1):
        day = today - timedelta(days=offset)
        points.append({
            "key": day.isoformat(),
            "label": _day_label(day),
            "visits": 0,
            "cost": 0.0,
        })
    return points


def _empty_month_maintenance_points(start, end) -> list[dict]:
    return [
        {
            "key": _month_key(year, month),
            "label": _month_label(year, month),
            "visits": 0,
            "cost": 0.0,
        }
        for year, month in _iter_months(start, end)
    ]


def _public_maintenance_points(points: list[dict]) -> list[dict]:
    return [
        {
            "label": point["label"],
            "visits": int(point["visits"]),
            "cost": round(point["cost"]),
        }
        for point in points
    ]


def aggregate_maintenance_rows(rows, period: str) -> list[dict]:
    """Fold (record_date, total_cost) rows into visit/cost buckets."""
    dated = []
    for record_date, total_cost in rows:
        if record_date is None:
            continue
        dated.append((record_date, total_cost))

    if period == "alltime":
        if not dated:
            return []
        start = min(item[0].replace(day=1) for item in dated)
        end = datetime.now(PKT).date().replace(day=1)
        points = _empty_month_maintenance_points(start, end)
        bucket_map = {point["key"]: point for point in points}
        for record_date, total_cost in dated:
            bucket = bucket_map.get(_month_key(record_date.year, record_date.month))
            if bucket is None:
                continue
            bucket["visits"] += 1
            bucket["cost"] += float(total_cost or 0)
        return _public_maintenance_points(points)

    points = empty_maintenance_points(period)
    bucket_map = {point["key"]: point for point in points}
    for record_date, total_cost in dated:
        key = record_date.isoformat() if hasattr(record_date, "isoformat") else str(record_date)
        bucket = bucket_map.get(key)
        if bucket is None:
            continue
        bucket["visits"] += 1
        bucket["cost"] += float(total_cost or 0)

    return _public_maintenance_points(points)


def get_dashboard_maintenance_points(
    db: Session,
    period: str,
    device_ids: list[int] | None = None,
) -> list[dict]:
    """Count non-baseline visits and sum cost per day (or month for all-time)."""
    if period not in TREND_PERIOD_DAYS:
        period = "month"

    today = datetime.now(PKT).date()

    if device_ids is not None and not device_ids:
        return [] if period == "alltime" else _public_maintenance_points(empty_maintenance_points(period))

    query = db.query(
        MaintenanceRecord.record_date,
        MaintenanceRecord.total_cost,
    ).filter(
        MaintenanceRecord.record_date <= today,
        MaintenanceRecord.is_baseline.is_(False),
    )
    if period != "alltime":
        start_date = today - timedelta(days=TREND_PERIOD_DAYS[period] - 1)
        query = query.filter(MaintenanceRecord.record_date >= start_date)
    if device_ids is not None:
        query = query.filter(MaintenanceRecord.device_id.in_(device_ids))

    return aggregate_maintenance_rows(query.all(), period)
