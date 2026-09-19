"""Read-only diagnostic: corridor distance vs stored matched-leg window.

Prints per-point distance to route.path and compares the excluded
(pre-leg / post-leg) GPS points against route.tolerance_meters, so we
can tell whether a dashed "off-route" stretch is spatially off the
polyline (scenario 1) or only excluded by window selection (scenario 2).

Does not write to the database and does not call match_trip_to_routes
or any backfill.

Run from the backend directory:

    python -m tracker_backend.scripts.diagnose_trip_leg_exclusion
    python -m tracker_backend.scripts.diagnose_trip_leg_exclusion --trip-id 79 --route-name "ahmed pur east"
"""

from __future__ import annotations

import argparse
import sys

from tracker_backend.db import SessionLocal
from tracker_backend.models import Device, DevicePosition, Route, Trip, TripRouteMatch
from tracker_backend.services.route_matcher import _route_segment_distance_meters

DEFAULT_TRIP_ID = 79
DEFAULT_ROUTE_NAME = "ahmed pur east"


def _pct(n: int, d: int) -> str:
    if d == 0:
        return "n/a"
    return f"{(n / d) * 100:.1f}%"


def _region_summary(label: str, indices: list[int], within_flags: list[bool]) -> str:
    if not indices:
        return f"{label}: none."
    within = sum(1 for i in indices if within_flags[i])
    total = len(indices)
    return (
        f"{label} (indices {indices[0]}-{indices[-1]}): "
        f"{within}/{total} points ({_pct(within, total)}) are within tolerance of the route."
    )


def _contiguous_runs(flags: list[bool]) -> list[tuple[int, int, int]]:
    """Return (start, end, length) runs where flags is True."""
    runs: list[tuple[int, int, int]] = []
    start: int | None = None
    for i, flag in enumerate(flags):
        if flag and start is None:
            start = i
        elif not flag and start is not None:
            runs.append((start, i - 1, i - start))
            start = None
    if start is not None:
        runs.append((start, len(flags) - 1, len(flags) - start))
    return runs


def _load_route(db, route_id: int | None, route_name: str | None) -> Route:
    if route_id is not None:
        route = db.query(Route).filter(Route.id == route_id).first()
        if route is None:
            print(f"ERROR: no route with id={route_id}", file=sys.stderr)
            sys.exit(1)
        return route

    name = (route_name or "").strip()
    if not name:
        print("ERROR: provide --route-id or --route-name", file=sys.stderr)
        sys.exit(1)

    matches = db.query(Route).filter(Route.name == name).all()
    if not matches:
        matches = (
            db.query(Route)
            .filter(Route.name.ilike(name))
            .all()
        )
    if not matches:
        print(f"ERROR: no route named {name!r}", file=sys.stderr)
        sys.exit(1)
    if len(matches) > 1:
        print(f"ERROR: multiple routes named {name!r}:", file=sys.stderr)
        for r in matches:
            print(f"  id={r.id} name={r.name!r}", file=sys.stderr)
        print("Re-run with --route-id.", file=sys.stderr)
        sys.exit(1)
    return matches[0]


