"""
Maintenance due-status computation — shared by the status endpoint
(main.py), the baseline auto-fill logic (main.py's records endpoint),
and the background alert monitor (maintenance_monitor.py).

Mirrors the pattern used by driver_service.py: plain functions taking
a `db` session, no class state.
"""

from datetime import date as date_cls

from sqlalchemy import func

from tracker_backend.models import (
    Device, DevicePosition, MaintenanceItem, MaintenanceItemTypeDefault,
    VehicleMaintenanceSetting, MaintenanceRecord, MaintenanceRecordLine,
    MaintenanceDueSnapshot, MaintenanceDueSnapshotLine,
)

# Items that don't apply to certain vehicle types even though they exist
# in the catalog (bikes are air-cooled — no AC filter/coolant — and
# have no windshield/wipers; van/truck are assumed diesel — no spark
# plugs). Checked BEFORE falling back to the vehicle_type=NULL default
# row, so these never silently pick up the fallback interval. See the
# maintenance feature plan §2.
NOT_APPLICABLE = {
    ("bike", "ac_filter"),
    ("bike", "coolant"),
    ("bike", "wiper_blades"),
    ("van", "spark_plugs"),
    ("truck", "spark_plugs"),
}

DUE_SOON_THRESHOLD = 0.8
OVERDUE_THRESHOLD = 1.0


def get_latest_odometer_km(db, device_id: int) -> float | None:
    """Latest known odometer reading for a device, from its most recent
    DevicePosition's total_distance (same field report.py uses for
    distance calculations, here taken from the single latest fix
    instead of a date range). Returns None if the device has no
    position history yet (brand new, never polled)."""
    position = (
        db.query(DevicePosition)
        .filter(DevicePosition.device_id == device_id)
        .order_by(DevicePosition.fix_time.desc())
        .first()
    )
    if position is None or position.total_distance is None:
        return None
    return round(position.total_distance / 1000.0, 2)


def get_applicable_items(db, vehicle_type: str | None) -> list[MaintenanceItem]:
    """Active catalog items applicable to this vehicle_type — excludes
    anything in NOT_APPLICABLE for this type. Ordered by sort_order."""
    items = (
        db.query(MaintenanceItem)
        .filter(MaintenanceItem.is_active.is_(True))
        .order_by(MaintenanceItem.sort_order.asc())
        .all()
    )
    return [item for item in items if (vehicle_type, item.key) not in NOT_APPLICABLE]


def resolve_effective_interval(db, device: Device, item: MaintenanceItem):
    """Returns (dimension, interval_value, source) for device+item, in
    priority order: vehicle override -> type default -> NULL-fallback
    default -> None (not applicable). `source` is "vehicle" | "type" |
    "fallback". A manual vehicle override always wins, even if the
    item would otherwise be not-applicable for this vehicle_type."""
    override = (
        db.query(VehicleMaintenanceSetting)
        .filter_by(device_id=device.id, item_id=item.id)
        .first()
    )
    if override is not None:
        return override.dimension, override.interval_value, "vehicle"

    if (device.vehicle_type, item.key) in NOT_APPLICABLE:
        return None

    if device.vehicle_type:
        type_default = (
            db.query(MaintenanceItemTypeDefault)
            .filter_by(item_id=item.id, vehicle_type=device.vehicle_type)
            .first()
        )
        if type_default is not None:
            return type_default.dimension, type_default.interval_value, "type"

    fallback = (
        db.query(MaintenanceItemTypeDefault)
        .filter_by(item_id=item.id, vehicle_type=None)
        .first()
    )
    if fallback is not None:
        return fallback.dimension, fallback.interval_value, "fallback"

    return None


def _resolve_interval_from_maps(
    device: Device,
    item: MaintenanceItem,
    overrides_by_item: dict,
    defaults_by_item: dict,
):
    """Same resolution as resolve_effective_interval, using prefetched maps."""
    override = overrides_by_item.get(item.id)
    if override is not None:
        return override.dimension, override.interval_value, "vehicle"

    if (device.vehicle_type, item.key) in NOT_APPLICABLE:
        return None

    defaults = defaults_by_item.get(item.id) or {}
    if device.vehicle_type and device.vehicle_type in defaults:
        type_default = defaults[device.vehicle_type]
        return type_default.dimension, type_default.interval_value, "type"

    fallback = defaults.get(None)
    if fallback is not None:
        return fallback.dimension, fallback.interval_value, "fallback"

    return None


