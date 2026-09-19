"""Unit tests for dashboard Fleet Trends bucketing (no live MySQL)."""

from datetime import datetime

from tracker_backend.services.dashboard_trends import (
    PKT,
    aggregate_maintenance_rows,
    aggregate_trip_rows,
    empty_maintenance_points,
    empty_trend_points,
)


def test_empty_month_has_30_points():
    points = empty_trend_points("month")
    assert len(points) == 30
    assert points[0]["distance"] == 0
    assert points[-1]["key"] == datetime.now(PKT).date().isoformat()


def test_day_buckets_are_24_hours():
    points = empty_trend_points("day")
    assert len(points) == 24
    assert points[0]["key"] == "h-0"
    assert points[15]["label"] == "3 PM"


def test_aggregate_sums_into_pkt_day_bucket():
    today_pkt = datetime.now(PKT).date()
    # 10:00 naive UTC -> 15:00 PKT, same calendar day
    start = datetime(today_pkt.year, today_pkt.month, today_pkt.day, 10, 0, 0)
    points = aggregate_trip_rows(
        [
            (start, 12.34, 1.25, 340.8),
            (start, 7.66, 0.75, 59.2),
        ],
        "month",
    )
    last = points[-1]
    assert last["distance"] == 20.0
    assert last["fuelLiters"] == 2.0
    assert last["fuelCost"] == 400


def test_empty_maintenance_month_has_30_points():
    points = empty_maintenance_points("month")
    assert len(points) == 30
    assert points[0]["visits"] == 0
    assert points[-1]["key"] == datetime.now(PKT).date().isoformat()


def test_aggregate_maintenance_sums_visits_and_cost():
    today = datetime.now(PKT).date()
    points = aggregate_maintenance_rows(
        [
            (today, 1500.4),
            (today, 499.6),
        ],
        "month",
    )
    last = points[-1]
    assert last["visits"] == 2
    assert last["cost"] == 2000


def test_alltime_trips_bucket_by_month():
    today = datetime.now(PKT).date()
    this_month = datetime(today.year, today.month, 10, 10, 0, 0)
    if today.month == 1:
        prev = datetime(today.year - 1, 12, 15, 10, 0, 0)
    else:
        prev = datetime(today.year, today.month - 1, 15, 10, 0, 0)
    points = aggregate_trip_rows(
        [
            (prev, 10, 1, 100),
            (this_month, 5, 2, 50),
        ],
        "alltime",
    )
    assert len(points) >= 2
    assert points[-1]["distance"] == 5.0
    assert points[-1]["fuelCost"] == 50
    assert points[-2]["distance"] == 10.0


def test_alltime_maintenance_bucket_by_month():
    today = datetime.now(PKT).date()
    this_month = today.replace(day=min(today.day, 28))
    if today.month == 1:
        prev = today.replace(year=today.year - 1, month=12, day=15)
    else:
        prev = today.replace(month=today.month - 1, day=15)
    points = aggregate_maintenance_rows(
        [
            (prev, 200),
            (this_month, 300),
            (this_month, 50),
        ],
        "alltime",
    )
    assert len(points) >= 2
    assert points[-1]["visits"] == 2
    assert points[-1]["cost"] == 350
    assert points[-2]["visits"] == 1
    assert points[-2]["cost"] == 200
