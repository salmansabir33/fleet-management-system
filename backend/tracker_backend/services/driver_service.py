"""Driver <-> vehicle assignment logic.

A driver can be assigned to only one vehicle at a time, and a vehicle
can have only one active driver at a time. "Active" means an open
DriverAssignment row (end_time IS NULL). Assigning a driver to a
vehicle closes:

  1. the driver's own previously-open assignment (if any) — they can't
     stay "on" their old vehicle once moved to a new one, and
  2. the target vehicle's previously-open assignment (if any, to a
     DIFFERENT driver) — this hands the vehicle over cleanly instead
     of leaving two drivers "active" on it at once.

History is never deleted, only closed (end_time set) — so a date range
can always be answered with "which driver(s) had this vehicle, and
from/to when," which is what the report endpoints and the driver
detail page need.
"""
from datetime import datetime

from sqlalchemy import or_

from tracker_backend.models import Driver, DriverAssignment, Device, DeviceAlert, Trip
from tracker_backend.services.report import _utc_iso

TRIP_DRIVER_PENDING_ALERT = "trip_driver_pending_confirmation"


def get_active_assignment_for_driver(db, driver_id: int) -> DriverAssignment | None:
    return (
        db.query(DriverAssignment)
        .filter(DriverAssignment.driver_id == driver_id, DriverAssignment.end_time.is_(None))
        .order_by(DriverAssignment.start_time.desc())
        .first()
    )


def get_active_assignment_for_device(db, device_id: int) -> DriverAssignment | None:
    return (
        db.query(DriverAssignment)
        .filter(DriverAssignment.device_id == device_id, DriverAssignment.end_time.is_(None))
        .order_by(DriverAssignment.start_time.desc())
        .first()
    )


def assign_driver(db, driver_id: int, device_id: int, at_time: datetime | None = None) -> DriverAssignment:
    """Assigns `driver_id` to `device_id`, closing whatever was open on
    either side first. Idempotent: re-assigning a driver to the vehicle
    they're already actively on just returns the existing open row.
    """
    at_time = at_time or datetime.utcnow()

    driver_open = get_active_assignment_for_driver(db, driver_id)
    if driver_open is not None and driver_open.device_id == device_id:
        # Already the active assignment for this exact pairing — no-op.
        return driver_open

    if driver_open is not None:
        driver_open.end_time = at_time

    device_open = get_active_assignment_for_device(db, device_id)
    if device_open is not None:
        device_open.end_time = at_time

    new_assignment = DriverAssignment(
        driver_id=driver_id,
        device_id=device_id,
        start_time=at_time,
        end_time=None,
    )
    db.add(new_assignment)
    db.commit()
    db.refresh(new_assignment)
    return new_assignment


def unassign_driver(db, driver_id: int, at_time: datetime | None = None) -> DriverAssignment | None:
    """Closes the driver's currently-open assignment, if any."""
    at_time = at_time or datetime.utcnow()
    open_assignment = get_active_assignment_for_driver(db, driver_id)
    if open_assignment is None:
        return None
    open_assignment.end_time = at_time
    db.commit()
    db.refresh(open_assignment)
    return open_assignment


def get_assignments_in_range(db, device_id: int, start_dt: datetime, end_dt: datetime) -> list[DriverAssignment]:
    """Assignments for a device whose window overlaps [start_dt, end_dt).
    Same overlap convention as trip_tracker.get_trips_in_range. Ordered
    oldest-first so a report can show a chronological driver handover
    list.
    """
    return (
        db.query(DriverAssignment)
        .filter(
            DriverAssignment.device_id == device_id,
            DriverAssignment.start_time < end_dt,
            or_(DriverAssignment.end_time.is_(None), DriverAssignment.end_time > start_dt),
        )
        .order_by(DriverAssignment.start_time.asc())
        .all()
    )


