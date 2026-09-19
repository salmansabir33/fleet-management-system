"""
Timezone display helper. All timestamps in the DB (last_seen_at, fix_time,
triggered_at, etc.) are stored in UTC — this converts to Pakistan time
ONLY for display purposes. Never store the converted value back to the DB.
"""

from datetime import datetime
from zoneinfo import ZoneInfo

PAKISTAN_TZ = ZoneInfo("Asia/Karachi")


def to_pakistan_time(utc_dt: datetime | None) -> datetime | None:
    """Convert a naive-UTC datetime to a timezone-aware Pakistan-time datetime."""
    if utc_dt is None:
        return None
    if utc_dt.tzinfo is None:
        utc_dt = utc_dt.replace(tzinfo=ZoneInfo("UTC"))
    return utc_dt.astimezone(PAKISTAN_TZ)


def format_pakistan_time(utc_dt: datetime | None, fmt: str = "%Y-%m-%d %I:%M %p") -> str:
    """Convenience formatter, e.g. for showing in an API response or admin UI."""
    pk_dt = to_pakistan_time(utc_dt)
    return pk_dt.strftime(fmt) if pk_dt else "—"