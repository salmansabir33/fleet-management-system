"""
Manual test for GPS anomaly detection in position_writer.py.

Simulates:
  1. A normal position in Lahore.
  2. A "teleport" to Faisalabad 5 minutes later — physically impossible,
     should be flagged is_gps_anomaly=True and NOT update the reference point.
  3. A second position near Faisalabad shortly after — since the reference
     point is still Lahore, this ALSO gets flagged (still an implausible
     jump from the last trusted point), demonstrating the point isn't lost,
     just distrusted until corroborated.

Run with: python -m tests.test_gps_anomaly
(run from the `backend` folder, same place you run alembic/uvicorn from)
"""

from datetime import datetime, timedelta, timezone

from tracker_backend.db import SessionLocal
from tracker_backend.models import Device, DevicePosition
from tracker_backend.services import position_writer

FAKE_TRACCAR_DEVICE_ID = 999001

FAKE_DEVICES = [
    {"id": FAKE_TRACCAR_DEVICE_ID, "name": "TEST-GPS-ANOMALY-DEVICE"}
]


def make_position(lat, lon, minutes_offset, speed_kmh=0):
    fix_time = datetime.now(timezone.utc) + timedelta(minutes=minutes_offset)
    return {
        "deviceId": FAKE_TRACCAR_DEVICE_ID,
        "protocol": "gt06",
        "latitude": lat,
        "longitude": lon,
        "altitude": 0.0,
        "course": 0.0,
        "accuracy": 0.0,
        "address": None,
        "geofenceIds": None,
        "speed_kmh": speed_kmh,
        "fixTime": fix_time.isoformat().replace("+00:00", "Z"),
        "attributes": {
            "ignition": False,
            "motion": speed_kmh > 2,
            "batteryLevel": 90,
            "distance": 0,
            "totalDistance": 1000,
        },
    }


def cleanup():
    db = SessionLocal()
    try:
        device = db.query(Device).filter_by(traccar_device_id=FAKE_TRACCAR_DEVICE_ID).first()
        if device:
            db.query(DevicePosition).filter_by(device_id=device.id).delete()
            db.query(Device).filter_by(id=device.id).delete()
            db.commit()
            print(f"Cleaned up test device {FAKE_TRACCAR_DEVICE_ID} and its positions.")
    finally:
        db.close()


def print_stored_positions():
    db = SessionLocal()
    try:
        device = db.query(Device).filter_by(traccar_device_id=FAKE_TRACCAR_DEVICE_ID).first()
        if not device:
            print("No device row found — nothing was saved.")
            return
        rows = (
            db.query(DevicePosition)
            .filter_by(device_id=device.id)
            .order_by(DevicePosition.fix_time)
            .all()
        )
        print(f"\nStored positions for device {FAKE_TRACCAR_DEVICE_ID}:")
        for r in rows:
            print(
                f"  fix_time={r.fix_time}  lat={r.lat:.4f}  lon={r.lon:.4f}  "
                f"is_gps_anomaly={r.is_gps_anomaly}  motion_status={r.motion_status}"
            )
    finally:
        db.close()


def run_test():
    # Clear in-memory dedup state so this test doesn't get affected by
    # anything the live poller already cached for this fake device id.
    position_writer._last_saved.pop(FAKE_TRACCAR_DEVICE_ID, None)

    lahore = (31.5204, 74.3587)
    faisalabad = (31.4180, 73.0790)  # ~130km from Lahore

    print("Step 1: normal position in Lahore")
    p1 = make_position(*lahore, minutes_offset=0)
    position_writer.save_positions(FAKE_DEVICES, [p1])

    print("Step 2: 'teleport' to Faisalabad, 5 minutes later (should be flagged)")
    p2 = make_position(*faisalabad, minutes_offset=5)
    position_writer.save_positions(FAKE_DEVICES, [p2])

    print("Step 3: another point near Faisalabad, 6 minutes later "
          "(still compared against Lahore, so still flagged)")
    p3 = make_position(faisalabad[0] + 0.001, faisalabad[1] + 0.001, minutes_offset=6)
    position_writer.save_positions(FAKE_DEVICES, [p3])

    print_stored_positions()


if __name__ == "__main__":
    try:
        run_test()
    finally:
        cleanup()