"""
Tests for recompute_all_route_matches() and the lookback_days=None extension
to backfill_route_matches().

These tests use an in-memory SQLite database so they are fully self-contained
(no live MySQL / Traccar required). The ORM models are a minimal subset of the
real schema — only the columns actually read by route_matcher.py — so we don't
need to duplicate every column from models.py.

Run with: python -m pytest tests/test_recompute_route_matches.py -v
(from the `backend` folder)
"""

from __future__ import annotations

import math
from datetime import datetime, date

import pytest
from sqlalchemy import (
    Boolean, Column, DateTime, Date, Float, Integer, JSON, String, create_engine,
)
from sqlalchemy.orm import DeclarativeBase, Session

# ─── Minimal in-memory ORM ────────────────────────────────────────────────────

class Base(DeclarativeBase):
    pass


class FakeDevice(Base):
    __tablename__ = "devices"
    id = Column(Integer, primary_key=True)
    name = Column(String(120), nullable=False)


class FakeRoute(Base):
    __tablename__ = "routes"
    id = Column(Integer, primary_key=True)
    name = Column(String(120), nullable=False)
    path = Column(JSON, nullable=False)
    tolerance_meters = Column(Float, nullable=False, default=400)


class FakeRouteVehicle(Base):
    __tablename__ = "route_vehicles"
    id = Column(Integer, primary_key=True)
    route_id = Column(Integer, nullable=False)
    device_id = Column(Integer, nullable=False)
    start_time = Column(DateTime, nullable=True)
    end_time = Column(DateTime, nullable=True)


class FakeTrip(Base):
    __tablename__ = "trips"
    id = Column(Integer, primary_key=True)
    device_id = Column(Integer, nullable=False)
    status = Column(String(20), nullable=False)
    start_time = Column(DateTime, nullable=False)
    end_time = Column(DateTime, nullable=True)
    geofence_id = Column(Integer, nullable=True)
    trip_date = Column(Date, nullable=True)
    trip_number = Column(Integer, nullable=True)
    start_lat = Column(Float, nullable=True)
    start_lon = Column(Float, nullable=True)
    confirmed_route_id = Column(Integer, nullable=True)


class FakeDevicePosition(Base):
    __tablename__ = "device_positions"
    id = Column(Integer, primary_key=True)
    device_id = Column(Integer, nullable=False)
    lat = Column(Float, nullable=False)
    lon = Column(Float, nullable=False)
    fix_time = Column(DateTime, nullable=False)
    motion_status = Column(String(20), nullable=False, default="stopped")
    is_gps_anomaly = Column(Boolean, nullable=False, default=False)


class FakeTripRouteMatch(Base):
    __tablename__ = "trip_route_matches"
    id = Column(Integer, primary_key=True)
    trip_id = Column(Integer, nullable=False)
    route_id = Column(Integer, nullable=False)
    match_percent = Column(Float, nullable=False)
    deviation_segments = Column(JSON, nullable=True)
    leg_start_index = Column(Integer, nullable=True)
    leg_end_index = Column(Integer, nullable=True)


class FakeDeviceAlert(Base):
    __tablename__ = "device_alerts"
    id = Column(Integer, primary_key=True)
    device_id = Column(Integer, nullable=False)
    alert_type = Column(String(50), nullable=False)
    message = Column(String(255))
    is_resolved = Column(Boolean, nullable=False, default=False)
    severity = Column(String(20), nullable=False, default="warning")
    triggered_at = Column(DateTime, nullable=True)
    resolved_at = Column(DateTime, nullable=True)


# ─── Helpers ──────────────────────────────────────────────────────────────────

def _make_engine_and_patch():
    """Return an in-memory SQLite engine and monkey-patch the ORM classes used
    inside route_matcher to point at our Fake* equivalents."""
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)

    import tracker_backend.services.route_matcher as rm
    import tracker_backend.services.alert_monitor as am

    # Redirect the model references used by match_trip_to_routes /
    # recompute_all_route_matches to our minimal in-memory versions.
    rm.Device = FakeDevice                        # type: ignore[attr-defined]
    rm.DevicePosition = FakeDevicePosition        # type: ignore[attr-defined]
    rm.Route = FakeRoute                          # type: ignore[attr-defined]
    rm.RouteVehicle = FakeRouteVehicle            # type: ignore[attr-defined]
    rm.Trip = FakeTrip                            # type: ignore[attr-defined]
    rm.TripRouteMatch = FakeTripRouteMatch        # type: ignore[attr-defined]

    # Silence alert_monitor so tests don't need the alerts table to be real.
    am._raise_alert = lambda *a, **kw: None       # type: ignore[attr-defined]
    am._resolve_alert = lambda *a, **kw: None     # type: ignore[attr-defined]

    return engine