def get_assignments_for_driver_in_range(db, driver_id: int, start_dt: datetime, end_dt: datetime) -> list[DriverAssignment]:
    """Same as get_assignments_in_range but keyed by driver instead of
    device — used by the driver detail page to find every vehicle a
    driver was on during the selected window.
    """
    return (
        db.query(DriverAssignment)
        .filter(
            DriverAssignment.driver_id == driver_id,
            DriverAssignment.start_time < end_dt,
            or_(DriverAssignment.end_time.is_(None), DriverAssignment.end_time > start_dt),
        )
        .order_by(DriverAssignment.start_time.asc())
        .all()
    )


def assignment_covers_trip_start(assignment: DriverAssignment, trip: Trip) -> bool:
    """True when this assignment was active at the trip's start."""
    if trip.start_time is None:
        return False
    if assignment.start_time > trip.start_time:
        return False
    if assignment.end_time is not None and assignment.end_time <= trip.start_time:
        return False
    return True


def trip_attributed_to_driver(trip: Trip, driver_id: int, assignment: DriverAssignment | None = None) -> bool:
    """True when this trip counts for `driver_id`.

    Confirmed driver wins when set; otherwise fall back to assignment
    covering trip start (legacy behavior).
    """
    if trip.confirmed_driver_id is not None:
        return trip.confirmed_driver_id == driver_id
    if assignment is None:
        return False
    return assignment_covers_trip_start(assignment, trip)


def completed_trip_ranks_for_driver(db, driver_id: int) -> dict[int, int]:
    """Display # for this driver's completed trips, career-wide.

    1 = latest completed (newest end_time), then 2, 3, … In-progress
    trips are omitted so they stay unnumbered.
    """
    assignments = get_assignments_for_driver(db, driver_id)
    seen: dict[int, Trip] = {}
    for assignment in assignments:
        window_end = assignment.end_time
        query = db.query(Trip).filter(
            Trip.device_id == assignment.device_id,
            or_(Trip.end_time.is_(None), Trip.end_time >= assignment.start_time),
        )
        if window_end is not None:
            query = query.filter(Trip.start_time <= window_end)
        trips = query.all()
        for trip in trips:
            if trip.id in seen:
                continue
            if trip_attributed_to_driver(trip, driver_id, assignment):
                seen[trip.id] = trip

    # Confirmed-to-this-driver trips that never had an assignment to them.
    for trip in (
        db.query(Trip)
        .filter(Trip.confirmed_driver_id == driver_id)
        .all()
    ):
        seen[trip.id] = trip

    completed = [
        trip for trip in seen.values()
        if trip.status == "completed" and trip.end_time is not None
    ]
    completed.sort(key=lambda trip: trip.end_time, reverse=True)
    return {trip.id: index for index, trip in enumerate(completed, start=1)}


def _resolve_pending_confirmation_alert(db, device_id: int) -> None:
    open_alert = (
        db.query(DeviceAlert)
        .filter_by(
            device_id=device_id,
            alert_type=TRIP_DRIVER_PENDING_ALERT,
            is_resolved=False,
        )
        .first()
    )
    if open_alert is not None:
        open_alert.is_resolved = True
        open_alert.resolved_at = datetime.utcnow()


def release_trip_driver_borrow(db, trip: Trip, at_time: datetime | None = None) -> None:
    """Restore a borrowed driver to their original vehicle if it stayed empty.

    Prefer keeping `borrowed_from_device_id` for audit; only acts when that
    device currently has no open assignment.
    """
    if trip.borrowed_from_device_id is None or trip.confirmed_driver_id is None:
        return

    at_time = at_time or trip.end_time or datetime.utcnow()
    if get_active_assignment_for_device(db, trip.borrowed_from_device_id) is not None:
        return

    # Don't restore if the driver is already open on some other vehicle.
    if get_active_assignment_for_driver(db, trip.confirmed_driver_id) is not None:
        return

    db.add(DriverAssignment(
        driver_id=trip.confirmed_driver_id,
        device_id=trip.borrowed_from_device_id,
        start_time=at_time,
        end_time=None,
    ))


