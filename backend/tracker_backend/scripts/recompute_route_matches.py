"""Recompute route match data for all historical trips across all routes.

The route-matching corridor check was previously based on distance to the
nearest *vertex* of a route polyline, which incorrectly flagged GPS fixes
that sat in the middle of long straight segments as "off route". After
deploying the point-to-segment distance fix, this script backfills every
completed trip (with no date cutoff) so that stale TripRouteMatch rows are
replaced with correctly computed values.

The operation is idempotent — running it multiple times is safe and will
simply overwrite each row with the same freshly computed result.

Run from the backend directory:

    python -m tracker_backend.scripts.recompute_route_matches
"""

import logging

from tracker_backend.db import SessionLocal
from tracker_backend.services import route_matcher

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-8s  %(name)s  %(message)s",
)
logger = logging.getLogger("recompute_route_matches")


def main() -> None:
    logger.info("Starting full route-match recompute across all routes and devices …")
    db = SessionLocal()
    try:
        summary = route_matcher.recompute_all_route_matches(db)
    finally:
        db.close()

    print(
        f"\nDone.\n"
        f"  Routes processed : {summary['routes_processed']}\n"
        f"  Trips attempted  : {summary['trips_attempted']}\n"
        f"  Failures         : {summary['failures']}\n"
    )
    if summary["failures"]:
        print(
            "WARNING: some trips could not be recomputed — check the log output above "
            "for details. Re-running this script is safe and will retry those trips."
        )


if __name__ == "__main__":
    main()
