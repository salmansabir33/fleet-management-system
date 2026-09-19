"""Unit tests for dashboard summary helpers (in-memory SQLite, no live MySQL)."""

from __future__ import annotations

from datetime import datetime, timedelta
from types import SimpleNamespace

import pytest
from sqlalchemy import Column, Date, DateTime, Float, Integer, String, create_engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from tracker_backend.services import dashboard_summary as ds
from tracker_backend.services import trip_tracker as tt
from tracker_backend.services.dashboard_trends import PKT


class Base(DeclarativeBase):
    pass


class FakeDevice(Base):
    __tablename__ = "devices"
    id = Column(Integer, primary_key=True)
    name = Column(String(120), nullable=False)


class FakeDriver(Base):
    __tablename__ = "drivers"
    id = Column(Integer, primary_key=True)
    name = Column(String(120), nullable=False)
    id_card_number = Column(String(15), unique=True, nullable=False)
    status = Column(String(20), nullable=False, default="active")


class FakeDriverAssignment(Base):
    __tablename__ = "driver_assignments"
    id = Column(Integer, primary_key=True)
    driver_id = Column(Integer, nullable=False)
    device_id = Column(Integer, nullable=False)
    start_time = Column(DateTime, nullable=False)
    end_time = Column(DateTime, nullable=True)


class FakeTrip(Base):
    __tablename__ = "trips"
    id = Column(Integer, primary_key=True)
    device_id = Column(Integer, nullable=False)
    geofence_id = Column(Integer, nullable=False, default=1)
    trip_date = Column(Date, nullable=False)
    trip_number = Column(Integer, nullable=False, default=1)
    status = Column(String(20), nullable=False)
    start_time = Column(DateTime, nullable=False)
    end_time = Column(DateTime, nullable=True)
    start_lat = Column(Float, nullable=False, default=0.0)
    start_lon = Column(Float, nullable=False, default=0.0)
    distance_km = Column(Float, nullable=True)
    fuel_cost_pkr = Column(Float, nullable=True)
    toll_tax_pkr = Column(Float, nullable=True)
    challan_pkr = Column(Float, nullable=True)


@pytest.fixture
def db(monkeypatch):
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    SessionLocal = sessionmaker(bind=engine)
    session = SessionLocal()

    monkeypatch.setattr(ds, "Driver", FakeDriver)
    monkeypatch.setattr(ds, "DriverAssignment", FakeDriverAssignment)
    monkeypatch.setattr(ds, "Trip", FakeTrip)
    monkeypatch.setattr(ds, "Device", FakeDevice)
    monkeypatch.setattr(tt, "Trip", FakeTrip)

    yield session
    session.close()


def _today_pkt():
    return datetime.now(PKT).date()


def _pkt_dt(year, month, day, hour=12, minute=0):
    return datetime(year, month, day, hour, minute)


def test_today_window_uses_pkt_calendar_day():
    start_dt, end_dt = ds.today_window()
    today = _today_pkt()
    assert start_dt.date() == today
    assert end_dt - start_dt == timedelta(days=1)


def test_period_window_week_spans_seven_pkt_days():
    start_dt, end_dt = ds.period_window("week")
    today = _today_pkt()
    assert start_dt.date() == today - timedelta(days=6)
    assert end_dt.date() == today + timedelta(days=1)
    assert end_dt - start_dt == timedelta(days=7)


def test_period_window_alltime_is_open_ended():
    start_dt, end_dt = ds.period_window("alltime")
    assert start_dt is None
    assert end_dt is None