def confirm_trip_driver(
    db,
    trip: Trip,
    driver_id: int,
    confirmed_by_user_id: int | None = None,
    at_time: datetime | None = None,
) -> Trip:
    """Confirm who drove this trip. Trip-only; does not permanently reassign
    the trip's vehicle. May temporarily unassign another vehicle when
    borrowing its active driver (in-progress trips only).
    """
    from fastapi import HTTPException

    at_time = at_time or datetime.utcnow()
    driver = db.query(Driver).filter(Driver.id == driver_id).first()
    if driver is None:
        raise HTTPException(status_code=404, detail="Driver not found")
    if driver.status != "active":
        raise HTTPException(status_code=400, detail="Only active drivers can be confirmed")

    busy = (
        db.query(Trip.id)
        .filter(
            Trip.status == "in_progress",
            Trip.confirmed_driver_id == driver_id,
            Trip.id != trip.id,
        )
        .first()
    )
    if busy is not None:
        raise HTTPException(
            status_code=400,
            detail="Driver is already confirmed on another ongoing trip",
        )

    # Live borrow/release only while the trip is open — confirming a
    # completed trip is a historical attribution edit only.
    if trip.status == "in_progress":
        if trip.confirmed_driver_id is not None and (
            trip.confirmed_driver_id != driver_id or trip.borrowed_from_device_id is not None
        ):
            release_trip_driver_borrow(db, trip, at_time=at_time)
            trip.borrowed_from_device_id = None

        expected_driver, _ = get_driver_for_trip(
            db, trip.device_id, trip.start_time, trip.status
        )
        expected_id = expected_driver.id if expected_driver else None

        trip.borrowed_from_device_id = None
        if driver_id != expected_id:
            open_assignment = get_active_assignment_for_driver(db, driver_id)
            if open_assignment is not None and open_assignment.device_id != trip.device_id:
                trip.borrowed_from_device_id = open_assignment.device_id
                open_assignment.end_time = at_time

    trip.confirmed_driver_id = driver_id
    trip.driver_confirmed_at = at_time
    trip.driver_confirmed_by_user_id = confirmed_by_user_id

    _resolve_pending_confirmation_alert(db, trip.device_id)
    db.commit()
    db.refresh(trip)
    return trip


def get_confirmable_drivers(db, trip_id: int) -> list[Driver]:
    """Active drivers available to confirm for this trip.

    Excludes drivers already confirmed on a *different* in-progress trip.
    The current trip's confirmed driver (if any) remains selectable.
    """
    trip = db.query(Trip).filter(Trip.id == trip_id).first()
    if trip is None:
        return []

    busy_ids = {
        row[0]
        for row in (
            db.query(Trip.confirmed_driver_id)
            .filter(
                Trip.status == "in_progress",
                Trip.confirmed_driver_id.isnot(None),
                Trip.id != trip_id,
            )
            .all()
        )
        if row[0] is not None
    }

    query = db.query(Driver).filter(Driver.status == "active")
    if busy_ids:
        query = query.filter(~Driver.id.in_(busy_ids))
    return query.order_by(Driver.name.asc()).all()


def apply_confirmation_fields(trip_out, trip: Trip, confirmed_driver: Driver | None) -> None:
    """Populate confirmation-related TripOut fields in place."""
    if trip.confirmed_driver_id is not None and confirmed_driver is not None:
        trip_out.driver_confirmation_status = "confirmed"
        trip_out.confirmed_driver_id = confirmed_driver.id
        trip_out.confirmed_driver_name = confirmed_driver.name
        trip_out.confirmed_driver_pic_url = (
            f"/uploads/{confirmed_driver.driver_pic_path}"
            if confirmed_driver.driver_pic_path else None
        )
    else:
        trip_out.driver_confirmation_status = "pending"
        trip_out.confirmed_driver_id = None
        trip_out.confirmed_driver_name = None
        trip_out.confirmed_driver_pic_url = None


