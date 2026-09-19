"""
Tests for one-route-per-vehicle assignment and per-trip route confirmation.

Uses an in-memory SQLite subset of the schema (same approach as
test_recompute_route_matches.py).

Run with: python -m pytest tests/test_route_assignment.py -v
(from the `backend` folder)
"""
from __future__ import annotations

from datetime import datetime, date

import pytest
from sqlalchemy import Boolean, Column, Date, DateTime, Float, Integer, JSON, String, create_engine
from sqlalchemy.orm import DeclarativeBase, Session


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
    path = Column(JSON, nullable=True)
    tolerance_meters = Column(Float, nullable=False, default=400)


class FakeRouteVehicle(Base):
    __tablename__ = "route_vehicles"
    id = Column(Integer, primary_key=True)
    route_id = Column(Integer, nullable=False)
    device_id = Column(Integer, nullable=False)
    start_time = Column(DateTime, nullable=False)
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
    route_confirmed_at = Column(DateTime, nullable=True)
    route_confirmed_by_user_id = Column(Integer, nullable=True)


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


T0 = datetime(2024, 1, 10, 8, 0, 0)
T1 = datetime(2024, 1, 10, 9, 0, 0)


@pytest.fixture()
def db():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    session = Session(engine)

    import tracker_backend.services.route_assignment_service as ras
    ras.Device = FakeDevice
    ras.Route = FakeRoute
    ras.RouteVehicle = FakeRouteVehicle
    ras.Trip = FakeTrip
    ras.DeviceAlert = FakeDeviceAlert

    session.add_all([
        FakeDevice(id=1, name="Bus-1"),
        FakeDevice(id=2, name="Bus-2"),
        FakeRoute(id=1, name="Highway A", path=[]),
        FakeRoute(id=2, name="Road B", path=[]),
    ])
    session.commit()
    yield session
    session.close()


def test_assign_is_one_open_route_per_vehicle(db):
    from tracker_backend.services import route_assignment_service as ras

    first, created = ras.assign_route(db, 1, 1, at_time=T0)
    assert created is True
    assert first.route_id == 1
    assert first.end_time is None

    second, created_again = ras.assign_route(db, 1, 1, at_time=T1)
    assert created_again is False
    assert second.id == first.id

    moved, created_move = ras.assign_route(db, 2, 1, at_time=T1)
    assert created_move is True
    assert moved.route_id == 2
    db.refresh(first)
    assert first.end_time == T1

    open_rows = db.query(FakeRouteVehicle).filter(FakeRouteVehicle.end_time.is_(None)).all()
    assert len(open_rows) == 1
    assert open_rows[0].route_id == 2
    assert open_rows[0].device_id == 1


def test_same_route_can_be_shared_across_vehicles(db):
    from tracker_backend.services import route_assignment_service as ras

    ras.assign_route(db, 1, 1, at_time=T0)
    ras.assign_route(db, 1, 2, at_time=T0)

    open_rows = (
        db.query(FakeRouteVehicle)
        .filter(FakeRouteVehicle.route_id == 1, FakeRouteVehicle.end_time.is_(None))
        .all()
    )
    assert {row.device_id for row in open_rows} == {1, 2}


def test_unassign_closes_only_matching_open_row(db):
    from tracker_backend.services import route_assignment_service as ras

    ras.assign_route(db, 1, 1, at_time=T0)
    missing = ras.unassign_route(db, 2, 1, at_time=T1)
    assert missing is None
    still_open = ras.get_active_assignment_for_device(db, 1)
    assert still_open is not None and still_open.route_id == 1

    closed = ras.unassign_route(db, 1, 1, at_time=T1)
    assert closed is not None
    assert closed.end_time == T1
    assert ras.get_active_assignment_for_device(db, 1) is None


def test_get_route_for_trip_uses_covering_assignment(db):
    from tracker_backend.services import route_assignment_service as ras

    ras.assign_route(db, 1, 1, at_time=datetime(2024, 1, 1))
    ras.assign_route(db, 2, 1, at_time=T1)

    during_first = ras.get_route_for_trip(db, 1, T0)
    after_move = ras.get_route_for_trip(db, 1, T1)
    assert during_first is not None and during_first.id == 1
    assert after_move is not None and after_move.id == 2