def test_week_period_includes_yesterday_excludes_older(db: Session, monkeypatch):
    today = _today_pkt()
    yesterday = today - timedelta(days=1)
    older = today - timedelta(days=10)
    db.add(FakeDevice(id=10, name="Truck A"))
    db.add(
        FakeTrip(
            device_id=10,
            trip_date=yesterday,
            status="completed",
            start_time=_pkt_dt(yesterday.year, yesterday.month, yesterday.day, 10, 0),
            end_time=_pkt_dt(yesterday.year, yesterday.month, yesterday.day, 12, 0),
            distance_km=50,
            fuel_cost_pkr=1000,
        )
    )
    db.add(
        FakeTrip(
            device_id=10,
            trip_date=older,
            status="completed",
            start_time=_pkt_dt(older.year, older.month, older.day, 10, 0),
            end_time=_pkt_dt(older.year, older.month, older.day, 12, 0),
            distance_km=99,
            fuel_cost_pkr=9999,
        )
    )
    db.commit()
    monkeypatch.setattr(ds, "calculate_trip_metrics", lambda *a, **k: None)

    stats = ds.aggregate_trips_for_period(db, period="week")
    assert stats.trips_today == 1
    assert stats.trips_total_distance_km == 50.0
    assert stats.trips_total_fuel_cost_pkr == 1000.0


def test_sum_trip_metrics_totals():
    trips = [
        SimpleNamespace(
            status="completed",
            distance_km=10.5,
            fuel_cost_pkr=100,
            toll_tax_pkr=50,
            challan_pkr=25,
        ),
        SimpleNamespace(
            status="in_progress",
            distance_km=5,
            fuel_cost_pkr=40,
            toll_tax_pkr=None,
            challan_pkr=10,
        ),
    ]
    stats = ds._sum_trip_metrics(trips)
    assert stats.trips_today == 2
    assert stats.trips_completed_today == 1
    assert stats.trips_ongoing_today == 1
    assert stats.trips_total_distance_km == 15.5
    assert stats.trips_total_fuel_cost_pkr == 140.0
    assert stats.trips_total_toll_cost_pkr == 50.0
    assert stats.trips_total_challan_cost_pkr == 35.0
    assert stats.trips_total_cost_pkr == 225.0


def test_assigned_driver_available_when_no_open_trip(db: Session):
    db.add(FakeDriver(id=1, name="Ali", id_card_number="11111-1111111-1", status="active"))
    db.add(FakeDevice(id=10, name="Truck A"))
    db.add(
        FakeDriverAssignment(
            driver_id=1,
            device_id=10,
            start_time=datetime(2026, 1, 1, 8, 0),
            end_time=None,
        )
    )
    db.commit()

    on_trip, available = ds.count_assigned_driver_buckets(db)
    assert on_trip == 0
    assert available == 1


def test_assigned_driver_on_trip_when_vehicle_has_in_progress_trip(db: Session):
    today = _today_pkt()
    db.add(FakeDriver(id=1, name="Ali", id_card_number="11111-1111111-1", status="active"))
    db.add(FakeDevice(id=10, name="Truck A"))
    db.add(
        FakeDriverAssignment(
            driver_id=1,
            device_id=10,
            start_time=datetime(2026, 1, 1, 8, 0),
            end_time=None,
        )
    )
    db.add(
        FakeTrip(
            device_id=10,
            trip_date=today - timedelta(days=1),
            status="in_progress",
            start_time=_pkt_dt(today.year, today.month, today.day, 6, 0)
            - timedelta(days=1),
            end_time=None,
            fuel_cost_pkr=500,
        )
    )
    db.commit()

    on_trip, available = ds.count_assigned_driver_buckets(db)
    assert on_trip == 1
    assert available == 0


def test_cross_day_trip_ending_today_included_in_cost(db: Session, monkeypatch):
    today = _today_pkt()
    yesterday = today - timedelta(days=1)
    db.add(FakeDevice(id=10, name="Truck A"))
    db.add(
        FakeTrip(
            device_id=10,
            trip_date=yesterday,
            status="completed",
            start_time=_pkt_dt(yesterday.year, yesterday.month, yesterday.day, 22, 0),
            end_time=_pkt_dt(today.year, today.month, today.day, 2, 0),
            distance_km=120,
            fuel_cost_pkr=3000,
            toll_tax_pkr=200,
            challan_pkr=100,
        )
    )
    db.commit()
    monkeypatch.setattr(ds, "calculate_trip_metrics", lambda *args, **kwargs: None)

    stats = ds.aggregate_today_trips(db)
    assert stats.trips_today == 1
    assert stats.trips_completed_today == 1
    assert stats.trips_total_fuel_cost_pkr == 3000.0
    assert stats.trips_total_toll_cost_pkr == 200.0
    assert stats.trips_total_challan_cost_pkr == 100.0
    assert stats.trips_total_cost_pkr == 3300.0