def resolve_confirmed_drivers_for_trips(db, trips) -> dict[int, Driver | None]:
    """Batch-load confirmed drivers for trip list endpoints."""
    if not trips:
        return {}
    driver_ids = {
        trip.confirmed_driver_id
        for trip in trips
        if trip.confirmed_driver_id is not None
    }
    drivers_by_id = {
        driver.id: driver
        for driver in (
            db.query(Driver).filter(Driver.id.in_(driver_ids)).all() if driver_ids else []
        )
    }
    return {
        trip.id: drivers_by_id.get(trip.confirmed_driver_id)
        for trip in trips
    }


def effective_trip_driver_id(trip: Trip, assigned_driver: Driver | None) -> int | None:
    """Driver id used for filtering/grouping: confirmed wins, else assigned."""
    if trip.confirmed_driver_id is not None:
        return trip.confirmed_driver_id
    return assigned_driver.id if assigned_driver else None


def populate_trip_out_drivers(db, trip_out, trip: Trip) -> None:
    """Fill assigned + confirmed driver fields on a TripOut instance."""
    driver, driver_alert = get_driver_for_trip(
        db, trip.device_id, trip.start_time, trip.status
    )
    trip_out.driver_id = driver.id if driver else None
    trip_out.driver_name = driver.name if driver else None
    trip_out.driver_pic_url = (
        f"/uploads/{driver.driver_pic_path}" if driver and driver.driver_pic_path else None
    )
    trip_out.driver_alert = driver_alert

    confirmed = None
    if trip.confirmed_driver_id is not None:
        confirmed = db.query(Driver).filter(Driver.id == trip.confirmed_driver_id).first()
    apply_confirmation_fields(trip_out, trip, confirmed)


def serialize_confirmable_driver(db, driver: Driver) -> dict:
    assignment = get_active_assignment_for_driver(db, driver.id)
    device = None
    if assignment is not None:
        device = db.query(Device).filter(Device.id == assignment.device_id).first()
    return {
        "id": driver.id,
        "name": driver.name,
        "driver_pic_url": (
            f"/uploads/{driver.driver_pic_path}" if driver.driver_pic_path else None
        ),
        "current_device_id": assignment.device_id if assignment else None,
        "current_device_name": device.name if device else None,
    }


def get_assignments_for_driver(db, driver_id: int) -> list[DriverAssignment]:
    """Full assignment history for a driver, newest first."""
    return (
        db.query(DriverAssignment)
        .filter(DriverAssignment.driver_id == driver_id)
        .order_by(DriverAssignment.start_time.desc())
        .all()
    )


def get_driver_for_trip(db, device_id: int, trip_start: datetime, trip_status: str) -> tuple[Driver | None, bool]:
    """Driver who was actively assigned to `device_id` at `trip_start`.

    Returns (driver, alert). `alert` is True only when the trip is
    still in_progress AND the vehicle has no actively-assigned driver
    RIGHT NOW — that's the "ongoing trip, nobody assigned" case that
    should be surfaced prominently. A completed trip with no driver on
    record is not an alert, just informational (driver_name will be
    None).
    """
    assignment = (
        db.query(DriverAssignment)
        .filter(
            DriverAssignment.device_id == device_id,
            DriverAssignment.start_time <= trip_start,
            or_(DriverAssignment.end_time.is_(None), DriverAssignment.end_time > trip_start),
        )
        .order_by(DriverAssignment.start_time.desc())
        .first()
    )

    driver = None
    if assignment is not None:
        driver = db.query(Driver).filter(Driver.id == assignment.driver_id).first()

    alert = False
    if trip_status == "in_progress":
        alert = get_active_assignment_for_device(db, device_id) is None

    return driver, alert


