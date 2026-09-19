"""
Maintenance due/overdue check — same shape as security_monitor.py.
Runs every poll cycle (called from poller.py, right after
security_monitor.check_device_silence()) and, for every device with a
baseline maintenance record, raises/resolves DeviceAlert rows as each
applicable item's status crosses between ok / due_soon / overdue.

Also exposed as check_maintenance_for_device() for a single device, so
main.py's "submit a maintenance record" endpoint can re-run this
immediately for just that vehicle instead of waiting for the next poll
cycle — the alert should clear/update right after a real submission.
"""

import logging
from datetime import datetime

from tracker_backend.db import SessionLocal
from tracker_backend.models import Device, DeviceAlert
from tracker_backend.services import maintenance_service

logger = logging.getLogger("maintenance_alerts")


def _format_message(item_status: dict) -> str:
    label = item_status["label"]
    unit = "km" if item_status["dimension"] == "distance" else "hrs"
    current = item_status["current_value"]
    last = item_status["last_service_value"]
    interval = item_status["interval_value"]

    if item_status["status"] == "overdue":
        if current is not None and last is not None:
            overdue_by = max(0, current - last - interval)
            return f"{label} overdue by {overdue_by:,.0f} {unit}"
        return f"{label} is overdue"

    # due_soon
    if current is not None and last is not None:
        due_at = last + interval
        return f"{label} is due soon (at {current:,.0f} / {due_at:,.0f} {unit})"
    return f"{label} is due soon"


def _resolve_open_alert(db, device_id: int, item_key: str, kind: str, now: datetime) -> None:
    alert_type = f"maintenance_{kind}:{item_key}"
    open_alert = (
        db.query(DeviceAlert)
        .filter_by(device_id=device_id, alert_type=alert_type, is_resolved=False)
        .first()
    )
    if open_alert:
        open_alert.is_resolved = True
        open_alert.resolved_at = now


def _open_alert_if_needed(db, device_id: int, item_key: str, kind: str, severity: str, message: str) -> None:
    alert_type = f"maintenance_{kind}:{item_key}"
    existing = (
        db.query(DeviceAlert)
        .filter_by(device_id=device_id, alert_type=alert_type, is_resolved=False)
        .first()
    )
    if existing:
        return  # already open — don't duplicate
    db.add(DeviceAlert(
        device_id=device_id,
        alert_type=alert_type,
        severity=severity,
        message=message,
    ))
    logger.warning("MAINTENANCE ALERT — %s", message)


def check_maintenance_for_device(db, device: Device, now: datetime | None = None) -> None:
    """Computes status for every applicable item on this device and
    raises/resolves DeviceAlert rows accordingly. Does not commit — the
    caller (either check_maintenance_due()'s poll loop, or main.py's
    submit-record endpoint) owns the transaction boundary."""
    now = now or datetime.utcnow()
    status = maintenance_service.get_status_for_device(db, device)
    if not status["has_baseline"]:
        return

    for item_status in status["items"]:
        key = item_status["key"]
        state = item_status["status"]

        if state == "due_soon":
            _resolve_open_alert(db, device.id, key, "overdue", now)
            _open_alert_if_needed(
                db, device.id, key, "due_soon", "warning", _format_message(item_status)
            )
        elif state == "overdue":
            # Don't show both due_soon and overdue for the same item at
            # once — resolve the due_soon alert as it crosses over.
            _resolve_open_alert(db, device.id, key, "due_soon", now)
            _open_alert_if_needed(
                db, device.id, key, "overdue", "critical", _format_message(item_status)
            )
        else:
            # "ok" (serviced, or otherwise no longer due) — resolve
            # whichever of due_soon/overdue might still be open.
            # "no_baseline"/"unknown" also fall here: nothing to alert
            # on until it's actually computable.
            _resolve_open_alert(db, device.id, key, "due_soon", now)
            _resolve_open_alert(db, device.id, key, "overdue", now)


def check_maintenance_due() -> None:
    """Runs every poll cycle (called from poller.py alongside
    check_device_silence). For every device with a baseline maintenance
    record, computes each applicable item's status and raises/resolves
    DeviceAlert rows accordingly. Also ensures today's Maintenance Due
    Report snapshot exists for each device — cheap no-op after the
    first successful call each calendar day (see
    maintenance_service.ensure_daily_snapshot)."""
    db = SessionLocal()
    try:
        now = datetime.utcnow()
        devices = db.query(Device).all()
        for device in devices:
            try:
                check_maintenance_for_device(db, device, now)
                maintenance_service.ensure_daily_snapshot(db, device, now.date())
            except Exception as e:
                logger.error("Maintenance check failed for device %s: %s", device.id, e)
        db.commit()
    finally:
        db.close()
