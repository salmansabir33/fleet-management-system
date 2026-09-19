# tracker_backend/services/traccar.py
"""
Handles all communication with the Traccar API.

Design notes for this version:
- Uses HTTP Basic Auth on every request instead of the old session/cookie
  login dance. Traccar supports Basic Auth natively, so there's no need to
  POST /api/session and juggle cookies before every single call — this cuts
  every request from 2 round-trips down to 1.
- Reuses a single httpx.AsyncClient (connection pooling) instead of creating
  a new one per method call.
- Speed is confirmed to ALWAYS be returned by Traccar's API in knots,
  regardless of the source device's protocol (Traccar's protocol decoders
  normalize speed to knots internally before storing it — this is documented
  Traccar behavior, not device-specific). So one conversion path is correct;
  there is no protocol-based branching needed here.
- Every raw attribute Traccar reports (ignition, motion, battery, power,
  adc1, in1-4, out1-4, alarm, etc.) is passed through untouched in
  `attributes` rather than being individually whitelisted, since the goal
  right now is visibility into everything Traccar can offer.
"""

import json as json_lib

import httpx
from tracker_backend.config import settings


KNOTS_TO_KMH = 1.852


class TraccarService:
    """Thin async client around the Traccar REST API."""

    def __init__(self):
        self.base_url = settings.TRACCAR_URL.rstrip("/")
        self._client = httpx.AsyncClient(
            base_url=self.base_url,
            auth=(settings.TRACCAR_EMAIL, settings.TRACCAR_PASSWORD),
            timeout=10.0,
            # Traccar's plain endpoints (/api/devices, /api/positions)
            # default to JSON, but /api/reports/* endpoints (route, trips,
            # stops, summary, etc.) do NOT — without an explicit Accept
            # header, they silently return an XLSX file instead of JSON.
            # This is documented Traccar behavior (confirmed on their own
            # API reference and repeatedly reported on their forums), not
            # a bug on our side. Setting it once here, client-wide, covers
            # every current and future call — including get_route below,
            # which hits exactly this kind of endpoint.
            headers={"Accept": "application/json"},
        )

    async def aclose(self):
        """Call this on app shutdown to close the pooled connection cleanly."""
        await self._client.aclose()

    def _parse_json(self, response: httpx.Response):
        """Parse a Traccar response body as JSON, tolerating invalid UTF-8
        and an empty body.

        Traccar's reverse-geocoded `address` field can contain a byte
        sequence that isn't valid UTF-8 (an encoding mismatch on the
        Traccar/geocoder side, not ours). httpx's response.json() decodes
        strictly and raises UnicodeDecodeError on that single bad byte,
        losing the entire response. Decoding with errors="replace" here
        keeps every other field intact and swaps only the bad byte(s) for
        U+FFFD, instead of failing the whole request over one field.

        Separately, Traccar can reply with a 200/204 and a genuinely empty
        body (as opposed to a valid empty JSON array "[]") for a report
        range with nothing in it. json.loads("") raises "Expecting value:
        line 1 column 1 (char 0)" — treated here as "no data" (empty list)
        rather than a parse failure, since an empty result is a normal,
        expected outcome for a route/position query, not an error.
        """
        text = response.content.decode("utf-8", errors="replace").strip()
        if not text:
            return []
        return json_lib.loads(text)

    def _with_speed_kmh(self, position: dict) -> dict:
        """Add a speed_kmh field alongside Traccar's raw knots value.
        Does not overwrite the original `speed` field, so raw Traccar
        data is still visible untouched.
        """
        position["speed_kmh"] = round((position.get("speed") or 0) * KNOTS_TO_KMH, 2)
        return position

    async def get_devices(self) -> list:
        """Get all registered devices, raw from Traccar."""
        response = await self._client.get("/api/devices")
        response.raise_for_status()
        return self._parse_json(response)

    async def get_positions(self) -> list:
        """Get current positions of all devices, raw from Traccar
        (with speed_kmh added for convenience)."""
        response = await self._client.get("/api/positions")
        response.raise_for_status()
        positions = self._parse_json(response)
        return [self._with_speed_kmh(p) for p in positions]

    async def get_device_positions(self, device_id: int) -> list:
        """Get current position of a specific device."""
        response = await self._client.get(
            "/api/positions", params={"deviceId": device_id}
        )
        response.raise_for_status()
        positions = self._parse_json(response)
        return [self._with_speed_kmh(p) for p in positions]

    async def get_route(self, device_id: int, from_time: str, to_time: str) -> list:
        """Get historical route for a device.

        Args:
            device_id : Device ID from Traccar
            from_time : Start time (ISO format), e.g. 2024-01-15T00:00:00Z
            to_time   : End time (ISO format), e.g. 2024-01-15T23:59:59Z
        """
        response = await self._client.get(
            "/api/reports/route",
            params={"deviceId": device_id, "from": from_time, "to": to_time},
        )
        response.raise_for_status()
        positions = self._parse_json(response)
        return [self._with_speed_kmh(p) for p in positions]

    def get_route_sync(self, device_id: int, from_time: str, to_time: str) -> list:
        """Synchronous reports/route fetch for poller/trip-close backfill.

        Those call sites run inside asyncio.to_thread and cannot await the
        shared AsyncClient. Reports can be large (a long trip is ~1MB), so
        this uses a 120s timeout instead of the 10s live-poll client.
        """
        with httpx.Client(
            base_url=self.base_url,
            auth=(settings.TRACCAR_EMAIL, settings.TRACCAR_PASSWORD),
            # Connect must fail fast: Windows "unreachable host" can otherwise
            # stall for minutes and would block API startup if this ran inline.
            timeout=httpx.Timeout(120.0, connect=10.0),
            headers={"Accept": "application/json"},
        ) as client:
            response = client.get(
                "/api/reports/route",
                params={"deviceId": device_id, "from": from_time, "to": to_time},
            )
            response.raise_for_status()
            positions = self._parse_json(response)
            return [self._with_speed_kmh(p) for p in positions]

    async def create_device(self, name: str, unique_id: str) -> dict:
        """Register a new device in Traccar. unique_id = the tracker's IMEI."""
        response = await self._client.post(
            "/api/devices",
            json={"name": name, "uniqueId": unique_id},
        )
        response.raise_for_status()
        return self._parse_json(response)

    async def delete_device(self, traccar_device_id: int) -> None:
        """Remove a device from Traccar entirely."""
        response = await self._client.delete(f"/api/devices/{traccar_device_id}")
        response.raise_for_status()


# Single instance used everywhere
traccar_service = TraccarService()