def test_ongoing_trip_from_yesterday_included_with_full_cost(db: Session, monkeypatch):
    today = _today_pkt()
    yesterday = today - timedelta(days=1)
    trip = FakeTrip(
        device_id=10,
        trip_date=yesterday,
        status="in_progress",
        start_time=_pkt_dt(yesterday.year, yesterday.month, yesterday.day, 20, 0),
        end_time=None,
        distance_km=80,
        fuel_cost_pkr=1500,
        toll_tax_pkr=0,
        challan_pkr=50,
    )
    db.add(FakeDevice(id=10, name="Truck A"))
    db.add(trip)
    db.commit()
    monkeypatch.setattr(ds, "calculate_trip_metrics", lambda *a, **k: None)

    stats = ds.aggregate_today_trips(db)
    assert stats.trips_today == 1
    assert stats.trips_ongoing_today == 1
    assert stats.trips_total_fuel_cost_pkr == 1500.0
    assert stats.trips_total_cost_pkr == 1550.0


def test_trip_with_stale_trip_date_still_included_via_overlap(db: Session, monkeypatch):
    today = _today_pkt()
    yesterday = today - timedelta(days=1)
    db.add(FakeDevice(id=10, name="Truck A"))
    db.add(
        FakeTrip(
            device_id=10,
            trip_date=yesterday,
            status="completed",
            start_time=_pkt_dt(today.year, today.month, today.day, 9, 0),
            end_time=_pkt_dt(today.year, today.month, today.day, 11, 0),
            fuel_cost_pkr=400,
        )
    )
    db.commit()
    monkeypatch.setattr(ds, "calculate_trip_metrics", lambda *a, **k: None)

    stats = ds.aggregate_today_trips(db)
    assert stats.trips_today == 1
    assert stats.trips_total_fuel_cost_pkr == 400.0


def test_device_scope_filters_trips_and_drivers(db: Session, monkeypatch):
    today = _today_pkt()
    db.add(FakeDriver(id=1, name="Ali", id_card_number="11111-1111111-1", status="active"))
    db.add(FakeDriver(id=2, name="Sara", id_card_number="22222-2222222-2", status="active"))
    db.add(FakeDevice(id=10, name="Truck A"))
    db.add(FakeDevice(id=20, name="Truck B"))
    db.add(
        FakeDriverAssignment(
            driver_id=1, device_id=10,
            start_time=datetime(2026, 1, 1), end_time=None,
        )
    )
    db.add(
        FakeDriverAssignment(
            driver_id=2, device_id=20,
            start_time=datetime(2026, 1, 1), end_time=None,
        )
    )
    db.add(
        FakeTrip(
            device_id=10,
            trip_date=today,
            status="completed",
            start_time=_pkt_dt(today.year, today.month, today.day, 8, 0),
            end_time=_pkt_dt(today.year, today.month, today.day, 10, 0),
            fuel_cost_pkr=100,
        )
    )
    db.add(
        FakeTrip(
            device_id=20,
            trip_date=today,
            status="completed",
            start_time=_pkt_dt(today.year, today.month, today.day, 8, 0),
            end_time=_pkt_dt(today.year, today.month, today.day, 10, 0),
            fuel_cost_pkr=999,
        )
    )
    db.commit()
    monkeypatch.setattr(ds, "calculate_trip_metrics", lambda *a, **k: None)

    on_trip, available = ds.count_assigned_driver_buckets(db, device_ids=[10])
    assert on_trip == 0
    assert available == 1

    stats = ds.aggregate_today_trips(db, device_ids=[10])
    assert stats.trips_today == 1
    assert stats.trips_total_fuel_cost_pkr == 100.0


def test_empty_device_scope_returns_zeros(db: Session):
    stats = ds.aggregate_today_trips(db, device_ids=[])
    assert stats.trips_today == 0
    assert stats.trips_total_cost_pkr == 0.0

    on_trip, available = ds.count_assigned_driver_buckets(db, device_ids=[])
    assert on_trip == 0
    assert available == 0