def resolve_drivers_for_trips(db, trips) -> dict[int, tuple[Driver | None, bool]]:
    """Batch version of get_driver_for_trip for trip list endpoints.

    Loads covering assignments + drivers (+ open assignments for
    in-progress alerts) in a handful of queries instead of 2–3 per trip.
    Returns {trip.id: (driver, alert)}.
    """
    if not trips:
        return {}

    device_ids = {trip.device_id for trip in trips if trip.device_id is not None}
    trip_starts = [trip.start_time for trip in trips if trip.start_time is not None]
    if not device_ids or not trip_starts:
        return {trip.id: (None, False) for trip in trips}

    min_start = min(trip_starts)
    max_start = max(trip_starts)

    assignments = (
        db.query(DriverAssignment)
        .filter(
            DriverAssignment.device_id.in_(device_ids),
            DriverAssignment.start_time <= max_start,
            or_(DriverAssignment.end_time.is_(None), DriverAssignment.end_time > min_start),
        )
        .order_by(DriverAssignment.start_time.desc())
        .all()
    )

    assignments_by_device: dict[int, list[DriverAssignment]] = {}
    driver_ids: set[int] = set()
    for assignment in assignments:
        assignments_by_device.setdefault(assignment.device_id, []).append(assignment)
        driver_ids.add(assignment.driver_id)

    drivers_by_id = {
        driver.id: driver
        for driver in (
            db.query(Driver).filter(Driver.id.in_(driver_ids)).all() if driver_ids else []
        )
    }

    in_progress_device_ids = {
        trip.device_id for trip in trips if trip.status == "in_progress"
    }
    devices_with_active: set[int] = set()
    if in_progress_device_ids:
        for (device_id,) in (
            db.query(DriverAssignment.device_id)
            .filter(
                DriverAssignment.device_id.in_(in_progress_device_ids),
                DriverAssignment.end_time.is_(None),
            )
            .distinct()
            .all()
        ):
            devices_with_active.add(device_id)

    resolved: dict[int, tuple[Driver | None, bool]] = {}
    for trip in trips:
        assignment = None
        for candidate in assignments_by_device.get(trip.device_id, []):
            if candidate.start_time <= trip.start_time and (
                candidate.end_time is None or candidate.end_time > trip.start_time
            ):
                assignment = candidate
                break

        driver = drivers_by_id.get(assignment.driver_id) if assignment is not None else None
        alert = trip.status == "in_progress" and trip.device_id not in devices_with_active
        resolved[trip.id] = (driver, alert)

    return resolved


def get_live_driver_alert(db, device_id: int) -> tuple[Driver | None, bool]:
    """Current-moment version of the same check, used by /api/live and
    the vehicle-report page header: is there a trip in progress right
    now on this vehicle with nobody assigned to it?
    """
    open_trip = (
        db.query(Trip)
        .filter(Trip.device_id == device_id, Trip.status == "in_progress")
        .order_by(Trip.start_time.desc())
        .first()
    )

    active_assignment = get_active_assignment_for_device(db, device_id)
    driver = None
    if active_assignment is not None:
        driver = db.query(Driver).filter(Driver.id == active_assignment.driver_id).first()

    alert = open_trip is not None and active_assignment is None
    return driver, alert


async def apply_driver_form_update(
    db,
    driver: Driver,
    *,
    name: str | None = None,
    id_card_number: str | None = None,
    phone_number: str | None = None,
    license_number: str | None = None,
    license_expiry=None,
    status: str | None = None,
    date_joined=None,
    license_pic=None,
    driver_pic=None,
) -> Driver:
    """Shared field/upload update used by admin PATCH /api/drivers/{id}
    and manager PATCH /api/manager/{id}/drivers/{id}. Mutates `driver`,
    commits, and returns it. Raises HTTPException on CNIC clash.
    """
    from fastapi import HTTPException

    from tracker_backend.schemas import validate_cnic
    from tracker_backend.services.uploads import delete_upload, save_upload

    if id_card_number is not None and id_card_number != driver.id_card_number:
        validate_cnic(id_card_number)
        clash = db.query(Driver).filter(
            Driver.id_card_number == id_card_number, Driver.id != driver.id
        ).first()
        if clash is not None:
            raise HTTPException(status_code=400, detail="A driver with this ID card number already exists")
        driver.id_card_number = id_card_number

    if name is not None:
        driver.name = name
    if phone_number is not None:
        driver.phone_number = phone_number
    if license_number is not None:
        driver.license_number = license_number
    if license_expiry is not None:
        driver.license_expiry = license_expiry
    if status is not None:
        driver.status = status
    if date_joined is not None:
        driver.date_joined = date_joined

    if license_pic is not None and getattr(license_pic, "filename", None):
        new_path = await save_upload(license_pic, "drivers/license")
        delete_upload(driver.license_pic_path)
        driver.license_pic_path = new_path

    if driver_pic is not None and getattr(driver_pic, "filename", None):
        new_path = await save_upload(driver_pic, "drivers/photo")
        delete_upload(driver.driver_pic_path)
        driver.driver_pic_path = new_path

    db.commit()
    db.refresh(driver)
    return driver