def get_last_service_line(db, device_id: int, item_id: int) -> MaintenanceRecordLine | None:
    """Most recent MaintenanceRecordLine for this device+item, across all
    records, ordered by the parent record's record_date desc, then line
    id desc as tiebreak."""
    return (
        db.query(MaintenanceRecordLine)
        .join(MaintenanceRecord, MaintenanceRecordLine.record_id == MaintenanceRecord.id)
        .filter(MaintenanceRecord.device_id == device_id, MaintenanceRecordLine.item_id == item_id)
        .order_by(MaintenanceRecord.record_date.desc(), MaintenanceRecordLine.id.desc())
        .first()
    )


def _prefetch_last_service_lines(db, device_id: int, item_ids: list[int]) -> dict[int, MaintenanceRecordLine]:
    """Latest MaintenanceRecordLine per item_id for a device (one query)."""
    if not item_ids:
        return {}

    lines = (
        db.query(MaintenanceRecordLine)
        .join(MaintenanceRecord, MaintenanceRecordLine.record_id == MaintenanceRecord.id)
        .filter(
            MaintenanceRecord.device_id == device_id,
            MaintenanceRecordLine.item_id.in_(item_ids),
        )
        .order_by(
            MaintenanceRecordLine.item_id.asc(),
            MaintenanceRecord.record_date.desc(),
            MaintenanceRecordLine.id.desc(),
        )
        .all()
    )
    latest: dict[int, MaintenanceRecordLine] = {}
    for line in lines:
        if line.item_id not in latest:
            latest[line.item_id] = line
    return latest


def _prefetch_interval_maps(db, device: Device, item_ids: list[int]):
    """Prefetch vehicle overrides and type defaults for the given items."""
    overrides_by_item = {}
    if item_ids:
        overrides = (
            db.query(VehicleMaintenanceSetting)
            .filter(
                VehicleMaintenanceSetting.device_id == device.id,
                VehicleMaintenanceSetting.item_id.in_(item_ids),
            )
            .all()
        )
        overrides_by_item = {row.item_id: row for row in overrides}

    defaults_by_item: dict[int, dict] = {}
    if item_ids:
        defaults = (
            db.query(MaintenanceItemTypeDefault)
            .filter(MaintenanceItemTypeDefault.item_id.in_(item_ids))
            .all()
        )
        for row in defaults:
            defaults_by_item.setdefault(row.item_id, {})[row.vehicle_type] = row

    return overrides_by_item, defaults_by_item


def compute_item_status(
    db,
    device: Device,
    item: MaintenanceItem,
    current_odometer_km: float | None,
    current_engine_hours: float | None,
    *,
    resolved=None,
    last_line: MaintenanceRecordLine | None = None,
    last_line_loaded: bool = False,
) -> dict | None:
    """Computes the due-status dict for one device+item. Returns None if
    the item isn't applicable to this vehicle at all (no resolvable
    interval) — callers should exclude it from the response entirely.

    Optional `resolved` / `last_line` avoid per-item DB hits when the
    caller has prefetched maps (see get_status_for_device)."""
    if resolved is None:
        resolved = resolve_effective_interval(db, device, item)
    if resolved is None:
        return None
    dimension, interval_value, source = resolved

    if not last_line_loaded:
        last_line = get_last_service_line(db, device.id, item.id)
    if last_line is None:
        # No baseline yet for this item — can only happen before the
        # baseline record is submitted (baseline submission guarantees
        # every applicable item gets a line, see main.py).
        return {
            "item_id": item.id, "key": item.key, "label": item.label,
            "dimension": dimension, "interval_value": interval_value,
            "interval_source": source,
            "last_service_value": None, "current_value": None,
            "progress_pct": None, "status": "no_baseline",
        }

    last_value = (
        last_line.service_odometer_km if dimension == "distance"
        else last_line.service_engine_hours
    )
    current_value = current_odometer_km if dimension == "distance" else current_engine_hours

    if current_value is None or last_value is None:
        # Either engine hours were never recorded for this vehicle
        # (dimension == "engine_hours" and Device.engine_hours is None),
        # or (for a distance-tracked item) the device has no GPS
        # position history yet — either way, progress isn't computable.
        return {
            "item_id": item.id, "key": item.key, "label": item.label,
            "dimension": dimension, "interval_value": interval_value,
            "interval_source": source,
            "last_service_value": last_value, "current_value": current_value,
            "progress_pct": None, "status": "unknown",
        }

    elapsed = max(0.0, current_value - last_value)
    progress_pct = elapsed / interval_value if interval_value else 0.0

    if progress_pct >= OVERDUE_THRESHOLD:
        status = "overdue"
    elif progress_pct >= DUE_SOON_THRESHOLD:
        status = "due_soon"
    else:
        status = "ok"

    return {
        "item_id": item.id, "key": item.key, "label": item.label,
        "dimension": dimension, "interval_value": interval_value,
        "interval_source": source,
        "last_service_value": last_value, "current_value": current_value,
        "progress_pct": round(progress_pct, 4), "status": status,
    }


