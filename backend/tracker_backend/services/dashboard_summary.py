"""Shared helpers for admin/manager dashboard summary aggregates."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

from sqlalchemy.orm import Session

from tracker_backend.models import Device, Driver, DriverAssignment, Trip
from tracker_backend.services.dashboard_trends import PKT, TREND_PERIOD_DAYS
from tracker_backend.services.trip_tracker import (
    calculate_trip_metrics,
    get_trips_in_range_fleet_wide,
)


def today_window() -> tuple[datetime, datetime]:
    """Start/end of the current calendar day in Pakistan time (PKT)."""
    today = datetime.now(PKT).date()
    start_dt = datetime.combine(today, datetime.min.time())
    end_dt = start_dt + timedelta(days=1)
    return start_dt, end_dt


def period_window(period: str) -> tuple[datetime | None, datetime | None]:
    """PKT [start, end) for a dashboard period preset.

    `alltime` returns (None, None) so fleet-wide trip queries skip the time filter.
    Unknown periods fall back to today.
    """
    if period == "alltime":
        return None, None

    days = TREND_PERIOD_DAYS.get(period)
    if not days:
        return today_window()

    today = datetime.now(PKT).date()
    start_date = today - timedelta(days=days - 1)
    start_dt = datetime.combine(start_date, datetime.min.time())
    end_dt = datetime.combine(today, datetime.min.time()) + timedelta(days=1)
    return start_dt, end_dt


def period_window_utc(period: str) -> tuple[datetime | None, datetime | None]:
    """Same window as `period_window`, converted to naive UTC for DB timestamps."""
    start_dt, end_dt = period_window(period)
    if start_dt is None and end_dt is None:
        return None, None

    def to_naive_utc(pkt_naive: datetime) -> datetime:
        aware = pkt_naive.replace(tzinfo=PKT)
        return aware.astimezone(timezone.utc).replace(tzinfo=None)

    return (
        to_naive_utc(start_dt) if start_dt is not None else None,
        to_naive_utc(end_dt) if end_dt is not None else None,
    )


def count_assigned_driver_buckets(
    db: Session,
    device_ids: list[int] | None = None,
) -> tuple[int, int]:
    """Count active assigned drivers by whether their vehicle has an open trip.

    Returns (drivers_on_trip, drivers_available).
    """
    in_progress_query = (
        db.query(Trip.device_id)
        .filter(Trip.status == "in_progress")
        .distinct()
    )
    if device_ids is not None:
        if not device_ids:
            return 0, 0
        in_progress_query = in_progress_query.filter(Trip.device_id.in_(device_ids))

    in_progress_device_ids = {row[0] for row in in_progress_query.all()}

    assignment_query = (
        db.query(DriverAssignment.driver_id, DriverAssignment.device_id)
        .join(Driver, Driver.id == DriverAssignment.driver_id)
        .filter(
            DriverAssignment.end_time.is_(None),
            Driver.status == "active",
        )
    )
    if device_ids is not None:
        assignment_query = assignment_query.filter(
            DriverAssignment.device_id.in_(device_ids)
        )

    on_trip: set[int] = set()
    available: set[int] = set()
    for driver_id, device_id in assignment_query.all():
        if device_id in in_progress_device_ids:
            on_trip.add(driver_id)
        else:
            available.add(driver_id)

    return len(on_trip), len(available)


@dataclass
class TodayTripStats:
    trips_today: int
    trips_completed_today: int
    trips_ongoing_today: int
    trips_total_distance_km: float
    trips_total_fuel_cost_pkr: float
    trips_total_toll_cost_pkr: float
    trips_total_challan_cost_pkr: float
    trips_total_cost_pkr: float


def _sum_trip_metrics(trips: list[Trip]) -> TodayTripStats:
    trips_today = len(trips)
    trips_completed_today = sum(1 for t in trips if t.status == "completed")
    trips_ongoing_today = sum(1 for t in trips if t.status == "in_progress")

    distance = fuel = toll = challan = 0.0
    for trip in trips:
        distance += float(trip.distance_km or 0)
        fuel += float(trip.fuel_cost_pkr or 0)
        toll += float(trip.toll_tax_pkr or 0)
        challan += float(trip.challan_pkr or 0)

    trips_total_distance_km = round(distance, 2)
    trips_total_fuel_cost_pkr = round(fuel, 2)
    trips_total_toll_cost_pkr = round(toll, 2)
    trips_total_challan_cost_pkr = round(challan, 2)
    trips_total_cost_pkr = round(fuel + toll + challan, 2)

    return TodayTripStats(
        trips_today=trips_today,
        trips_completed_today=trips_completed_today,
        trips_ongoing_today=trips_ongoing_today,
        trips_total_distance_km=trips_total_distance_km,
        trips_total_fuel_cost_pkr=trips_total_fuel_cost_pkr,
        trips_total_toll_cost_pkr=trips_total_toll_cost_pkr,
        trips_total_challan_cost_pkr=trips_total_challan_cost_pkr,
        trips_total_cost_pkr=trips_total_cost_pkr,
    )


def aggregate_trips_for_period(
    db: Session,
    period: str = "day",
    device_ids: list[int] | None = None,
) -> TodayTripStats:
    """Trips overlapping the selected PKT period window, with live metrics for open trips."""
    if device_ids is not None and not device_ids:
        return TodayTripStats(0, 0, 0, 0.0, 0.0, 0.0, 0.0, 0.0)

    if period not in TREND_PERIOD_DAYS:
        period = "day"

    start_dt, end_dt = period_window(period)
    trips = get_trips_in_range_fleet_wide(db, start_dt, end_dt)

    if device_ids is not None:
        device_id_set = set(device_ids)
        trips = [trip for trip in trips if trip.device_id in device_id_set]

    open_trips = [trip for trip in trips if trip.status == "in_progress"]
    if open_trips:
        open_device_ids = {trip.device_id for trip in open_trips}
        devices_by_id = {
            device.id: device
            for device in db.query(Device).filter(Device.id.in_(open_device_ids)).all()
        }
        metrics_dirty = False
        for trip in open_trips:
            device = devices_by_id.get(trip.device_id)
            if device is None:
                continue
            calculate_trip_metrics(db, trip, device)
            metrics_dirty = True
        if metrics_dirty:
            db.commit()

    return _sum_trip_metrics(trips)


def aggregate_today_trips(
    db: Session,
    device_ids: list[int] | None = None,
) -> TodayTripStats:
    """Trips overlapping today's PKT window, with live metrics for open trips."""
    return aggregate_trips_for_period(db, period="day", device_ids=device_ids)
