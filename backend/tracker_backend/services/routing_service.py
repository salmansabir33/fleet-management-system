import re

import httpx

from fastapi import HTTPException

from tracker_backend.config import settings

ORS_DIRECTIONS_URL = "https://api.openrouteservice.org/v2/directions/driving-car/geojson"
# ORS's default snap search is 350m. -1 is documented as "no limit" but the
# public API still caps it at a few km, and a hard 2000m matches the
# intended "slightly off-road still works, far from any road still fails"
# behavior more safely than an unbounded snap.
ORS_SNAP_RADIUS_METERS = 2000
ORS_COORDINATE_INDEX_RE = re.compile(r"specified coordinate\s+(\d+)", re.IGNORECASE)


def _normalize_points(points: list[tuple[float, float]]) -> list[list[float]]:
    if len(points) < 2:
        raise HTTPException(status_code=400, detail="At least two route points are required.")
    return [[lon, lat] for lat, lon in points]


async def get_road_path(points: list[tuple[float, float]]) -> list[tuple[float, float]]:
    """Road-snaps the given (lat, lon) points using ORS Directions.

    Uses the GeoJSON directions endpoint so the returned geometry is
    already a decoded LineString rather than an encoded polyline.
    """
    coordinates = _normalize_points(points)
    payload = {
        "coordinates": coordinates,
        "instructions": False,
        "radiuses": [ORS_SNAP_RADIUS_METERS] * len(coordinates),
    }
    headers = {
        "Authorization": settings.ORS_API_KEY,
        "Accept": "application/json, application/geo+json",
        "Content-Type": "application/json",
    }

    try:
        async with httpx.AsyncClient(timeout=30) as client:
            response = await client.post(ORS_DIRECTIONS_URL, json=payload, headers=headers)
    except httpx.RequestError as exc:
        raise HTTPException(
            status_code=502,
            detail=f"Failed to reach OpenRouteService: {exc}",
        ) from exc

    if response.status_code >= 400:
        detail = "OpenRouteService failed to build the route."
        try:
            data = response.json()
            detail = (
                data.get("error", {}).get("message")
                or data.get("message")
                or detail
            )
        except Exception:
            pass

        radius_match = (
            ORS_COORDINATE_INDEX_RE.search(detail)
            if isinstance(detail, str) else None
        )
        if radius_match:
            point_number = int(radius_match.group(1)) + 1
            detail = (
                f"Point {point_number} isn't close enough to a road — "
                "try moving it closer to a mapped street."
            )
        elif response.status_code in (401, 403):
            detail = f"OpenRouteService rejected the API key: {detail}"
        elif response.status_code == 404:
            detail = f"OpenRouteService could not find a drivable route: {detail}"
        elif response.status_code == 429:
            detail = f"OpenRouteService rate limit reached: {detail}"

        raise HTTPException(status_code=502, detail=detail)

    data = response.json()
    features = data.get("features") or []
    if not features:
        raise HTTPException(
            status_code=502,
            detail="OpenRouteService returned no route geometry.",
        )

    geometry = features[0].get("geometry") or {}
    coordinates = geometry.get("coordinates") or []
    if geometry.get("type") != "LineString" or len(coordinates) < 2:
        raise HTTPException(
            status_code=502,
            detail="OpenRouteService returned an unexpected route geometry.",
        )

    return [(lat, lon) for lon, lat in coordinates]