def get_status_for_device(db, device: Device) -> dict:
    """Full status payload for the Maintenance page / alert monitor: has
    a baseline been submitted, current odometer/engine hours, and the
    per-item due status for every applicable item. `items` is always
    populated (even before a baseline exists) — compute_item_status
    naturally returns status="no_baseline" for each item when there's
    no prior service line yet, which is what the frontend's baseline
    setup form renders (same item list/inputs as a normal maintenance
    entry, just with "No data" status pills).

    Prefetches overrides, type defaults, and latest service lines so
    status stays O(few queries) instead of O(items)."""
    has_baseline = (
        db.query(MaintenanceRecord)
        .filter(MaintenanceRecord.device_id == device.id)
        .first()
        is not None
    )

    odometer_km = get_latest_odometer_km(db, device.id)
    current_engine_hours = device.engine_hours

    items = get_applicable_items(db, device.vehicle_type)
    item_ids = [item.id for item in items]
    overrides_by_item, defaults_by_item = _prefetch_interval_maps(db, device, item_ids)
    last_lines = _prefetch_last_service_lines(db, device.id, item_ids)

    items_out = []
    for item in items:
        resolved = _resolve_interval_from_maps(
            device, item, overrides_by_item, defaults_by_item,
        )
        status = compute_item_status(
            db,
            device,
            item,
            odometer_km,
            current_engine_hours,
            resolved=resolved,
            last_line=last_lines.get(item.id) if resolved is not None else None,
            last_line_loaded=True,
        )
        if status is not None:
            items_out.append(status)

    return {
        "device_id": device.id,
        "has_baseline": has_baseline,
        "odometer_km": odometer_km,
        "engine_hours": current_engine_hours,
        "items": items_out,
    }


def count_due_vehicles(db, device_ids: list[int] | None = None) -> tuple[int, int]:
    """How many vehicles have due_soon / overdue items, from the latest
    daily snapshot — not live get_status_for_device per device (that
    path is far too slow for the admin dashboard).

    Returns (due_or_overdue_count, overdue_only_count). Zeroes if no
    snapshot has been taken yet.
    """
    if device_ids is not None and not device_ids:
        return 0, 0

    snapshot_date_q = db.query(func.max(MaintenanceDueSnapshot.snapshot_date))
    if device_ids is not None:
        snapshot_date_q = snapshot_date_q.filter(
            MaintenanceDueSnapshot.device_id.in_(device_ids),
        )
    snapshot_date = snapshot_date_q.scalar()
    if snapshot_date is None:
        return 0, 0

    def _count(statuses: tuple[str, ...]) -> int:
        query = (
            db.query(func.count(func.distinct(MaintenanceDueSnapshot.device_id)))
            .join(
                MaintenanceDueSnapshotLine,
                MaintenanceDueSnapshotLine.snapshot_id == MaintenanceDueSnapshot.id,
            )
            .filter(
                MaintenanceDueSnapshot.snapshot_date == snapshot_date,
                MaintenanceDueSnapshotLine.status.in_(statuses),
            )
        )
        if device_ids is not None:
            query = query.filter(MaintenanceDueSnapshot.device_id.in_(device_ids))
        return query.scalar() or 0

    return _count(("due_soon", "overdue")), _count(("overdue",))