def _db_session(engine) -> Session:
    return Session(engine)


T0 = datetime(2024, 1, 10, 8, 0, 0)
T1 = datetime(2024, 1, 10, 9, 0, 0)
ASSIGN_START = datetime(2024, 1, 1, 0, 0, 0)


def _seed_straight_highway_scenario(db: Session):
    """Two routes, two devices, one trip each.

    Route A — east-west highway (two far-apart vertices at lat=31.0):
        vertex 0: (31.0, 74.0)
        vertex 1: (31.0, 74.1)   ← ~9.5 km gap

    Route B — north-south road (two far-apart vertices at lon=74.0):
        vertex 0: (31.0,  74.0)
        vertex 1: (31.05, 74.0)  ← ~5.5 km gap

    Device 1 is on Route A; Device 2 is on Route B.

    Trip 1 (Device 1): all GPS fixes sit on the midpoint of Route A's segment,
        so they are ~0 m from the polyline and must be counted on-route.

    Trip 2 (Device 2): all GPS fixes sit on the midpoint of Route B's segment,
        ~0 m from the polyline, on-route.

    Stale TripRouteMatch rows (simulating the old vertex-only bug) claim
    match_percent=0.0 (wrongly decided the trip was entirely off-route).
    """
    device1 = FakeDevice(id=1, name="Bus-1")
    device2 = FakeDevice(id=2, name="Bus-2")
    db.add_all([device1, device2])

    route_a = FakeRoute(
        id=1, name="Highway A",
        path=[{"lat": 31.0, "lon": 74.0}, {"lat": 31.0, "lon": 74.1}],
        tolerance_meters=100,
    )
    route_b = FakeRoute(
        id=2, name="Road B",
        path=[{"lat": 31.0, "lon": 74.0}, {"lat": 31.05, "lon": 74.0}],
        tolerance_meters=100,
    )
    db.add_all([route_a, route_b])

    db.add(FakeRouteVehicle(id=1, route_id=1, device_id=1, start_time=ASSIGN_START, end_time=None))
    db.add(FakeRouteVehicle(id=2, route_id=2, device_id=2, start_time=ASSIGN_START, end_time=None))

    trip1 = FakeTrip(
        id=1, device_id=1, status="completed",
        start_time=T0, end_time=T1,
        trip_date=date(2024, 1, 10), trip_number=1,
        start_lat=31.0, start_lon=74.05,
    )
    trip2 = FakeTrip(
        id=2, device_id=2, status="completed",
        start_time=T0, end_time=T1,
        trip_date=date(2024, 1, 10), trip_number=1,
        start_lat=31.025, start_lon=74.0,
    )
    db.add_all([trip1, trip2])

    # GPS positions — mid-segment fixes only, verified on-route by segment math.
    mid_a = [(31.0, 74.05), (31.0, 74.05), (31.0, 74.055)]
    mid_b = [(31.025, 74.0), (31.025, 74.0), (31.025, 74.001)]
    ts_minute_offsets = [0, 1, 2]

    for i, ((lat, lon), minute) in enumerate(zip(mid_a, ts_minute_offsets)):
        db.add(FakeDevicePosition(
            id=100 + i, device_id=1, lat=lat, lon=lon,
            fix_time=datetime(2024, 1, 10, 8, minute, 0),
        ))
    for i, ((lat, lon), minute) in enumerate(zip(mid_b, ts_minute_offsets)):
        db.add(FakeDevicePosition(
            id=200 + i, device_id=2, lat=lat, lon=lon,
            fix_time=datetime(2024, 1, 10, 8, minute, 0),
        ))

    # Stale (wrong) TripRouteMatch rows — vertex-based bug said 0% match.
    db.add(FakeTripRouteMatch(
        id=1, trip_id=1, route_id=1, match_percent=0.0,
        deviation_segments=[], leg_start_index=None, leg_end_index=None,
    ))
    db.add(FakeTripRouteMatch(
        id=2, trip_id=2, route_id=2, match_percent=0.0,
        deviation_segments=[], leg_start_index=None, leg_end_index=None,
    ))
    db.commit()


