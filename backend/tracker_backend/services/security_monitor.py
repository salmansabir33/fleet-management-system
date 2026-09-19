"""
Anti-theft early-warning check: flags a MOBILE device that was previously
reporting normally but has gone silent longer than SILENCE_THRESHOLD.
Hardware GT06 trackers are excluded — they legitimately lose signal far
more often (parking garages, remote areas) than a phone with mobile data,
so applying this to them would just generate false alarms.

All timestamps here are UTC (datetime.utcnow), consistent with
last_seen_at on Device — never mix in MySQL's local NOW().

Called every poll cycle from poller.py, right after save_positions().
"""

import logging
from datetime import datetime, timedelta

from tracker_backend.db import SessionLocal
from tracker_backend.models import Device, DeviceAlert
from tracker_backend.services.cache import alert_type_settings_cache

# Lowered from 5 to 2 minutes for easier testing. Bump back up to 5
# (or higher) once you're done testing — 2 minutes is short enough
# that normal brief signal gaps could false-trigger in daily use.
SILENCE_THRESHOLD = timedelta(minutes=2)

logger = logging.getLogger("security_alerts")


def check_device_silence():
    db = SessionLocal()
    try:
        # One lookup for the whole cycle — not once per device.
        alert_type_settings_cache.refresh(db)
        now = datetime.utcnow()
        devices = (
            db.query(Device)
            .filter(
                Device.last_seen_at.isnot(None),
                Device.device_type == "mobile",
            )
            .all()
        )

        for device in devices:
            silent_for = now - device.last_seen_at

            open_alert = (
                db.query(DeviceAlert)
                .filter_by(device_id=device.id, alert_type="silence", is_resolved=False)
                .first()
            )

            if silent_for > SILENCE_THRESHOLD:
                if not open_alert and alert_type_settings_cache.is_enabled("silence"):
                    minutes_silent = int(silent_for.total_seconds() // 60)
                    message = (
                        f"Mobile device '{device.name}' (traccar_id={device.traccar_device_id}) "
                        f"has not reported in {minutes_silent} min. "
                        f"Last seen at {device.last_seen_at.isoformat()}."
                    )
                    db.add(DeviceAlert(
                        device_id=device.id,
                        alert_type="silence",
                        severity="critical",
                        message=message,
                    ))
                    db.commit()
                    logger.warning("SECURITY ALERT — %s", message)
            else:
                if open_alert:
                    open_alert.is_resolved = True
                    open_alert.resolved_at = now
                    db.commit()
                    logger.info(
                        "RESOLVED — mobile device '%s' reporting again after silence.",
                        device.name,
                    )
    finally:
        db.close()