"""
When an alert type is disabled via AlertTypeSetting, alert_monitor does
not create a new DeviceAlert row; re-enabling it resumes detection.

Uses an in-memory SQLite database (same approach as
test_recompute_route_matches.py) so this does not need live MySQL.

Run with: python -m pytest tests/test_alert_type_settings.py -v
(from the `backend` folder)
"""

from __future__ import annotations

from datetime import datetime, timedelta

import pytest
from sqlalchemy import Boolean, Column, DateTime, Float, Integer, JSON, String, create_engine
from sqlalchemy.orm import DeclarativeBase, Session
from sqlalchemy.pool import StaticPool


class Base(DeclarativeBase):
    pass


class FakeDevice(Base):
    __tablename__ = "devices"
    id = Column(Integer, primary_key=True)
    name = Column(String(120), nullable=False)
    speed_limit_kmh = Column(Float, nullable=True)
    harsh_brake_delta_kmh = Column(Float, nullable=True)
    harsh_accel_delta_kmh = Column(Float, nullable=True)
    primary_geofence_id = Column(Integer, nullable=True)


class FakeDevicePosition(Base):
    __tablename__ = "device_positions"
    id = Column(Integer, primary_key=True)
    device_id = Column(Integer, nullable=False)
    lat = Column(Float, nullable=False, default=31.52)
    lon = Column(Float, nullable=False, default=74.35)
    speed_kmh = Column(Float, nullable=True)
    fix_time = Column(DateTime, nullable=False)
    raw_attributes = Column(JSON, nullable=True)
    geofence_ids = Column(JSON, nullable=True)


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


class FakeAlertTypeSetting(Base):
    __tablename__ = "alert_type_settings"
    id = Column(Integer, primary_key=True)
    alert_type = Column(String(60), nullable=False, unique=True)
    is_enabled = Column(Boolean, nullable=False, default=True)
    updated_at = Column(DateTime, nullable=True)


@pytest.fixture
def alert_env(monkeypatch):
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)

    import tracker_backend.models as models
    import tracker_backend.services.alert_monitor as am
    import tracker_backend.services.cache as cache_mod

    monkeypatch.setattr(am, "Device", FakeDevice)
    monkeypatch.setattr(am, "DevicePosition", FakeDevicePosition)
    monkeypatch.setattr(am, "DeviceAlert", FakeDeviceAlert)
    monkeypatch.setattr(am, "SessionLocal", lambda: Session(engine))
    monkeypatch.setattr(am.driver_service, "get_live_driver_alert", lambda db, device_id: (None, None))
    monkeypatch.setattr(models, "AlertTypeSetting", FakeAlertTypeSetting)
    am._last_checked_position_id.clear()
    cache_mod.alert_type_settings_cache.enabled = {}

    return engine


def _seed_overspeed_device(db: Session, setting_enabled: bool) -> FakeDevice:
    device = FakeDevice(name="TEST-OVERSPEED")
    db.add(device)
    db.flush()
    now = datetime(2026, 8, 21, 10, 0, 0)
    db.add(FakeDevicePosition(
        device_id=device.id, speed_kmh=90.0, fix_time=now - timedelta(seconds=10),
        raw_attributes={},
    ))
    db.add(FakeDevicePosition(
        device_id=device.id, speed_kmh=95.0, fix_time=now,
        raw_attributes={},
    ))
    db.add(FakeAlertTypeSetting(alert_type="overspeed", is_enabled=setting_enabled))
    db.commit()
    return device


def test_disabled_overspeed_does_not_create_alert(alert_env):
    from tracker_backend.services import alert_monitor as am

    db = Session(alert_env)
    try:
        device = _seed_overspeed_device(db, setting_enabled=False)
        am.check_driving_events()
        db.expire_all()
        alerts = db.query(FakeDeviceAlert).filter_by(device_id=device.id, alert_type="overspeed").all()
        assert alerts == []
    finally:
        db.close()


def test_reenabling_overspeed_resumes_detection(alert_env):
    from tracker_backend.services import alert_monitor as am

    db = Session(alert_env)
    try:
        device = _seed_overspeed_device(db, setting_enabled=False)
        am.check_driving_events()
        assert db.query(FakeDeviceAlert).filter_by(alert_type="overspeed").count() == 0

        setting = db.query(FakeAlertTypeSetting).filter_by(alert_type="overspeed").one()
        setting.is_enabled = True
        db.commit()

        # A new position is required because check_driving_events skips a
        # device whose latest position id was already evaluated.
        latest = (
            db.query(FakeDevicePosition)
            .filter_by(device_id=device.id)
            .order_by(FakeDevicePosition.fix_time.desc())
            .first()
        )
        db.add(FakeDevicePosition(
            device_id=device.id,
            speed_kmh=98.0,
            fix_time=latest.fix_time + timedelta(seconds=10),
            raw_attributes={},
        ))
        db.commit()

        am.check_driving_events()
        db.expire_all()
        alerts = db.query(FakeDeviceAlert).filter_by(device_id=device.id, alert_type="overspeed").all()
        assert len(alerts) == 1
        assert alerts[0].is_resolved is False
    finally:
        db.close()