def ensure_daily_snapshot(db, device: Device, today: date_cls | None = None) -> None:
    """Idempotently creates today's MaintenanceDueSnapshot (+ per-item
    lines) for a device, if one doesn't already exist. Called every poll
    cycle from maintenance_monitor.check_maintenance_due() — cheap
    no-op on every call after the first one each day, since the
    unique (device_id, snapshot_date) constraint is checked via a
    plain SELECT before inserting. Does not commit — caller owns the
    transaction (same pattern as check_maintenance_for_device).

    A snapshot is only taken once a baseline exists (mirrors
    get_status_for_device — no items to snapshot before that), and is
    skipped for a device that already has one for `today`.
    """
    today = today or date_cls.today()

    existing = (
        db.query(MaintenanceDueSnapshot.id)
        .filter_by(device_id=device.id, snapshot_date=today)
        .first()
    )
    if existing is not None:
        return

    status = get_status_for_device(db, device)
    if not status["has_baseline"]:
        return

    snapshot = MaintenanceDueSnapshot(
        device_id=device.id,
        snapshot_date=today,
        odometer_km=status["odometer_km"],
        engine_hours=status["engine_hours"],
    )
    db.add(snapshot)
    db.flush()  # get snapshot.id without a full commit yet

    for item_status in status["items"]:
        db.add(MaintenanceDueSnapshotLine(
            snapshot_id=snapshot.id,
            item_id=item_status["item_id"],
            dimension=item_status["dimension"],
            interval_value=item_status["interval_value"],
            last_service_value=item_status["last_service_value"],
            current_value=item_status["current_value"],
            progress_pct=item_status["progress_pct"],
            status=item_status["status"],
        ))


def get_due_report(db, device: Device, start: date_cls | None = None, end: date_cls | None = None) -> dict:
    """Maintenance Due Report data: the item catalog (for stable column
    headers) plus one row per stored daily snapshot, newest first —
    same shape/ordering convention as list_maintenance_records. `end`
    is exclusive, same convention as the records endpoint's date-range
    filter in main.py."""
    columns = get_applicable_items(db, device.vehicle_type)
    column_ids = [item.id for item in columns]

    query = db.query(MaintenanceDueSnapshot).filter(MaintenanceDueSnapshot.device_id == device.id)
    if start is not None:
        query = query.filter(MaintenanceDueSnapshot.snapshot_date >= start)
    if end is not None:
        query = query.filter(MaintenanceDueSnapshot.snapshot_date < end)
    snapshots = query.order_by(MaintenanceDueSnapshot.snapshot_date.desc()).all()

    snapshot_ids = [s.id for s in snapshots]
    lines_by_snapshot = {}
    if snapshot_ids:
        all_lines = (
            db.query(MaintenanceDueSnapshotLine)
            .filter(MaintenanceDueSnapshotLine.snapshot_id.in_(snapshot_ids))
            .all()
        )
        for line in all_lines:
            lines_by_snapshot.setdefault(line.snapshot_id, {})[line.item_id] = line

    items_by_id = {item.id: item for item in columns}

    rows = []
    for snapshot in snapshots:
        lines_for_row = lines_by_snapshot.get(snapshot.id, {})
        line_items = []
        for item_id in column_ids:
            line = lines_for_row.get(item_id)
            item = items_by_id[item_id]
            if line is None:
                # Item wasn't applicable/resolvable on the day this
                # snapshot was taken (e.g. added later) — show as
                # unknown rather than omitting the cell.
                line_items.append({
                    "item_id": item_id, "key": item.key, "label": item.label,
                    "dimension": None, "interval_value": None,
                    "last_service_value": None, "current_value": None,
                    "progress_pct": None, "status": "unknown",
                })
            else:
                line_items.append({
                    "item_id": item_id, "key": item.key, "label": item.label,
                    "dimension": line.dimension, "interval_value": line.interval_value,
                    "last_service_value": line.last_service_value,
                    "current_value": line.current_value,
                    "progress_pct": line.progress_pct, "status": line.status,
                })
        rows.append({
            "snapshot_date": snapshot.snapshot_date,
            "odometer_km": snapshot.odometer_km,
            "engine_hours": snapshot.engine_hours,
            "lines": line_items,
        })

    return {
        "device_id": device.id,
        "items": [{"id": i.id, "key": i.key, "label": i.label, "sort_order": i.sort_order} for i in columns],
        "rows": rows,
    }