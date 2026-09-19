"""
Driving-event alert detection: harsh braking, harsh acceleration,
overspeeding, geofence exits, and "driver not assigned on an in-progress
trip" — written into the same DeviceAlert table security_monitor.py
already uses for the silence/offline check, so the Alert page reads
from one place.

Thresholds are reused as-is from services/report.py so "harsh brake"
here means exactly what it means on a trip report — this module just
turns those same conditions into timestamped, resolvable events instead
of only an end-of-day aggregate count.

Called every poll cycle from poller.py, right after position_writer has
persisted this cycle's new DevicePosition rows (if any).

SOS and fuel-theft are deliberately NOT handled here — SOS needs a
device-side trigger this fleet doesn't send yet, and fuel theft needs a
defined detection rule (e.g. a sudden fuel-level drop while parked).
Both are surfaced in the frontend as "coming soon" rather than faked.
"""

import logging
from datetime import datetime, timezone

from tracker_backend.db import SessionLocal
from tracker_backend.models import Device, DevicePosition, DeviceAlert
from tracker_backend.services.report import (
    OVERSPEED_THRESHOLD_KMH,
    HARSH_BRAKE_DELTA_KMH,
    HARSH_ACCEL_DELTA_KMH,
)
from tracker_backend.services import driver_service
from tracker_backend.services.cache import alert_type_settings_cache

logger = logging.getLogger("driving_alerts")

# device_id -> id of the last DevicePosition row already evaluated, so a
# poll cycle that didn't insert a new row for a device (nothing moved)
# is a fast no-op instead of re-comparing the same pair of points.
_last_checked_position_id: dict[int, int] = {}


def _open_alert(db, device_id: int, alert_type: str) -> DeviceAlert | None:
    return (
        db.query(DeviceAlert)
        .filter_by(device_id=device_id, alert_type=alert_type, is_resolved=False)
        .first()
    )


def _raise_alert(db, device_id: int, alert_type: str, severity: str, message: str) -> None:
    """Opens a new alert unless one of this type is already open for
    this device — avoids spamming a fresh row every 5s while a
    condition (e.g. still overspeeding) persists across polls.

    Also no-ops when AlertTypeSetting.is_enabled is False for this
    type (fleet-wide detection toggle on the admin Settings page).
    """
    if not alert_type_settings_cache.is_enabled(alert_type):
        return
    if _open_alert(db, device_id, alert_type) is not None:
        return
    db.add(DeviceAlert(
        device_id=device_id,
        alert_type=alert_type,
        severity=severity,
        message=message,
    ))
    logger.warning("ALERT[%s] device_id=%s type=%s — %s", severity, device_id, alert_type, message)


def _resolve_alert(db, device_id: int, alert_type: str) -> None:
    open_alert = _open_alert(db, device_id, alert_type)
    if open_alert is not None:
        open_alert.is_resolved = True
        open_alert.resolved_at = datetime.now(timezone.utc).replace(tzinfo=None)


def check_driving_events() -> None:
    db = SessionLocal()
    try:
        # One lookup for the whole cycle — not once per device.
        alert_type_settings_cache.refresh(db)
        devices = db.query(Device).all()

        for device in devices:
            last_two = (
                db.query(DevicePosition)
                .filter(DevicePosition.device_id == device.id)
                .order_by(DevicePosition.fix_time.desc())
                .limit(2)
                .all()
            )

            # --- driver-not-assigned on an in-progress trip (doesn't
            # need position history, so check it even for devices with
            # <2 stored positions) ---
            _, driver_alert = driver_service.get_live_driver_alert(db, device.id)
            if driver_alert:
                _raise_alert(
                    db, device.id, "driver_unassigned", "info",
                    f"'{device.name}' has a trip in progress with no driver assigned.",
                )
            else:
                _resolve_alert(db, device.id, "driver_unassigned")

            if len(last_two) < 2:
                continue

            current, previous = last_two[0], last_two[1]

            if current.id == _last_checked_position_id.get(device.id):
                continue  # already evaluated this exact position last cycle
            _last_checked_position_id[device.id] = current.id

            # This device's own thresholds, falling back to the
            # fleet-wide defaults when it hasn't customized them (see
            # Device.speed_limit_kmh / harsh_brake_delta_kmh /
            # harsh_accel_delta_kmh) — same convention as report.py and
            # trip_tracker.py, so a live alert always agrees with what
            # the reports would show for the same event.
            overspeed_threshold_kmh = (
                device.speed_limit_kmh if device.speed_limit_kmh is not None else OVERSPEED_THRESHOLD_KMH
            )
            harsh_brake_delta_kmh = (
                device.harsh_brake_delta_kmh if device.harsh_brake_delta_kmh is not None else HARSH_BRAKE_DELTA_KMH
            )
            harsh_accel_delta_kmh = (
                device.harsh_accel_delta_kmh if device.harsh_accel_delta_kmh is not None else HARSH_ACCEL_DELTA_KMH
            )

            attrs = current.raw_attributes or {}
            alarm = attrs.get("alarm", "")
            speed_delta = (current.speed_kmh or 0) - (previous.speed_kmh or 0)

            # --- Harsh braking ---
            if alarm == "hardBraking" or speed_delta < -harsh_brake_delta_kmh:
                _raise_alert(
                    db, device.id, "harsh_brake", "warning",
                    f"Harsh braking on '{device.name}' "
                    f"({previous.speed_kmh or 0:.0f} → {current.speed_kmh or 0:.0f} km/h).",
                )

            # --- Harsh acceleration ---
            if alarm == "hardAcceleration" or speed_delta > harsh_accel_delta_kmh:
                _raise_alert(
                    db, device.id, "harsh_accel", "warning",
                    f"Harsh acceleration on '{device.name}' "
                    f"({previous.speed_kmh or 0:.0f} → {current.speed_kmh or 0:.0f} km/h).",
                )

            # --- Overspeeding (open while over the limit, auto-resolve
            # once back under it) ---
            if current.speed_kmh and current.speed_kmh > overspeed_threshold_kmh:
                _raise_alert(
                    db, device.id, "overspeed", "critical",
                    f"'{device.name}' overspeeding at {current.speed_kmh:.0f} km/h "
                    f"(limit {overspeed_threshold_kmh:.0f} km/h).",
                )
            else:
                _resolve_alert(db, device.id, "overspeed")

            # --- Geofence exit — only meaningful for devices that have
            # a primary geofence configured ---
            if device.primary_geofence_id is not None:
                prev_ids = set(previous.geofence_ids or [])
                curr_ids = set(current.geofence_ids or [])
                was_inside = device.primary_geofence_id in prev_ids
                is_inside = device.primary_geofence_id in curr_ids

                if was_inside and not is_inside:
                    _raise_alert(
                        db, device.id, "geofence_exit", "critical",
                        f"'{device.name}' left its assigned geofence.",
                    )
                elif is_inside:
                    _resolve_alert(db, device.id, "geofence_exit")

        db.commit()
    finally:
        db.close()