# ─── Tests ────────────────────────────────────────────────────────────────────

@pytest.fixture()
def db_with_data():
    engine = _make_engine_and_patch()
    db = _db_session(engine)
    _seed_straight_highway_scenario(db)
    yield db
    db.close()


def test_recompute_overwrites_stale_rows(db_with_data):
    """recompute_all_route_matches must replace stale 0% rows with correct values."""
    from tracker_backend.services import route_matcher

    # Confirm stale state is present before running.
    before = db_with_data.query(FakeTripRouteMatch).all()
    assert all(m.match_percent == 0.0 for m in before), "precondition: stale rows should be 0%"

    summary = route_matcher.recompute_all_route_matches(db_with_data)

    assert summary["routes_processed"] == 2
    assert summary["trips_attempted"] >= 2
    assert summary["failures"] == 0

    after = db_with_data.query(FakeTripRouteMatch).all()
    # Both trips are fully on-route — match_percent must be well above threshold.
    for match in after:
        assert match.match_percent >= 60.0, (
            f"trip_id={match.trip_id} route_id={match.route_id} "
            f"still has low match_percent={match.match_percent}"
        )


def test_recompute_is_idempotent(db_with_data):
    """Running the recompute twice produces the same result."""
    from tracker_backend.services import route_matcher

    route_matcher.recompute_all_route_matches(db_with_data)
    after_first = {
        (m.trip_id, m.route_id): m.match_percent
        for m in db_with_data.query(FakeTripRouteMatch).all()
    }

    route_matcher.recompute_all_route_matches(db_with_data)
    after_second = {
        (m.trip_id, m.route_id): m.match_percent
        for m in db_with_data.query(FakeTripRouteMatch).all()
    }

    assert after_first == after_second, "Second recompute produced different results"


def test_recompute_covers_multiple_routes_and_devices(db_with_data):
    """Both routes / devices have their matches updated — not just the first."""
    from tracker_backend.services import route_matcher

    route_matcher.recompute_all_route_matches(db_with_data)

    matches = {
        m.trip_id: m
        for m in db_with_data.query(FakeTripRouteMatch).all()
    }
    assert 1 in matches, "Trip 1 (Device 1, Route A) should have a match"
    assert 2 in matches, "Trip 2 (Device 2, Route B) should have a match"
    assert matches[1].match_percent >= 60.0
    assert matches[2].match_percent >= 60.0


def test_backfill_route_matches_unbounded_covers_old_trips(db_with_data):
    """backfill_route_matches(lookback_days=None) must cover trips of any age."""
    from tracker_backend.services import route_matcher

    route_a = db_with_data.query(FakeRoute).filter(FakeRoute.id == 1).first()

    # Verify stale state.
    match_before = (
        db_with_data.query(FakeTripRouteMatch)
        .filter(FakeTripRouteMatch.trip_id == 1)
        .first()
    )
    assert match_before is not None and match_before.match_percent == 0.0

    # Call with no cutoff.
    route_matcher.backfill_route_matches(db_with_data, route_a, lookback_days=None)

    match_after = (
        db_with_data.query(FakeTripRouteMatch)
        .filter(FakeTripRouteMatch.trip_id == 1)
        .first()
    )
    assert match_after is not None
    assert match_after.match_percent >= 60.0


def test_backfill_route_matches_default_90_day_unchanged():
    """lookback_days=90 remains the default — calling without it must still work."""
    import inspect
    from tracker_backend.services import route_matcher

    sig = inspect.signature(route_matcher.backfill_route_matches)
    default = sig.parameters["lookback_days"].default
    assert default == 90, f"Expected default lookback_days=90, got {default!r}"