def test_confirm_trip_route_sets_fields_and_resolves_alert(db):
    from tracker_backend.services import route_assignment_service as ras

    trip = FakeTrip(
        id=1, device_id=1, status="in_progress",
        start_time=T0, trip_date=date(2024, 1, 10), trip_number=1,
        start_lat=31.0, start_lon=74.0,
    )
    db.add(trip)
    db.add(FakeDeviceAlert(
        id=1, device_id=1, alert_type=ras.TRIP_ROUTE_PENDING_ALERT,
        is_resolved=False, severity="info",
    ))
    db.commit()

    confirmed = ras.confirm_trip_route(db, trip, 2, confirmed_by_user_id=9, at_time=T1)
    assert confirmed.confirmed_route_id == 2
    assert confirmed.route_confirmed_at == T1
    assert confirmed.route_confirmed_by_user_id == 9

    alert = db.query(FakeDeviceAlert).filter(FakeDeviceAlert.id == 1).first()
    assert alert.is_resolved is True

    open_assignments = db.query(FakeRouteVehicle).filter(FakeRouteVehicle.end_time.is_(None)).all()
    assert open_assignments == []


WINDOW_START = datetime(2024, 1, 9, 0, 0, 0)
WINDOW_END = datetime(2024, 1, 12, 0, 0, 0)


def _completed_trip(db, trip_id, device_id, confirmed_route_id=None):
    trip = FakeTrip(
        id=trip_id,
        device_id=device_id,
        status="completed",
        start_time=T0,
        end_time=T1,
        trip_date=date(2024, 1, 10),
        trip_number=trip_id,
        start_lat=31.0,
        start_lon=74.0,
        confirmed_route_id=confirmed_route_id,
    )
    db.add(trip)
    db.commit()
    return trip


def test_pending_completed_trip_stays_on_default_route(db):
    from tracker_backend.services import route_assignment_service as ras

    ras.assign_route(db, 1, 1, at_time=T0)
    _completed_trip(db, 1, 1)

    assigned = ras.list_assigned_route_vehicle_trip_counts(db, 1, WINDOW_START, WINDOW_END)
    assert assigned == [{"device_id": 1, "vehicle_name": "Bus-1", "trip_count": 1}]
    assert ras.list_other_trips_for_route(db, 1, WINDOW_START, WINDOW_END) == []
    assert ras.list_assigned_route_vehicle_trip_counts(db, 2, WINDOW_START, WINDOW_END) == []
    assert ras.list_other_trips_for_route(db, 2, WINDOW_START, WINDOW_END) == []


def test_confirmed_elsewhere_moves_to_other_trips(db):
    from tracker_backend.services import route_assignment_service as ras

    ras.assign_route(db, 1, 1, at_time=T0)
    _completed_trip(db, 1, 1, confirmed_route_id=2)

    assert ras.list_assigned_route_vehicle_trip_counts(db, 1, WINDOW_START, WINDOW_END) == []
    assert ras.list_other_trips_for_route(db, 1, WINDOW_START, WINDOW_END) == []

    assert ras.list_assigned_route_vehicle_trip_counts(db, 2, WINDOW_START, WINDOW_END) == []
    other = ras.list_other_trips_for_route(db, 2, WINDOW_START, WINDOW_END)
    assert [trip.id for trip in other] == [1]
    assert other[0].device_id == 1


def test_confirmed_to_default_stays_under_assigned_vehicle(db):
    from tracker_backend.services import route_assignment_service as ras

    ras.assign_route(db, 1, 1, at_time=T0)
    _completed_trip(db, 1, 1, confirmed_route_id=1)

    assigned = ras.list_assigned_route_vehicle_trip_counts(db, 1, WINDOW_START, WINDOW_END)
    assert assigned == [{"device_id": 1, "vehicle_name": "Bus-1", "trip_count": 1}]
    assert ras.list_other_trips_for_route(db, 1, WINDOW_START, WINDOW_END) == []
    assert ras.list_other_trips_for_route(db, 2, WINDOW_START, WINDOW_END) == []
