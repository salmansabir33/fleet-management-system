"""One-time cleanup: keep a single in_progress Trip per device.

Live trip detection and stored-position backfill can each insert an
in_progress row for the same physical trip. This script hard-deletes
the extras, keeping the earliest start_time.

Run from the backend directory, after reviewing:

    python -m tracker_backend.scripts.cleanup_duplicate_open_trips

Run this BEFORE applying the open_trip_marker unique-index migration,
or that migration will fail on existing duplicates.
"""

from tracker_backend.db import SessionLocal
from tracker_backend.models import Trip


def main() -> None:
    db = SessionLocal()
    try:
        open_trips = (
            db.query(Trip)
            .filter(Trip.status == "in_progress")
            .order_by(Trip.device_id.asc(), Trip.start_time.asc(), Trip.id.asc())
            .all()
        )

        by_device: dict[int, list[Trip]] = {}
        for trip in open_trips:
            by_device.setdefault(trip.device_id, []).append(trip)

        summary: list[tuple[int, int, int, object]] = []
        for device_id, trips in by_device.items():
            if len(trips) <= 1:
                continue
            kept = trips[0]
            duplicates = trips[1:]
            for dup in duplicates:
                db.delete(dup)
            db.commit()
            summary.append((device_id, len(duplicates), kept.id, kept.start_time))

        if not summary:
            print("No duplicate in_progress trips found.")
            return

        print("Removed duplicate in_progress trips:")
        total_removed = 0
        for device_id, removed, kept_id, kept_start in summary:
            total_removed += removed
            print(
                f"  device_id={device_id} removed={removed} "
                f"kept_trip_id={kept_id} kept_start_time={kept_start}"
            )
        print(f"Total devices cleaned: {len(summary)}; total rows deleted: {total_removed}")
    finally:
        db.close()


if __name__ == "__main__":
    main()
