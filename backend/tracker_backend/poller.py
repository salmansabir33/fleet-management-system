# tracker_backend/poller.py
"""
Background task that polls Traccar on a fixed interval and refreshes the
in-memory cache. This is what decouples "how often we bother Traccar" from
"how fast the API responds" — every request your frontend makes reads the
cache instantly; only this loop ever talks to Traccar directly.

Also persists positions to MySQL (position_writer) and runs the mobile
device silence/anti-theft check (security_monitor) on every poll cycle.

POLL_INTERVAL_SECONDS is set to 5 per your requirement.
"""

import asyncio
import logging

from tracker_backend.services.traccar import traccar_service
from tracker_backend.services.cache import traccar_cache
from tracker_backend.services import position_writer
from tracker_backend.services import security_monitor
from tracker_backend.services import alert_monitor
from tracker_backend.services import trip_tracker
from tracker_backend.services import maintenance_monitor

logger = logging.getLogger("poller")

POLL_INTERVAL_SECONDS = 5


async def poll_once():
    devices = await traccar_service.get_devices()
    positions = await traccar_service.get_positions()
    traccar_cache.update(devices, positions)

    # Sync DB calls — run off the event loop thread so they don't block
    # the 5-second poll cadence.
    await asyncio.to_thread(position_writer.save_positions, devices, positions)
    await asyncio.to_thread(security_monitor.check_device_silence)
    await asyncio.to_thread(maintenance_monitor.check_maintenance_due)
    await asyncio.to_thread(alert_monitor.check_driving_events)
    await asyncio.to_thread(trip_tracker.process_trip_detection, devices, positions)


async def poll_loop():
    """Runs forever until cancelled on app shutdown."""
    while True:
        try:
            await poll_once()
            logger.info(
                "Poll #%s ok — %s devices, %s positions",
                traccar_cache.poll_count,
                len(traccar_cache.devices),
                len(traccar_cache.positions),
            )
        except Exception as e:
            logger.error("Poll failed: %s", e)
            traccar_cache.record_error(str(e))

        await asyncio.sleep(POLL_INTERVAL_SECONDS)