def test_recompute_dedupes_trips_when_device_on_multiple_routes(db_with_data):
    """A device with a historical assignment to a second route must not
    cause match_trip_to_routes to run twice for the same trip during a
    full recompute.
    """
    from unittest.mock import patch
    from tracker_backend.services import route_matcher

    # Closed historical assignment: Device 1 used to also be on Route B.
    db_with_data.add(FakeRouteVehicle(
        id=3, route_id=2, device_id=1, start_time=ASSIGN_START, end_time=T0,
    ))
    db_with_data.commit()

    call_trip_ids: list[int] = []
    real_match = route_matcher.match_trip_to_routes

    def tracking_match(db, trip):
        call_trip_ids.append(trip.id)
        return real_match(db, trip)

    with patch.object(route_matcher, "match_trip_to_routes", side_effect=tracking_match):
        summary = route_matcher.recompute_all_route_matches(db_with_data)

    # Trip 1 belongs to Device 1 (now on both routes); Trip 2 to Device 2
    # (Route B only). Each must appear exactly once.
    assert call_trip_ids.count(1) == 1, (
        f"Trip 1 rematched {call_trip_ids.count(1)} times; expected 1"
    )
    assert call_trip_ids.count(2) == 1, (
        f"Trip 2 rematched {call_trip_ids.count(2)} times; expected 1"
    )
    assert summary["trips_attempted"] == 2
    assert summary["failures"] == 0


def test_recompute_delegates_to_backfill(db_with_data):
    """Full recompute must call backfill_route_matches once per route
    with lookback_days=None — not a separate trip-fetch loop."""
    from unittest.mock import patch
    from tracker_backend.services import route_matcher

    calls: list[dict] = []
    real_backfill = route_matcher.backfill_route_matches

    def tracking_backfill(db, route, device_ids=None, lookback_days=90, seen_trip_ids=None):
        calls.append({
            "route_id": route.id,
            "lookback_days": lookback_days,
            "seen_trip_ids_is_set": isinstance(seen_trip_ids, set),
        })
        return real_backfill(
            db, route,
            device_ids=device_ids,
            lookback_days=lookback_days,
            seen_trip_ids=seen_trip_ids,
        )

    with patch.object(route_matcher, "backfill_route_matches", side_effect=tracking_backfill):
        route_matcher.recompute_all_route_matches(db_with_data)

    assert len(calls) == 2
    assert all(c["lookback_days"] is None for c in calls)
    assert all(c["seen_trip_ids_is_set"] for c in calls)
    assert {c["route_id"] for c in calls} == {1, 2}


def test_recompute_logs_per_route_progress(db_with_data, caplog):
    """Full recompute must emit INFO progress after each route finishes."""
    import logging
    from tracker_backend.services import route_matcher

    with caplog.at_level(logging.INFO, logger="route_matcher"):
        route_matcher.recompute_all_route_matches(db_with_data)

    finished = [r for r in caplog.records if r.message.startswith("Finished route")]
    assert len(finished) == 2, (
        f"expected one Finished-route log per route; got {len(finished)}: "
        f"{[r.message for r in finished]}"
    )
    assert any("Highway A" in r.message and "id=1" in r.message for r in finished)
    assert any("Road B" in r.message and "id=2" in r.message for r in finished)
    assert any("trips processed so far" in r.message for r in finished)
    assert any(
        r.message.startswith("recompute_all_route_matches complete")
        for r in caplog.records
    )


def test_match_uses_assigned_at_start_not_later_assignment(db_with_data):
    """A later current assignment must not change matching for an older trip."""
    from tracker_backend.services import route_matcher

    current = (
        db_with_data.query(FakeRouteVehicle)
        .filter(FakeRouteVehicle.device_id == 1, FakeRouteVehicle.end_time.is_(None))
        .first()
    )
    current.end_time = T1
    db_with_data.add(FakeRouteVehicle(
        id=4, route_id=2, device_id=1, start_time=T1, end_time=None,
    ))
    db_with_data.commit()

    trip = db_with_data.query(FakeTrip).filter(FakeTrip.id == 1).first()
    route_matcher.match_trip_to_routes(db_with_data, trip)

    matches = db_with_data.query(FakeTripRouteMatch).filter(FakeTripRouteMatch.trip_id == 1).all()
    assert len(matches) == 1
    assert matches[0].route_id == 1
    assert matches[0].match_percent >= 60.0


def test_match_uses_confirmed_route_over_assignment(db_with_data):
    """confirmed_route_id wins even when the assigned-at-start route differs."""
    from tracker_backend.services import route_matcher

    trip = db_with_data.query(FakeTrip).filter(FakeTrip.id == 1).first()
    trip.confirmed_route_id = 2
    db_with_data.commit()

    route_matcher.match_trip_to_routes(db_with_data, trip)

    matches = db_with_data.query(FakeTripRouteMatch).filter(FakeTripRouteMatch.trip_id == 1).all()
    assert all(row.route_id == 2 for row in matches)
    assert not any(row.route_id == 1 for row in matches)
