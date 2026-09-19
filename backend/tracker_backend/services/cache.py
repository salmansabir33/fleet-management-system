# tracker_backend/services/cache.py
"""
A simple in-memory cache holding the latest known state from Traccar.

Why this exists: without it, every API request your frontend makes would
have to wait on a live round-trip to Traccar. With it, the background
poller (see poller.py) refreshes this cache every N seconds, and your API
endpoints just read whatever's already sitting in memory — instant
response, and Traccar only gets hit once per poll interval no matter how
many users/tabs are requesting data from your API at the same time.

This is intentionally plain Python, no database. When you add Postgres
later, this cache can stay exactly as-is as the "hot" layer in front of it,
or get replaced by Redis if you outgrow a single process — but for local
testing this is the right amount of complexity, not less.
"""

from datetime import datetime, timezone
from typing import Optional


class TraccarCache:
    def __init__(self):
        self.devices: list = []
        self.positions: list = []
        self.last_updated: Optional[datetime] = None
        self.last_error: Optional[str] = None
        self.poll_count: int = 0

    def update(self, devices: list, positions: list):
        self.devices = devices
        self.positions = positions
        self.last_updated = datetime.now(timezone.utc)
        self.last_error = None
        self.poll_count += 1

    def record_error(self, error: str):
        # Keep serving the last good data even if a poll fails —
        # don't blank out the cache just because one poll had a hiccup
        # (network blip, Traccar restart, etc.)
        self.last_error = error

    def merged_live_view(self) -> list:
        """Combine device info + latest position into one object per
        device, keeping every raw field Traccar gave us."""
        positions_by_device = {p["deviceId"]: p for p in self.positions}

        merged = []
        for device in self.devices:
            position = positions_by_device.get(device["id"])
            merged.append(
                {
                    "device": device,
                    "position": position,
                }
            )
        return merged

    def status(self) -> dict:
        return {
            "last_updated": self.last_updated.isoformat() if self.last_updated else None,
            "last_error": self.last_error,
            "poll_count": self.poll_count,
            "device_count": len(self.devices),
            "position_count": len(self.positions),
        }


# Single shared instance
traccar_cache = TraccarCache()


class AlertTypeSettingsCache:
    """In-memory map of alert_type -> is_enabled, refreshed once per
    poll cycle so alert_monitor / security_monitor don't hit the DB
    once per device on every 5s tick.

    Missing keys default to enabled — unknown / not-yet-seeded types
    (e.g. route_deviation, maintenance_due:*) keep generating until an
    admin adds a row and turns them off.
    """

    def __init__(self):
        self.enabled: dict[str, bool] = {}

    def refresh(self, db) -> dict[str, bool]:
        from tracker_backend.models import AlertTypeSetting
        rows = db.query(AlertTypeSetting).all()
        self.enabled = {row.alert_type: bool(row.is_enabled) for row in rows}
        return self.enabled

    def is_enabled(self, alert_type: str) -> bool:
        return self.enabled.get(alert_type, True)

    def set_enabled(self, alert_type: str, is_enabled: bool) -> None:
        self.enabled[alert_type] = is_enabled


alert_type_settings_cache = AlertTypeSettingsCache()