def empty_driver_detail_totals() -> dict:
    return {
        "trip_count": 0,
        "distance_km": 0.0,
        "duration_min": 0.0,
        "total_fuel_liters": 0.0,
        "fuel_avg_km_l": None,
        "fuel_cost_pkr": 0.0,
        "toll_tax_pkr": 0.0,
        "challan_pkr": 0.0,
        "challan_count": 0,
        "total_cost_pkr": 0.0,
        "harsh_brake_count": 0,
        "harsh_accel_count": 0,
        "overspeed_count": 0,
        "idle_count": 0,
    }


def serialize_driver_detail_trip(trip, *, device_name, geofence_name, assignment_id) -> dict:
    return {
        "id": trip.id,
        "assignment_id": assignment_id,
        "device_id": trip.device_id,
        "device_name": device_name,
        "status": trip.status,
        "geofence_name": geofence_name,
        "trip_date": trip.trip_date.isoformat() if trip.trip_date else None,
        "start_time": _utc_iso(trip.start_time) if trip.start_time else None,
        "end_time": _utc_iso(trip.end_time) if trip.end_time else None,
        "distance_km": trip.distance_km,
        "duration_min": trip.duration_min,
        "driving_fuel_liters": trip.driving_fuel_liters,
        "idle_fuel_liters": trip.idle_fuel_liters,
        "total_fuel_liters": trip.total_fuel_liters,
        "price_per_liter_used": trip.price_per_liter_used,
        "fuel_cost_pkr": trip.fuel_cost_pkr,
        "toll_tax_pkr": trip.toll_tax_pkr,
        "challan_pkr": trip.challan_pkr,
        "max_speed_kmh": trip.max_speed_kmh,
        "harsh_brake_count": trip.harsh_brake_count,
        "harsh_accel_count": trip.harsh_accel_count,
        "overspeed_count": trip.overspeed_count,
        "idle_count": trip.idle_count,
    }


def accumulate_driver_detail_totals(totals: dict, trip) -> None:
    totals["trip_count"] += 1
    totals["distance_km"] += trip.distance_km or 0
    totals["duration_min"] += trip.duration_min or 0
    totals["total_fuel_liters"] += trip.total_fuel_liters or 0
    totals["fuel_cost_pkr"] += trip.fuel_cost_pkr or 0
    totals["toll_tax_pkr"] += trip.toll_tax_pkr or 0
    totals["challan_pkr"] += trip.challan_pkr or 0
    if (trip.challan_pkr or 0) > 0:
        totals["challan_count"] += 1
    totals["harsh_brake_count"] += trip.harsh_brake_count or 0
    totals["harsh_accel_count"] += trip.harsh_accel_count or 0
    totals["overspeed_count"] += trip.overspeed_count or 0
    totals["idle_count"] += trip.idle_count or 0


def finalize_driver_detail_totals(totals: dict) -> dict:
    fuel = totals["total_fuel_liters"]
    distance = totals["distance_km"]
    totals["fuel_avg_km_l"] = round(distance / fuel, 2) if fuel else None
    totals["total_cost_pkr"] = (
        totals["fuel_cost_pkr"] + totals["toll_tax_pkr"] + totals["challan_pkr"]
    )
    for key in (
        "distance_km",
        "duration_min",
        "total_fuel_liters",
        "fuel_cost_pkr",
        "toll_tax_pkr",
        "challan_pkr",
        "total_cost_pkr",
    ):
        totals[key] = round(totals[key], 2)
    return totals