def main() -> None:
    parser = argparse.ArgumentParser(description="Diagnose trip points excluded from a matched route leg.")
    parser.add_argument("--trip-id", type=int, default=DEFAULT_TRIP_ID)
    parser.add_argument("--route-id", type=int, default=None)
    parser.add_argument("--route-name", type=str, default=DEFAULT_ROUTE_NAME)
    args = parser.parse_args()

    db = SessionLocal()
    try:
        trip = db.query(Trip).filter(Trip.id == args.trip_id).first()
        if trip is None:
            print(f"ERROR: no trip with id={args.trip_id}", file=sys.stderr)
            sys.exit(1)

        route = _load_route(
            db,
            args.route_id,
            args.route_name if args.route_id is None else None,
        )

        device = db.query(Device).filter(Device.id == trip.device_id).first()
        positions = (
            db.query(DevicePosition)
            .filter(
                DevicePosition.device_id == trip.device_id,
                DevicePosition.fix_time >= trip.start_time,
                DevicePosition.fix_time <= trip.end_time,
            )
            .order_by(DevicePosition.fix_time.asc())
            .all()
        )
        if not positions:
            print("ERROR: trip has no positions.", file=sys.stderr)
            sys.exit(1)

        match = (
            db.query(TripRouteMatch)
            .filter(
                TripRouteMatch.trip_id == trip.id,
                TripRouteMatch.route_id == route.id,
            )
            .first()
        )

        route_path = route.path or []
        n_vertices = len(route_path)
        n_pts = len(positions)

        print("=" * 88)
        print("ROUTE")
        print("=" * 88)
        print(f"  id                : {route.id}")
        print(f"  name              : {route.name}")
        print(f"  direction_label   : {route.direction_label}")
        print(f"  tolerance_meters  : {route.tolerance_meters}")
        print(f"  path vertices     : {n_vertices}")
        print()
        print("=" * 88)
        print("TRIP")
        print("=" * 88)
        print(f"  id                : {trip.id}")
        print(f"  device_id         : {trip.device_id}")
        if device is not None:
            print(f"  device_name       : {device.name}")
            print(f"  traccar_device_id : {device.traccar_device_id}")
        print(f"  trip_date         : {trip.trip_date}")
        print(f"  trip_number       : {trip.trip_number}")
        print(f"  status            : {trip.status}")
        print(f"  start_time        : {trip.start_time}")
        print(f"  end_time          : {trip.end_time}")
        print(f"  position count    : {n_pts}")
        print()

        print("=" * 88)
        print("STORED TripRouteMatch")
        print("=" * 88)
        if match is None:
            print("  (no TripRouteMatch row for this trip/route)")
            leg_start = None
            leg_end = None
        else:
            print(f"  id                  : {match.id}")
            print(f"  leg_start_index     : {match.leg_start_index}")
            print(f"  leg_end_index       : {match.leg_end_index}")
            print(f"  match_percent       : {match.match_percent}")
            print(f"  deviation_segments  : {match.deviation_segments}")
            leg_start = match.leg_start_index
            leg_end = match.leg_end_index
        print()

        print("=" * 88)
        print("PER-POINT DISTANCE TO route.path")
        print("=" * 88)
        print(
            f"{'idx':>5}  {'fix_time':<26}  {'lat':>10}  {'lon':>11}  "
            f"{'dist_m':>10}  {'within':>6}  {'in_leg':>6}"
        )

        distances: list[float] = []
        within_flags: list[bool] = []
        for i, pos in enumerate(positions):
            dist = _route_segment_distance_meters(pos, route_path)
            within = dist <= route.tolerance_meters
            distances.append(dist)
            within_flags.append(within)
            in_leg = (
                leg_start is not None
                and leg_end is not None
                and leg_start <= i <= leg_end
            )
            dist_s = "inf" if dist == float("inf") else f"{dist:.1f}"
            print(
                f"{i:5d}  {str(pos.fix_time):<26}  {pos.lat:10.6f}  {pos.lon:11.6f}  "
                f"{dist_s:>10}  {str(within):>6}  {str(in_leg):>6}"
            )

        print()
        print("=" * 88)
        print("ON-ROUTE CONTIGUOUS RUNS (within_tolerance=True)")
        print("=" * 88)
        runs = _contiguous_runs(within_flags)
        if not runs:
            print("  none")
        else:
            for start, end, length in runs:
                print(f"  indices {start}-{end} ({length} pts)")
        print(f"  total on-route points: {sum(within_flags)}/{n_pts} ({_pct(sum(within_flags), n_pts)})")
        print()

        print("=" * 88)
        print("EXCLUDED-REGION SUMMARY")
        print("=" * 88)
        if match is None or leg_start is None or leg_end is None:
            print("  Cannot compute pre/post-leg regions (no stored match / missing indices).")
            print("  Whole-trip within-tolerance: "
                  f"{sum(within_flags)}/{n_pts} ({_pct(sum(within_flags), n_pts)}).")
        else:
            last = n_pts - 1
            pre = list(range(0, leg_start))
            post = list(range(leg_end + 1, n_pts))
            if not pre:
                print("Pre-leg region: none (leg starts at the beginning of the trip).")
            else:
                print(_region_summary("Pre-leg region", pre, within_flags))
            if not post:
                print("Post-leg region: none (leg extends to end of trip).")
            else:
                print(_region_summary("Post-leg region", post, within_flags))
            print(
                f"Matched leg (indices {leg_start}-{min(leg_end, last)}): "
                f"{sum(1 for i in range(leg_start, min(leg_end, last) + 1) if within_flags[i])}"
                f"/{max(0, min(leg_end, last) - leg_start + 1)} points "
                f"({_pct(sum(1 for i in range(leg_start, min(leg_end, last) + 1) if within_flags[i]), max(0, min(leg_end, last) - leg_start + 1))}) "
                f"within tolerance."
            )
        print()
        print(
            "Interpretation: a high within-tolerance % in an excluded region "
            "points to a window-selection gap (scenario 2). Near-zero % means "
            "the drawn route does not cover that road (scenario 1)."
        )
    finally:
        db.close()


if __name__ == "__main__":
    main()
