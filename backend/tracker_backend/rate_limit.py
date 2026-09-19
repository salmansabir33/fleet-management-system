"""Simple in-memory rate limiting for auth endpoints."""
from collections import defaultdict
from time import time

from fastapi import HTTPException, Request

# {bucket_key: [timestamps]}
_buckets: dict[str, list[float]] = defaultdict(list)


def check_rate_limit(
    request: Request,
    *,
    key_prefix: str,
    max_calls: int = 10,
    window_seconds: int = 60,
) -> None:
    client_host = request.client.host if request.client else "unknown"
    bucket_key = f"{key_prefix}:{client_host}"
    now = time()
    cutoff = now - window_seconds
    recent = [ts for ts in _buckets[bucket_key] if ts > cutoff]
    if len(recent) >= max_calls:
        raise HTTPException(
            status_code=429,
            detail="Too many login attempts. Please wait a minute and try again.",
        )
    recent.append(now)
    _buckets[bucket_key] = recent
