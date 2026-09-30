# tracker_backend/main.py
import asyncio
import logging
from contextlib import asynccontextmanager
from datetime import date, datetime, timedelta

import httpx
from fastapi import Depends, FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from sqlalchemy import func, or_
from sqlalchemy.orm import Session, load_only
from tracker_backend.db import SessionLocal
from tracker_backend.models import (
    Device, FuelType, FuelPrice, Geofence, Driver, DriverAssignment, DeviceAlert,
    MaintenanceItem, MaintenanceRecord, MaintenanceRecordLine, VehicleMaintenanceSetting,
    Trip, User, Manager, PermissionDefinition, AlertTypeSetting, Route, RouteVehicle,
    TripRouteMatch, DevicePosition,
)
from tracker_backend.schemas import (
    DeviceCreate, DeviceUpdate, DeviceOut,
    FuelTypeOut, FuelTypeCreate,
    FuelPriceCreate, FuelPriceUpdate, FuelPriceOut,
    GeofenceCreate, GeofenceUpdate, GeofenceOut,
    TripOut, AdminTripOut,
    DriverOut, DriverAssignmentOut,
    AlertOut, AlertSummaryOut, AdminDashboardSummaryOut,
    DashboardTrendsOut, DashboardMaintenanceTrendsOut,
    MaintenanceItemOut, MaintenanceStatusOut, MaintenanceEngineHoursUpdate,
    MaintenanceRecordCreate, MaintenanceRecordOut, MaintenanceDueReportOut,
    VehicleMaintenanceSettingUpdate, VehicleMaintenanceSettingOut,
    validate_cnic,
    UserCreate, UserUpdate, UserOut, UserVehicleOut,
    PasswordRevealOut,
    ManagerCreate, ManagerOut, ManagerDetailOut, ManagerPermissionsUpdate,
    ManagerAssignUsers, ManagerUnassignUser,
    UserPermissionsUpdate, NotificationPrefsUpdate, NotificationPrefsOut,
    PermissionDefinitionOut, PermissionDefinitionCreate, PermissionDefinitionUpdate,
    AlertTypeSettingOut, AlertTypeSettingUpdate,
    RouteCreate, RoutePreviewOut, RouteUpdate, RouteVehicleAssign, RouteListOut,
    RouteAssignedVehicleWithDriverOut, RouteOut, RouteVehicleMatchOut,
    RouteMatchedTripOut, RouteOtherTripOut, TripRouteDetailOut,
    TripCostsUpdate, TripDriverConfirm, ConfirmableDriverOut,
    TripRouteConfirm, ConfirmableRouteOut,
)

from tracker_backend.db import SessionLocal
from tracker_backend.models import Device
from tracker_backend.services.traccar import traccar_service
from tracker_backend.services.cache import traccar_cache, alert_type_settings_cache
from tracker_backend.services.settings_catalog import (
    ensure_alert_type_settings,
    ensure_permission_definitions,
    merge_bell_prefs,
    offered_alert_types,
    active_permission_keys,
    revoke_alert_type_from_managers,
    revoke_permission_from_managers,
    user_applicable_keys,
)
from tracker_backend.services import position_writer
from tracker_backend.services.report import get_daily_report, get_distance_trend_points, _utc_iso
from tracker_backend.services.fuel_price_reflow import (
    upsert_fuel_price_with_reflow,
    delete_fuel_price_with_reflow,
    get_applicable_fuel_price,
    get_applicable_fuel_price_row,
)
from tracker_backend.services.dashboard_summary import (
    aggregate_trips_for_period,
    count_assigned_driver_buckets,
    period_window_utc,
)
from tracker_backend.services.dashboard_trends import (
    TREND_PERIOD_DAYS,
    get_dashboard_maintenance_points,
    get_dashboard_trend_points,
)
from tracker_backend.services.trip_tracker import (
    calculate_trip_metrics,
    get_trips_in_range,
    get_trips_in_range_fleet_wide,
    backfill_missed_trips,
    backfill_gapped_trip_positions,
)
from tracker_backend.services import driver_service
from tracker_backend.services import route_assignment_service
from tracker_backend.services import manager_service
from tracker_backend.services import user_service
from tracker_backend.services import maintenance_service
from tracker_backend.services import maintenance_monitor
from tracker_backend.services import routing_service
from tracker_backend.services import route_matcher
from tracker_backend.services.uploads import UPLOAD_ROOT, save_upload, delete_upload
from tracker_backend.config import settings
from tracker_backend.auth_routes import router as auth_router
from tracker_backend.deps import get_current_admin
from tracker_backend.services import auth_service
from tracker_backend.poller import poll_loop, poll_once
from tracker_backend.manager_panel import router as manager_panel_router
from tracker_backend.manager_panel_routes import router as manager_panel_routes_router
from tracker_backend.manager_panel_geofences import router as manager_panel_geofences_router
from tracker_backend.manager_panel_trips import build_admin_trips

logging.basicConfig(level=logging.INFO)

IDLE_DEFAULTS_BY_VEHICLE_TYPE = {
    "bike": 0.15,
    "car": 0.6,
    "van": 0.9,
    "truck": 1.8,
}
DEFAULT_IDLE_FALLBACK = 0.8

# Background gap repair interval — must not block HTTP (see lifespan).
GAP_REPAIR_INTERVAL_SECONDS = 6 * 60 * 60


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Do one synchronous poll immediately on startup so the cache isn't
    # empty for the first 5 seconds while a user is looking at the app.
    try:
        await poll_once()
    except Exception as e:
        logging.getLogger("startup").error("Initial poll failed: %s", e)
        traccar_cache.record_error(str(e))

    # Reconcile trips against full position history BEFORE the live
    # poll loop starts — catches trips missed or left stuck
    # "in_progress" across a previous restart/downtime, using the
    # already-persisted DevicePosition history rather than live state.
    # Safe to run every startup (idempotent).
    try:
        await asyncio.to_thread(backfill_missed_trips)
    except Exception as e:
        logging.getLogger("startup").error("Trip backfill failed: %s", e)

    # Then hand off to the background loop for every poll after that.
    task = asyncio.create_task(poll_loop())

    # Copy missed Traccar history into device_positions in the background.
    # Must not run inline: an unreachable Traccar host would delay the API
    # from serving (this hung overnight during the first repair attempt).
    # Re-runs every 6h so Period Playback DB stays complete without
    # request-time Traccar in GET /api/route.
    gap_task = asyncio.create_task(_run_position_gap_repair_loop())

    yield

    gap_task.cancel()
    task.cancel()
    await traccar_service.aclose()


async def _run_position_gap_repair_once():
    """One pass: trip windows, then device calendar holes, then trip reconcile."""
    logger = logging.getLogger("startup")
    trip_stats = await asyncio.to_thread(backfill_gapped_trip_positions)
    logger.info("Trip position gap backfill complete: %s", trip_stats)
    device_stats = await asyncio.to_thread(position_writer.backfill_gapped_device_ranges)
    logger.info("Device-range position gap backfill complete: %s", device_stats)
    # Always reconcile trips after repair (same as historical startup order).
    await asyncio.to_thread(backfill_missed_trips)


async def _run_position_gap_repair_loop():
    logger = logging.getLogger("startup")
    while True:
        try:
            await _run_position_gap_repair_once()
        except asyncio.CancelledError:
            raise
        except Exception as e:
            logger.error("Position gap backfill failed: %s", e)
        try:
            await asyncio.sleep(GAP_REPAIR_INTERVAL_SECONDS)
        except asyncio.CancelledError:
            raise


app = FastAPI(
    title="Tracker API",
    description="GPS Tracker Backend using Traccar",
    version="2.0.0",
    lifespan=lifespan,
)

app.include_router(auth_router)

# Manager-scoped panel routes (`/api/manager/{manager_id}/...`). Kept
# in manager_panel.py / manager_panel_routes.py so they stay separate
# from the unrestricted admin `/api/managers*` CRUD below.
app.include_router(manager_panel_router)
app.include_router(manager_panel_routes_router)
app.include_router(manager_panel_geofences_router)

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

# Comma-separated FRONTEND_URL allows split hosting (e.g. DO UI + Hostinger UI).
_cors_origins = [
    origin.strip()
    for origin in settings.FRONTEND_URL.split(",")
    if origin.strip()
]
app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Serve driver photos / license scans. UPLOAD_ROOT is backend/uploads —
# created on first run if it doesn't exist yet, since StaticFiles
# requires the directory to already be there at mount time.
UPLOAD_ROOT.mkdir(parents=True, exist_ok=True)
app.mount("/uploads", StaticFiles(directory=str(UPLOAD_ROOT)), name="uploads")


def _pic_url(relative_path: str | None) -> str | None:
    return f"/uploads/{relative_path}" if relative_path else None


def _device_out(db: Session, device: Device) -> DeviceOut:
    """Builds a DeviceOut, filling in the owner's username/name/phone
    (if this vehicle has an owner) — not columns on Device itself, so
    resolved here on every read, same pattern as _driver_out below.
    """
    out = DeviceOut.model_validate(device)
    if device.user_id is not None:
        owner = db.query(User).filter(User.id == device.user_id).first()
        if owner is not None:
            out.owner_username = owner.username
            out.owner_full_name = owner.full_name
            out.owner_phone_number = owner.phone_number
    out.pic_url = _pic_url(device.pic_path)
    return out


def _route_point_dict(lat: float, lon: float) -> dict:
    return {"lat": lat, "lon": lon}


def _route_out(db: Session, route: Route) -> RouteOut:
    assignments = (
        db.query(RouteVehicle, Device)
        .join(Device, Device.id == RouteVehicle.device_id)
        .filter(RouteVehicle.route_id == route.id, RouteVehicle.end_time.is_(None))
        .all()
    )
    return RouteOut(
        id=route.id,
        name=route.name,
        direction_label=route.direction_label,
        waypoints=route.waypoints or [],
        path=route.path or [],
        tolerance_meters=route.tolerance_meters,
        assigned_vehicles=[
            {"id": device.id, "name": device.name}
            for _assignment, device in assignments
        ],
        created_at=route.created_at,
    )


# ─────────────────────────────────────────
# TIME RANGE HELPERS — shared by /api/report, /api/vehicle-report, and
# /api/trips so a single date, or an explicit start/end range, resolve
# to bounds the exact same way everywhere.
# ─────────────────────────────────────────

def _parse_flexible_datetime(value: str) -> datetime:
    """Parses a datetime string from the frontend. `<input type="datetime-local">`
    sends values like '2026-08-05T14:00' (no seconds, no timezone) —
    this also tolerates a trailing 'Z' or included seconds. Always
    returns a naive datetime, treated as UTC, consistent with every
    other timestamp in this codebase (fix_time, last_seen_at, etc.) and
    with how the existing single `date` picker already behaves.
    """
    cleaned = value.strip()
    if cleaned.endswith("Z"):
        cleaned = cleaned[:-1]
    try:
        return datetime.fromisoformat(cleaned)
    except ValueError:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid datetime: {value!r}, expected e.g. '2026-08-05T14:00'",
        )


def _resolve_time_range(
    date_param: str | None,
    start_param: str | None,
    end_param: str | None,
):
    """Resolves report/trip time bounds from either a single `date`
    (single-day mode, the original behavior) or explicit `start`/`end`
    datetimes (range mode, new).

    - `start` and `end` both given -> range mode: used as-is.
    - otherwise, `date` given (or defaulted to today, UTC) -> single-day
      mode: midnight to midnight UTC for that calendar date.

    Returns (start_dt, end_dt, label, price_lookup_date) where `label`
    is a display string for the response and `price_lookup_date` is the
    calendar date used to look up the applicable fuel price (the start
    of the range).
    """
    if start_param and end_param:
        start_dt = _parse_flexible_datetime(start_param)
        end_dt = _parse_flexible_datetime(end_param)
        if end_dt <= start_dt:
            raise HTTPException(status_code=400, detail="`end` must be after `start`")
        label = f"{start_dt.isoformat()} to {end_dt.isoformat()}"
        return start_dt, end_dt, label, start_dt.date()

    date_str = date_param or datetime.utcnow().date().isoformat()
    try:
        start_dt = datetime.strptime(date_str, "%Y-%m-%d")
    except ValueError:
        raise HTTPException(
            status_code=400, detail=f"Invalid date: {date_str!r}, expected 'YYYY-MM-DD'"
        )
    end_dt = start_dt + timedelta(days=1)
    return start_dt, end_dt, date_str, start_dt.date()


def _resolve_route_match_window(
    range_key: str,
    date_param: str | None,
    start_param: str | None,
    end_param: str | None,
):
    today = datetime.utcnow().date()

    if range_key == "today":
        start_dt = datetime.combine(today, datetime.min.time())
        return start_dt, start_dt + timedelta(days=1)

    if range_key == "week":
        week_start = today - timedelta(days=today.weekday())
        start_dt = datetime.combine(week_start, datetime.min.time())
        return start_dt, start_dt + timedelta(days=7)

    if range_key == "month":
        month_start = today.replace(day=1)
        next_month = (
            month_start.replace(year=month_start.year + 1, month=1)
            if month_start.month == 12
            else month_start.replace(month=month_start.month + 1)
        )
        start_dt = datetime.combine(month_start, datetime.min.time())
        end_dt = datetime.combine(next_month, datetime.min.time())
        return start_dt, end_dt

    if range_key == "date":
        if not date_param:
            raise HTTPException(status_code=400, detail="`date` is required when range=date")
        start_dt = datetime.strptime(date_param, "%Y-%m-%d")
        return start_dt, start_dt + timedelta(days=1)

    if range_key == "range":
        if not start_param or not end_param:
            raise HTTPException(status_code=400, detail="`start` and `end` are required when range=range")
        start_dt = datetime.strptime(start_param, "%Y-%m-%d")
        end_dt = datetime.strptime(end_param, "%Y-%m-%d") + timedelta(days=1)
        if end_dt <= start_dt:
            raise HTTPException(status_code=400, detail="`end` must be on or after `start`")
        return start_dt, end_dt

    raise HTTPException(
        status_code=400,
        detail="Invalid range. Use today, week, month, date, or range.",
    )


# ─────────────────────────────────────────
# HEALTH CHECK
# ─────────────────────────────────────────
@app.get("/")
async def root():
    return {"status": "running", "message": "Tracker API is working"}


# ─────────────────────────────────────────
# CACHE STATUS — useful while testing locally
# ─────────────────────────────────────────
@app.get("/api/cache/status")
async def cache_status():
    """Shows when the cache last refreshed successfully, and whether the
    most recent poll attempt failed (while still serving last-good data)."""
    return traccar_cache.status()


# ─────────────────────────────────────────
# DEVICES — served from cache, instant
# ─────────────────────────────────────────
@app.get("/api/devices")
async def get_devices():
    """All registered devices, raw from Traccar (cached, refreshed every
    5 seconds by the background poller)."""
    return {
        "success": True,
        "count": len(traccar_cache.devices),
        "cache_status": traccar_cache.status(),
        "devices": traccar_cache.devices,
    }

# ─────────────────────────────────────────
# FLEET DEVICE CRUD (your own DB, richer than Traccar's raw device list)
# ─────────────────────────────────────────

@app.post("/api/fleet/devices", response_model=DeviceOut)
async def create_fleet_device(payload: DeviceCreate, db: Session = Depends(get_db)):
    """Registers the device in Traccar AND stores fleet metadata locally.
    Vehicles are always created with a user (Add User); standalone
    ownerless devices are not allowed.
    """
    if payload.user_id is None:
        raise HTTPException(
            status_code=400,
            detail="user_id is required — vehicles are created together with a user.",
        )
    # One vehicle per user (product decision — see migration
    # 934f74786d41 / models.Device.user_id's unique=True). Checked
    # before the Traccar call so we don't register a device in
    # Traccar and then fail to save it locally.
    clash = db.query(Device).filter(Device.user_id == payload.user_id).first()
    if clash is not None:
        raise HTTPException(
            status_code=400,
            detail="This user already owns a vehicle — each user can own at most one.",
        )

    try:
        traccar_device = await traccar_service.create_device(payload.name, payload.imei)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Failed to register device in Traccar: {e}")

    payload_fields = payload.dict(exclude_unset=True)
    fuel_avg_idle = payload.fuel_avg_idle
    fuel_avg_idle_auto = True

    if payload.fuel_avg_running is not None and "fuel_avg_idle" not in payload_fields:
        fuel_avg_idle = IDLE_DEFAULTS_BY_VEHICLE_TYPE.get(
            payload.vehicle_type, DEFAULT_IDLE_FALLBACK
        )
        fuel_avg_idle_auto = True
    elif "fuel_avg_idle" in payload_fields:
        fuel_avg_idle_auto = False

    device = Device(
        traccar_device_id=traccar_device["id"],
        name=payload.name,
        vehicle_type=payload.vehicle_type,
        plate_number=payload.plate_number,
        fuel_type_id=payload.fuel_type_id,
        fuel_avg_running=payload.fuel_avg_running,
        fuel_avg_idle=fuel_avg_idle,
        fuel_avg_idle_auto=fuel_avg_idle_auto,
        primary_geofence_id=payload.primary_geofence_id,
        user_id=payload.user_id,
    )
    db.add(device)
    db.commit()
    db.refresh(device)
    return _device_out(db, device)


@app.get("/api/fleet/devices", response_model=list[DeviceOut])
def list_fleet_devices(db: Session = Depends(get_db)):
    return [_device_out(db, d) for d in db.query(Device).all()]


@app.get("/api/fleet/devices/all")
async def list_all_devices_merged(db: Session = Depends(get_db)):
    """Union of every device Traccar currently reports AND every device
    row in our local DB, matched by traccar_device_id (which can differ
    from our own `id`). Powers the Fleet Devices page so devices that
    exist on only one side — most commonly a DB row left behind after a
    device was deleted directly on the Traccar server — are still
    visible and can be cleaned up from here, instead of only showing up
    on pages that read straight from the DB (like Select a Vehicle).

    Each entry is flagged with `in_traccar` / `in_db` so the frontend
    can show an "orphaned" indicator, and carries both `db_id` and
    `traccar_id` so the delete button can call the right endpoint.
    """
    traccar_devices = traccar_cache.devices
    positions_by_device = {p["deviceId"]: p for p in traccar_cache.positions}

    db_devices = db.query(Device).all()
    db_by_traccar_id = {d.traccar_device_id: d for d in db_devices}

    traccar_ids_seen = set()
    merged = []

    for t_device in traccar_devices:
        t_id = t_device["id"]
        traccar_ids_seen.add(t_id)
        db_device = db_by_traccar_id.get(t_id)

        active_driver = None
        driver_alert = False
        if db_device is not None:
            driver, alert = driver_service.get_live_driver_alert(db, db_device.id)
            if driver is not None:
                active_driver = {"id": driver.id, "name": driver.name, "pic_url": _pic_url(driver.driver_pic_path)}
            driver_alert = alert

        merged.append({
            "db_id": db_device.id if db_device else None,
            "traccar_id": t_id,
            "name": (db_device.name if db_device else None) or t_device.get("name"),
            "vehicle_type": db_device.vehicle_type if db_device else None,
            "in_traccar": True,
            "in_db": db_device is not None,
            "device": t_device,
            "position": positions_by_device.get(t_id),
            "active_driver": active_driver,
            "driver_alert": driver_alert,
        })

    # DB rows whose traccar_device_id Traccar no longer reports at all —
    # orphaned rows, almost always left over from a device that was
    # deleted directly on the Traccar side rather than through this app.
    for d in db_devices:
        if d.traccar_device_id in traccar_ids_seen:
            continue
        merged.append({
            "db_id": d.id,
            "traccar_id": d.traccar_device_id,
            "name": d.name,
            "vehicle_type": d.vehicle_type,
            "in_traccar": False,
            "in_db": True,
            "device": None,
            "position": None,
            "active_driver": None,
            "driver_alert": False,
        })

    return {"success": True, "count": len(merged), "devices": merged}


@app.get("/api/fleet/devices/{device_id}", response_model=DeviceOut)
def get_fleet_device(device_id: int, db: Session = Depends(get_db)):
    device = db.query(Device).filter(Device.id == device_id).first()
    if not device:
        raise HTTPException(status_code=404, detail="Device not found")
    return _device_out(db, device)


@app.post("/api/fleet/devices/{device_id}/photo", response_model=DeviceOut)
async def upload_fleet_device_photo(
    device_id: int,
    pic: UploadFile = File(...),
    db: Session = Depends(get_db),
):
    from tracker_backend.services.fleet_device_service import set_device_pic

    device = db.query(Device).filter(Device.id == device_id).first()
    if not device:
        raise HTTPException(status_code=404, detail="Device not found")
    await set_device_pic(db, device, pic)
    return _device_out(db, device)


@app.patch("/api/fleet/devices/{device_id}", response_model=DeviceOut)
def update_fleet_device(device_id: int, payload: DeviceUpdate, db: Session = Depends(get_db)):
    device = db.query(Device).filter(Device.id == device_id).first()
    if not device:
        raise HTTPException(status_code=404, detail="Device not found")

    payload_fields = payload.dict(exclude_unset=True)

    if "user_id" in payload_fields and payload_fields["user_id"] != device.user_id:
        raise HTTPException(
            status_code=400,
            detail="Vehicle ownership cannot be changed. Delete the user (and their vehicle) instead.",
        )
    payload_fields.pop("user_id", None)

    for field, value in payload_fields.items():
        setattr(device, field, value)

    running_being_set = "fuel_avg_running" in payload_fields and payload_fields["fuel_avg_running"] is not None
    idle_explicitly_provided = "fuel_avg_idle" in payload_fields

    if running_being_set and not idle_explicitly_provided:
        effective_vehicle_type = payload_fields.get("vehicle_type", device.vehicle_type)
        device.fuel_avg_idle = IDLE_DEFAULTS_BY_VEHICLE_TYPE.get(
            effective_vehicle_type, DEFAULT_IDLE_FALLBACK
        )
        device.fuel_avg_idle_auto = True
    elif idle_explicitly_provided:
        device.fuel_avg_idle_auto = False

    db.commit()
    db.refresh(device)
    return _device_out(db, device)


@app.delete("/api/fleet/devices/{device_id}")
async def delete_fleet_device(device_id: int, db: Session = Depends(get_db)):
    from tracker_backend.services.fleet_device_service import delete_fleet_device_cascade

    device = db.query(Device).filter(Device.id == device_id).first()
    if not device:
        raise HTTPException(status_code=404, detail="Device not found")

    result = await delete_fleet_device_cascade(db, device)
    message = f"Device {device_id} deleted"
    if result["deleted_owner_username"]:
        message += f" along with owner {result['deleted_owner_username']}"
        if result["removed_manager"]:
            message += " (manager role removed)"
    return {"success": True, "message": message, **result}


@app.delete("/api/fleet/devices/by-traccar/{traccar_device_id}")
async def delete_traccar_only_device(traccar_device_id: int, db: Session = Depends(get_db)):
    """Deletes a device by its Traccar id, for the rare case where it
    exists in Traccar but has no local DB row yet (the poller normally
    creates one within 5 seconds, so this window is brief). Removes it
    from Traccar, and also deletes the matching DB row if one turns up.
    """
    try:
        await traccar_service.delete_device(traccar_device_id)
    except httpx.HTTPStatusError as e:
        if e.response.status_code != 404:
            raise HTTPException(status_code=502, detail=f"Failed to remove device from Traccar: {e}")
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Failed to remove device from Traccar: {e}")

    device = db.query(Device).filter(Device.traccar_device_id == traccar_device_id).first()
    if device:
        db.delete(device)
        db.commit()

    return {"success": True, "message": f"Traccar device {traccar_device_id} deleted"}


@app.get("/api/fleet/devices/{device_id}/driver")
def get_device_current_driver(device_id: int, db: Session = Depends(get_db)):
    """Currently-assigned driver for this vehicle, if any — used by the
    device edit page's driver-assignment control.
    """
    device = db.query(Device).filter(Device.id == device_id).first()
    if not device:
        raise HTTPException(status_code=404, detail="Device not found")

    open_assignment = driver_service.get_active_assignment_for_device(db, device_id)
    if open_assignment is None:
        return {"driver": None}

    driver = db.query(Driver).filter(Driver.id == open_assignment.driver_id).first()
    if driver is None:
        return {"driver": None}

    return {
        "driver": {
            "id": driver.id,
            "name": driver.name,
            "pic_url": _pic_url(driver.driver_pic_path),
            "assigned_since": _utc_iso(open_assignment.start_time),
        }
    }


# ─────────────────────────────────────────
# FUEL TYPES (lookup table)
# ─────────────────────────────────────────

@app.get("/api/fuel-types", response_model=list[FuelTypeOut])
def list_fuel_types(db: Session = Depends(get_db)):
    return db.query(FuelType).all()


@app.post("/api/fuel-types", response_model=FuelTypeOut)
def create_fuel_type(payload: FuelTypeCreate, db: Session = Depends(get_db)):
    fuel_type = FuelType(name=payload.name)
    db.add(fuel_type)
    db.commit()
    db.refresh(fuel_type)
    return fuel_type


# ─────────────────────────────────────────
# FUEL PRICES (daily, per fuel type)
# ─────────────────────────────────────────

@app.post("/api/fuel-prices", response_model=FuelPriceOut)
def upsert_fuel_price(payload: FuelPriceCreate, db: Session = Depends(get_db)):
    return upsert_fuel_price_with_reflow(
        db, payload.fuel_type_id, payload.price_per_liter, payload.effective_date_start
    )


@app.get("/api/fuel-prices", response_model=list[FuelPriceOut])
def list_fuel_prices(
    fuel_type_id: int | None = None,
    from_date: date | None = None,
    to_date: date | None = None,
    db: Session = Depends(get_db),
):
    query = db.query(FuelPrice)
    if fuel_type_id is not None:
        query = query.filter(FuelPrice.fuel_type_id == fuel_type_id)
    if from_date is not None:
        query = query.filter(FuelPrice.effective_date_start >= from_date)
    if to_date is not None:
        query = query.filter(FuelPrice.effective_date_start <= to_date)
    return query.order_by(FuelPrice.effective_date_start.desc()).all()


@app.get("/api/fuel-prices/latest", response_model=FuelPriceOut)
def get_latest_fuel_price(
    fuel_type_id: int,
    on_date: date | None = None,
    db: Session = Depends(get_db),
):
    lookup_date = on_date or date.today()
    price_row = get_applicable_fuel_price_row(db, fuel_type_id, lookup_date)
    if price_row is None:
        raise HTTPException(
            status_code=404,
            detail=f"No price set for this fuel type on or before {lookup_date}",
        )
    return price_row


@app.patch("/api/fuel-prices/{price_id}", response_model=FuelPriceOut)
def update_fuel_price(price_id: int, payload: FuelPriceUpdate, db: Session = Depends(get_db)):
    price = db.query(FuelPrice).filter(FuelPrice.id == price_id).first()
    if not price:
        raise HTTPException(status_code=404, detail="Fuel price not found")
    for field, value in payload.dict(exclude_unset=True).items():
        setattr(price, field, value)
    db.commit()
    db.refresh(price)
    return price


@app.delete("/api/fuel-prices/{price_id}")
def delete_fuel_price(price_id: int, db: Session = Depends(get_db)):
    deleted = delete_fuel_price_with_reflow(db, price_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Fuel price not found")
    return {"success": True, "message": f"Fuel price {price_id} deleted"}


# ─────────────────────────────────────────
# GEOFENCES
# ─────────────────────────────────────────

@app.post("/api/geofences", response_model=GeofenceOut)
def create_geofence(payload: GeofenceCreate, db: Session = Depends(get_db)):
    geofence = Geofence(**payload.dict())
    db.add(geofence)
    db.commit()
    db.refresh(geofence)
    return geofence


@app.get("/api/geofences", response_model=list[GeofenceOut])
def list_geofences(db: Session = Depends(get_db)):
    return db.query(Geofence).all()


@app.get("/api/geofences/{geofence_id}", response_model=GeofenceOut)
def get_geofence(geofence_id: int, db: Session = Depends(get_db)):
    geofence = db.query(Geofence).filter(Geofence.id == geofence_id).first()
    if not geofence:
        raise HTTPException(status_code=404, detail="Geofence not found")
    return geofence


@app.patch("/api/geofences/{geofence_id}", response_model=GeofenceOut)
def update_geofence(geofence_id: int, payload: GeofenceUpdate, db: Session = Depends(get_db)):
    geofence = db.query(Geofence).filter(Geofence.id == geofence_id).first()
    if not geofence:
        raise HTTPException(status_code=404, detail="Geofence not found")
    for field, value in payload.dict(exclude_unset=True).items():
        setattr(geofence, field, value)
    db.commit()
    db.refresh(geofence)
    return geofence


@app.delete("/api/geofences/{geofence_id}")
def delete_geofence(geofence_id: int, db: Session = Depends(get_db)):
    geofence = db.query(Geofence).filter(Geofence.id == geofence_id).first()
    if not geofence:
        raise HTTPException(status_code=404, detail="Geofence not found")
    db.delete(geofence)
    db.commit()
    return {"success": True, "message": f"Geofence {geofence_id} deleted"}


# ─────────────────────────────────────────
# ROUTES
# ─────────────────────────────────────────

@app.post("/api/routes/preview", response_model=RoutePreviewOut)
async def preview_route(payload: RouteCreate):
    path = await routing_service.get_road_path(
        [(point.lat, point.lon) for point in payload.waypoints]
    )
    return {
        "waypoints": payload.waypoints,
        "path": [_route_point_dict(lat, lon) for lat, lon in path],
    }


@app.post("/api/routes", response_model=RouteOut)
async def create_route(payload: RouteCreate, db: Session = Depends(get_db)):
    path = await routing_service.get_road_path(
        [(point.lat, point.lon) for point in payload.waypoints]
    )
    route = Route(
        name=payload.name,
        direction_label=payload.direction_label,
        waypoints=[point.model_dump() for point in payload.waypoints],
        path=[_route_point_dict(lat, lon) for lat, lon in path],
        tolerance_meters=payload.tolerance_meters or 400,
    )
    db.add(route)
    db.commit()
    db.refresh(route)
    try:
        route_matcher.backfill_route_matches(db, route)
    except Exception:
        db.rollback()
        logging.getLogger("routes").exception(
            "Route match backfill failed for route_id=%s", route.id
        )
    return _route_out(db, route)


@app.get("/api/routes", response_model=list[RouteListOut])
def list_routes(db: Session = Depends(get_db)):
    routes = db.query(Route).order_by(Route.created_at.desc(), Route.id.desc()).all()
    assignment_rows = (
        db.query(RouteVehicle, Device)
        .join(Device, Device.id == RouteVehicle.device_id)
        .filter(RouteVehicle.end_time.is_(None))
        .order_by(Device.name.asc())
        .all()
    )
    vehicles_by_route = {}
    device_ids = set()
    for assignment, device in assignment_rows:
        vehicles_by_route.setdefault(assignment.route_id, []).append(device)
        device_ids.add(device.id)

    driver_name_by_device = {}
    if device_ids:
        active_rows = (
            db.query(DriverAssignment, Driver)
            .join(Driver, Driver.id == DriverAssignment.driver_id)
            .filter(
                DriverAssignment.device_id.in_(device_ids),
                DriverAssignment.end_time.is_(None),
            )
            .order_by(DriverAssignment.start_time.desc())
            .all()
        )
        for assignment, driver in active_rows:
            if assignment.device_id not in driver_name_by_device:
                driver_name_by_device[assignment.device_id] = driver.name

    return [
        RouteListOut(
            id=route.id,
            name=route.name,
            direction_label=route.direction_label,
            vehicle_count=len(vehicles_by_route.get(route.id, [])),
            assigned_vehicles=[
                RouteAssignedVehicleWithDriverOut(
                    id=device.id,
                    name=device.name,
                    driver_name=driver_name_by_device.get(device.id),
                )
                for device in vehicles_by_route.get(route.id, [])
            ],
            created_at=route.created_at,
        )
        for route in routes
    ]


@app.get("/api/routes/{route_id}", response_model=RouteOut)
def get_route_detail(route_id: int, db: Session = Depends(get_db)):
    route = db.query(Route).filter(Route.id == route_id).first()
    if not route:
        raise HTTPException(status_code=404, detail="Route not found")
    return _route_out(db, route)


@app.patch("/api/routes/{route_id}", response_model=RouteOut)
async def update_route(route_id: int, payload: RouteUpdate, db: Session = Depends(get_db)):
    route = db.query(Route).filter(Route.id == route_id).first()
    if not route:
        raise HTTPException(status_code=404, detail="Route not found")

    updates = payload.dict(exclude_unset=True)
    if "waypoints" in updates and updates["waypoints"] is not None:
        path = await routing_service.get_road_path(
            [(point.lat, point.lon) for point in payload.waypoints]
        )
        route.waypoints = [point.model_dump() for point in payload.waypoints]
        route.path = [_route_point_dict(lat, lon) for lat, lon in path]

    for field in ("name", "direction_label", "tolerance_meters"):
        if field in updates:
            setattr(route, field, updates[field])

    db.commit()
    db.refresh(route)
    return _route_out(db, route)


@app.delete("/api/routes/{route_id}")
def delete_route(route_id: int, db: Session = Depends(get_db)):
    route = db.query(Route).filter(Route.id == route_id).first()
    if not route:
        raise HTTPException(status_code=404, detail="Route not found")
    db.delete(route)
    db.commit()
    return {"success": True, "message": f"Route {route_id} deleted"}


@app.post("/api/routes/{route_id}/vehicles")
def assign_route_vehicle(route_id: int, payload: RouteVehicleAssign, db: Session = Depends(get_db)):
    route = db.query(Route).filter(Route.id == route_id).first()
    if not route:
        raise HTTPException(status_code=404, detail="Route not found")
    device = db.query(Device).filter(Device.id == payload.device_id).first()
    if not device:
        raise HTTPException(status_code=404, detail="Device not found")

    _assignment, created = route_assignment_service.assign_route(
        db, route_id, payload.device_id
    )
    if created:
        try:
            route_matcher.backfill_route_matches(db, route, device_ids=[payload.device_id])
        except Exception:
            db.rollback()
            logging.getLogger("routes").exception(
                "Route match backfill failed for route_id=%s device_id=%s",
                route_id,
                payload.device_id,
            )

    return {"success": True}


@app.delete("/api/routes/{route_id}/vehicles/{device_id}")
def unassign_route_vehicle(route_id: int, device_id: int, db: Session = Depends(get_db)):
    assignment = route_assignment_service.unassign_route(db, route_id, device_id)
    if assignment is None:
        raise HTTPException(status_code=404, detail="Route assignment not found")
    return {"success": True}


@app.post("/api/routes/{route_id}/recalculate")
def recalculate_route_matches(route_id: int, db: Session = Depends(get_db)):
    route = db.query(Route).filter(Route.id == route_id).first()
    if not route:
        raise HTTPException(status_code=404, detail="Route not found")
    try:
        route_matcher.backfill_route_matches(db, route)
    except Exception:
        db.rollback()
        logging.getLogger("routes").exception(
            "Route match backfill failed for route_id=%s", route_id
        )
    return {"success": True}


@app.post("/api/admin/recompute-route-matches")
def admin_recompute_all_route_matches(db: Session = Depends(get_db)):
    """Recompute route match data for every route and every assigned device.

    Iterates dynamically over all routes and devices currently in the
    database and re-runs the full matching pipeline against the entire
    completed-trip history (no date cutoff). Existing TripRouteMatch rows
    are overwritten with freshly computed values.

    This endpoint is idempotent — calling it multiple times is safe.
    Intended for admin use after a matching-algorithm fix is deployed, so
    stale stored results are brought up to date without needing a new
    script each time.
    """
    _log = logging.getLogger("admin")
    _log.info("admin_recompute_all_route_matches: starting full recompute")
    try:
        summary = route_matcher.recompute_all_route_matches(db)
    except Exception:
        _log.exception("admin_recompute_all_route_matches: unexpected failure")
        raise HTTPException(status_code=500, detail="Recompute failed — check server logs.")
    _log.info("admin_recompute_all_route_matches: complete — %s", summary)
    return {"success": True, **summary}


@app.get("/api/routes/{route_id}/vehicles", response_model=list[RouteVehicleMatchOut])
def list_route_match_vehicles(
    route_id: int,
    range: str = "today",
    date: str | None = None,
    start: str | None = None,
    end: str | None = None,
    db: Session = Depends(get_db),
):
    route = db.query(Route).filter(Route.id == route_id).first()
    if not route:
        raise HTTPException(status_code=404, detail="Route not found")

    start_dt, end_dt = _resolve_route_match_window(range, date, start, end)
    return route_assignment_service.list_assigned_route_vehicle_trip_counts(
        db, route_id, start_dt, end_dt,
    )


@app.get("/api/routes/{route_id}/other-trips", response_model=list[RouteOtherTripOut])
def list_route_other_trips(
    route_id: int,
    range: str = "today",
    date: str | None = None,
    start: str | None = None,
    end: str | None = None,
    db: Session = Depends(get_db),
):
    route = db.query(Route).filter(Route.id == route_id).first()
    if not route:
        raise HTTPException(status_code=404, detail="Route not found")

    start_dt, end_dt = _resolve_route_match_window(range, date, start, end)
    trips = route_assignment_service.list_other_trips_for_route(db, route_id, start_dt, end_dt)
    percents = route_assignment_service.match_percent_by_trip_id(
        db, route_id, [trip.id for trip in trips],
    )
    device_ids = {trip.device_id for trip in trips}
    devices = (
        db.query(Device).filter(Device.id.in_(device_ids)).all() if device_ids else []
    )
    name_by_id = {device.id: device.name for device in devices}
    return [
        RouteOtherTripOut(
            trip_id=trip.id,
            device_id=trip.device_id,
            vehicle_name=name_by_id.get(trip.device_id) or "—",
            date=route_assignment_service.trip_display_date(trip),
            start_time=trip.start_time,
            end_time=trip.end_time,
            match_percent=percents.get(trip.id, 0) or 0,
        )
        for trip in trips
        if route_assignment_service.trip_display_date(trip) is not None
    ]


@app.get("/api/routes/{route_id}/vehicles/{device_id}/trips", response_model=list[RouteMatchedTripOut])
def list_route_vehicle_trips(
    route_id: int,
    device_id: int,
    range: str = "today",
    date: str | None = None,
    start: str | None = None,
    end: str | None = None,
    db: Session = Depends(get_db),
):
    start_dt, end_dt = _resolve_route_match_window(range, date, start, end)
    trips = route_assignment_service.list_device_trips_attributed_to_route(
        db, route_id, device_id, start_dt, end_dt,
    )
    percents = route_assignment_service.match_percent_by_trip_id(
        db, route_id, [trip.id for trip in trips],
    )
    return [
        RouteMatchedTripOut(
            trip_id=trip.id,
            date=route_assignment_service.trip_display_date(trip),
            start_time=trip.start_time,
            end_time=trip.end_time,
            match_percent=percents.get(trip.id, 0) or 0,
        )
        for trip in trips
        if route_assignment_service.trip_display_date(trip) is not None
    ]


@app.get("/api/trips/{trip_id}/route-detail", response_model=TripRouteDetailOut)
def get_trip_route_detail(
    trip_id: int,
    route_id: int,
    max_points: int | None = 4000,
    db: Session = Depends(get_db),
):
    if max_points is not None and max_points < 2:
        raise HTTPException(status_code=400, detail="max_points must be at least 2")

    detail = route_matcher.build_trip_route_detail(db, trip_id, route_id, max_points)
    if detail is None:
        raise HTTPException(status_code=404, detail="Trip route match not found")
    return detail


# ─────────────────────────────────────────
# TRIPS
# ─────────────────────────────────────────

@app.get("/api/trips", response_model=list[AdminTripOut])
def list_all_trips(
    trip_date: date | None = None,
    start: str | None = None,
    end: str | None = None,
    status: str | None = None,
    driver_id: int | None = None,
    device_id: int | None = None,
    manager_id: int | None = None,
    geofence_id: int | None = None,
    db: Session = Depends(get_db),
):
    """Fleet-wide trips, either for a single day (`trip_date`) or an
    explicit `start`/`end` datetime range. With no time args, returns
    every trip (admin period preset "All").

    Uses get_trips_in_range_fleet_wide, which matches on the trip's
    actual start_time/end_time rather than its fixed trip_date (same
    reason as list_trips: an open trip that started on a previous day
    must still show up today).

    Unlike list_trips this does NOT renumber trip_number — each trip
    keeps its real per-device number. Driver filtering happens AFTER
    driver resolution (driver assignment is time-ranged, not a
    column on Trip) — see build_admin_trips / get_trips_in_range_fleet_wide.
    """
    return build_admin_trips(
        db,
        trip_date=trip_date,
        start=start,
        end=end,
        status=status,
        driver_id=driver_id,
        device_id=device_id,
        manager_id=manager_id,
        geofence_id=geofence_id,
    )


@app.get("/api/trips/{device_id}", response_model=list[TripOut])
def list_trips(
    device_id: int,
    trip_date: date | None = None,
    start: str | None = None,
    end: str | None = None,
    lite: bool = False,
    db: Session = Depends(get_db),
):
    """Trips for a device, either for a single day (`trip_date`), an
    explicit `start`/`end` datetime range, or with no time args every
    trip for that device (period preset "All").

    Uses get_trips_in_range / get_trips_in_range_fleet_wide, which match
    on the trip's actual start_time/end_time rather than its fixed
    trip_date — this is what makes an open trip that started on a
    previous day still show up today.

    `lite=true` skips driver resolution (Playback list only needs trip
    identity, times, distance, status, geofence_id). Same TripOut schema;
    driver_* fields stay null.
    """
    fetch_all = trip_date is None and not start and not end
    if fetch_all:
        start_dt, end_dt = None, None
        trips = get_trips_in_range_fleet_wide(db, None, None, device_id=device_id)
    else:
        start_dt, end_dt, _label, _price_date = _resolve_time_range(
            trip_date.isoformat() if trip_date else None, start, end
        )
        trips = get_trips_in_range(db, device_id, start_dt, end_dt)

    device = db.query(Device).filter(Device.id == device_id).first()
    if device:
        metrics_dirty = False
        for trip in trips:
            # Completed trips keep stored metrics; only open trips need
            # a live DevicePosition scan on list.
            if trip.status != "in_progress":
                continue
            calculate_trip_metrics(db, trip, device)
            metrics_dirty = True
        if metrics_dirty:
            db.commit()

    drivers_by_trip_id = (
        {} if lite else driver_service.resolve_drivers_for_trips(db, trips)
    )
    confirmed_by_trip_id = (
        {} if lite else driver_service.resolve_confirmed_drivers_for_trips(db, trips)
    )
    routes_by_trip_id = (
        {} if lite else route_assignment_service.resolve_routes_for_trips(db, trips)
    )
    confirmed_routes_by_trip_id = (
        {} if lite else route_assignment_service.resolve_confirmed_routes_for_trips(db, trips)
    )

    response = []
    for index, trip in enumerate(trips, start=1):
        trip_out = TripOut.model_validate(trip)
        trip_out.trip_number = index
        if not lite:
            driver, driver_alert = drivers_by_trip_id.get(trip.id, (None, False))
            trip_out.driver_id = driver.id if driver else None
            trip_out.driver_name = driver.name if driver else None
            trip_out.driver_pic_url = f"/uploads/{driver.driver_pic_path}" if driver and driver.driver_pic_path else None
            trip_out.driver_alert = driver_alert
            driver_service.apply_confirmation_fields(
                trip_out, trip, confirmed_by_trip_id.get(trip.id)
            )
            assigned_route = routes_by_trip_id.get(trip.id)
            trip_out.route_id = assigned_route.id if assigned_route else None
            trip_out.route_name = assigned_route.name if assigned_route else None
            route_assignment_service.apply_route_confirmation_fields(
                trip_out, trip, confirmed_routes_by_trip_id.get(trip.id)
            )
        response.append(trip_out)
    return response


@app.patch("/api/trips/{trip_id}", response_model=TripOut)
def update_trip_costs(trip_id: int, payload: TripCostsUpdate, db: Session = Depends(get_db)):
    trip = db.query(Trip).filter(Trip.id == trip_id).first()
    if not trip:
        raise HTTPException(status_code=404, detail="Trip not found")

    for field, value in payload.dict(exclude_unset=True).items():
        setattr(trip, field, value)

    db.commit()
    db.refresh(trip)

    trip_out = TripOut.model_validate(trip)
    driver_service.populate_trip_out_drivers(db, trip_out, trip)
    route_assignment_service.populate_trip_out_routes(db, trip_out, trip)
    return trip_out


@app.post("/api/trips/{trip_id}/confirm-driver", response_model=TripOut)
def confirm_trip_driver(
    trip_id: int,
    payload: TripDriverConfirm,
    db: Session = Depends(get_db),
):
    trip = db.query(Trip).filter(Trip.id == trip_id).first()
    if trip is None:
        raise HTTPException(status_code=404, detail="Trip not found")

    trip = driver_service.confirm_trip_driver(db, trip, payload.driver_id)
    trip_out = TripOut.model_validate(trip)
    driver_service.populate_trip_out_drivers(db, trip_out, trip)
    route_assignment_service.populate_trip_out_routes(db, trip_out, trip)
    return trip_out


@app.get("/api/trips/{trip_id}/confirmable-drivers", response_model=list[ConfirmableDriverOut])
def list_confirmable_drivers(trip_id: int, db: Session = Depends(get_db)):
    trip = db.query(Trip).filter(Trip.id == trip_id).first()
    if trip is None:
        raise HTTPException(status_code=404, detail="Trip not found")
    drivers = driver_service.get_confirmable_drivers(db, trip_id)
    return [
        ConfirmableDriverOut(**driver_service.serialize_confirmable_driver(db, d))
        for d in drivers
    ]


@app.post("/api/trips/{trip_id}/confirm-route", response_model=TripOut)
def confirm_trip_route(
    trip_id: int,
    payload: TripRouteConfirm,
    db: Session = Depends(get_db),
):
    trip = db.query(Trip).filter(Trip.id == trip_id).first()
    if trip is None:
        raise HTTPException(status_code=404, detail="Trip not found")

    trip = route_assignment_service.confirm_trip_route(db, trip, payload.route_id)
    trip_out = TripOut.model_validate(trip)
    driver_service.populate_trip_out_drivers(db, trip_out, trip)
    route_assignment_service.populate_trip_out_routes(db, trip_out, trip)
    return trip_out


@app.get("/api/trips/{trip_id}/confirmable-routes", response_model=list[ConfirmableRouteOut])
def list_confirmable_routes(trip_id: int, db: Session = Depends(get_db)):
    trip = db.query(Trip).filter(Trip.id == trip_id).first()
    if trip is None:
        raise HTTPException(status_code=404, detail="Trip not found")
    routes = route_assignment_service.get_confirmable_routes(db)
    return [
        ConfirmableRouteOut(**route_assignment_service.serialize_confirmable_route(db, route))
        for route in routes
    ]


@app.post("/api/trips/backfill")
def trigger_trip_backfill(db: Session = Depends(get_db)):
    """Manually re-run position-gap repair and trip reconciliation
    without restarting the server — handy after downtime (missing GPS
    trails), after fixing a geofence, or just to double check nothing's
    stuck.
    """
    gap_stats = backfill_gapped_trip_positions(db)
    device_stats = position_writer.backfill_gapped_device_ranges(db)
    backfill_missed_trips(db)
    return {
        "success": True,
        "message": "Trip and device-range backfill complete",
        "repaired_trips": gap_stats.get("repaired_trips", 0),
        "repaired_devices": device_stats.get("repaired_devices", 0),
        "inserted_positions": (
            gap_stats.get("inserted_positions", 0)
            + device_stats.get("inserted_positions", 0)
        ),
        "device_holes_filled": device_stats.get("holes_filled", 0),
    }


# ─────────────────────────────────────────
# USERS & MANAGERS
#
# A User is a person — currently the "vehicle owner" on Device (see
# _device_out above), and the pool of candidates that can be promoted
# to Manager. A Manager oversees a group of Users; "Total Vehicles" for
# a manager is just every vehicle owned by every user assigned to them
# (see manager_service.py for the assignment logic).
# ─────────────────────────────────────────

def _user_out(db: Session, user: User) -> UserOut:
    """Builds a UserOut, filling in is_manager + owned vehicles — not
    columns on User itself, so resolved here on every read.
    """
    out = UserOut.model_validate(user)
    out.is_manager = manager_service.get_manager_by_user_id(db, user.id) is not None
    out.has_password = bool(user.password_hash)
    out.pic_url = _pic_url(user.pic_path)
    vehicles = db.query(Device).filter(Device.user_id == user.id).all()
    out.vehicles = []
    for v in vehicles:
        vehicle_out = UserVehicleOut.model_validate(v)
        vehicle_out.pic_url = _pic_url(v.pic_path)
        out.vehicles.append(vehicle_out)
    return out


def _manager_out(db: Session, manager: Manager, include_assigned_users: bool = False):
    """Builds a ManagerOut (or ManagerDetailOut when include_assigned_users
    is set) by joining in the underlying User's identity fields and
    computing the assigned-user / total-vehicle counts — none of these
    are columns on Manager itself.
    """
    user = db.query(User).filter(User.id == manager.user_id).first()
    assigned_users = manager_service.get_assigned_users(db, manager.id)
    assigned_user_ids = [u.id for u in assigned_users]
    vehicle_count = (
        db.query(Device).filter(Device.user_id.in_(assigned_user_ids)).count()
        if assigned_user_ids else 0
    )

    base_fields = dict(
        id=manager.id,
        user_id=manager.user_id,
        username=user.username if user else "",
        full_name=user.full_name if user else None,
        phone_number=user.phone_number if user else None,
        pic_url=_pic_url(user.pic_path) if user else None,
        permissions=manager.permissions or {},
        notification_prefs=manager.notification_prefs or {},
        assigned_user_count=len(assigned_users),
        total_vehicle_count=vehicle_count,
        created_at=manager.created_at,
    )

    if include_assigned_users:
        return ManagerDetailOut(**base_fields, assigned_users=[_user_out(db, u) for u in assigned_users])
    return ManagerOut(**base_fields)


@app.post("/api/users", response_model=UserOut)
def create_user(payload: UserCreate, db: Session = Depends(get_db)):
    user = user_service.create_user_row(
        db,
        username=payload.username,
        password=payload.password,
        full_name=payload.full_name,
        phone_number=payload.phone_number,
    )
    return _user_out(db, user)


@app.get("/api/users", response_model=list[UserOut])
def list_users(
    q: str | None = None,
    unassigned: bool = False,
    exclude_managers: bool = False,
    db: Session = Depends(get_db),
):
    """List users, with optional filters used by the Managers page:
    - `q`: search by username or full name (case-insensitive substring)
    - `unassigned=true`: only users with no manager yet — candidate
      list for the "Assign Users" modal
    - `exclude_managers=true`: only users who are NOT already a manager
      — candidate list for the "Add New Manager" modal
    """
    query = db.query(User)

    if q:
        like = f"%{q}%"
        query = query.filter(or_(User.username.ilike(like), User.full_name.ilike(like)))

    if unassigned:
        query = query.filter(User.manager_id.is_(None))
        manager_user_ids = {m.user_id for m in db.query(Manager.user_id).all()}
        if manager_user_ids:
            query = query.filter(User.id.notin_(manager_user_ids))

    if exclude_managers:
        manager_user_ids = {m.user_id for m in db.query(Manager.user_id).all()}
        if manager_user_ids:
            query = query.filter(User.id.notin_(manager_user_ids))

    users = query.order_by(User.username.asc()).all()
    return [_user_out(db, u) for u in users]


@app.get("/api/users/{user_id}", response_model=UserOut)
def get_user(user_id: int, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    return _user_out(db, user)


@app.patch("/api/users/{user_id}/permissions", response_model=UserOut)
def update_user_permissions(user_id: int, payload: UserPermissionsUpdate, db: Session = Depends(get_db)):
    """Stores user-panel grants. Manager-only keys (applies_to_user=false)
    are rejected if set true. Enforcement is UI-only until login.
    """
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    allowed = user_applicable_keys(db)
    rejected = [
        key for key, enabled in (payload.permissions or {}).items()
        if enabled and key not in allowed
    ]
    if rejected:
        raise HTTPException(
            status_code=400,
            detail=f"Not user-applicable: {', '.join(sorted(rejected))}",
        )

    user.permissions = {
        key: bool(enabled)
        for key, enabled in (payload.permissions or {}).items()
        if key in allowed
    }
    db.commit()
    db.refresh(user)
    return _user_out(db, user)


@app.get("/api/users/{user_id}/notification-prefs", response_model=NotificationPrefsOut)
def get_user_notification_prefs(user_id: int, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    ensure_alert_type_settings(db)
    known = [row.alert_type for row in db.query(AlertTypeSetting).order_by(AlertTypeSetting.alert_type.asc()).all()]
    return NotificationPrefsOut(
        notification_prefs=merge_bell_prefs(user.notification_prefs, known, default=True),
    )


@app.patch("/api/users/{user_id}/notification-prefs", response_model=NotificationPrefsOut)
def update_user_notification_prefs(
    user_id: int,
    payload: NotificationPrefsUpdate,
    db: Session = Depends(get_db),
):
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    ensure_alert_type_settings(db)
    known = [row.alert_type for row in db.query(AlertTypeSetting).all()]
    known_set = set(known)
    stored = dict(user.notification_prefs or {})
    for alert_type, enabled in (payload.notification_prefs or {}).items():
        if alert_type in known_set:
            stored[alert_type] = bool(enabled)
    user.notification_prefs = stored
    db.commit()
    db.refresh(user)
    return NotificationPrefsOut(
        notification_prefs=merge_bell_prefs(user.notification_prefs, known, default=True),
    )


@app.patch("/api/users/{user_id}", response_model=UserOut)
def update_user(user_id: int, payload: UserUpdate, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    payload_fields = payload.dict(exclude_unset=True)
    new_password = payload_fields.pop("password", None)

    if "username" in payload_fields and payload_fields["username"] != user.username:
        clash = db.query(User).filter(User.username == payload_fields["username"], User.id != user_id).first()
        if clash is not None:
            raise HTTPException(status_code=400, detail="A user with this username already exists")

    for field, value in payload_fields.items():
        setattr(user, field, value)

    if new_password:
        auth_service.set_user_password(user, new_password)

    db.commit()
    db.refresh(user)
    return _user_out(db, user)


@app.get("/api/users/{user_id}/password", response_model=PasswordRevealOut)
def reveal_user_password(
    user_id: int,
    db: Session = Depends(get_db),
    _admin: dict = Depends(get_current_admin),
):
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    password = auth_service.decrypt_password(user.password_enc)
    if not password:
        raise HTTPException(status_code=404, detail="Password not available")
    return PasswordRevealOut(password=password)


@app.post("/api/users/{user_id}/photo", response_model=UserOut)
async def upload_user_photo(
    user_id: int,
    pic: UploadFile = File(...),
    db: Session = Depends(get_db),
):
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    await user_service.set_user_pic(db, user, pic)
    return _user_out(db, user)


@app.delete("/api/users/{user_id}")
async def delete_user(user_id: int, db: Session = Depends(get_db)):
    """Deletes a User and their paired vehicle (Traccar + local Device).
    Also used by CreateUserModal to roll back a just-created user when
    the mandatory vehicle POST fails (that user has no vehicle yet).

    If the user is a manager and owns a vehicle, cascade demotes them
    first (assigned users are unassigned) then deletes the pair.
    """
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    result = await user_service.delete_user_row(db, user)
    return {"detail": "User deleted", **result}


@app.get("/api/managers", response_model=list[ManagerOut])
def list_managers(q: str | None = None, db: Session = Depends(get_db)):
    """List all managers for the left-side panel on the Managers page.
    `q` filters by the promoted user's username or full name (the
    navbar search bar in the wireframe).
    """
    managers = db.query(Manager).all()
    out = [_manager_out(db, m) for m in managers]

    if q:
        ql = q.lower()
        out = [m for m in out if ql in m.username.lower() or ql in (m.full_name or "").lower()]

    out.sort(key=lambda m: m.username.lower())
    return out


@app.post("/api/managers", response_model=ManagerOut)
def create_manager(payload: ManagerCreate, db: Session = Depends(get_db)):
    """Promotes an existing user to Manager — the "+ Add New Manager"
    flow: pick a user from the list, they become a manager. Idempotent
    if the user is already a manager (returns their existing row).
    """
    user = db.query(User).filter(User.id == payload.user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    manager = manager_service.promote_user_to_manager(db, payload.user_id)
    return _manager_out(db, manager)


@app.get("/api/managers/permission-keys")
def get_manager_permission_keys(db: Session = Depends(get_db)):
    """Suggested permission checkbox list for the Permissions modal.
    Registered ABOVE /api/managers/{manager_id} on purpose — FastAPI
    matches routes in registration order, and "permission-keys" would
    otherwise be swallowed by {manager_id} (and 422 on the int parse)
    before ever reaching this one.

    Sourced from permission_definitions (active rows only) rather than
    a hardcoded list, so the admin Settings catalog is the single
    source of which keys the modal offers.
    """
    ensure_permission_definitions(db)
    rows = (
        db.query(PermissionDefinition)
        .filter(PermissionDefinition.is_active.is_(True))
        .order_by(PermissionDefinition.id.asc())
        .all()
    )
    return {"keys": [row.key for row in rows]}


@app.get("/api/managers/{manager_id}", response_model=ManagerDetailOut)
def get_manager(manager_id: int, db: Session = Depends(get_db)):
    """Full manager detail — profile, permissions, and every assigned
    user (each with their owned vehicles), which is what the manager
    detail panel + "Total Vehicles" section on the wireframe render.
    """
    manager = db.query(Manager).filter(Manager.id == manager_id).first()
    if not manager:
        raise HTTPException(status_code=404, detail="Manager not found")
    return _manager_out(db, manager, include_assigned_users=True)


@app.patch("/api/managers/{manager_id}/permissions", response_model=ManagerOut)
def update_manager_permissions(manager_id: int, payload: ManagerPermissionsUpdate, db: Session = Depends(get_db)):
    """Saves permission checkboxes for a manager. Inactive catalog keys
    cannot be granted — Settings is the option menu.
    """
    manager = db.query(Manager).filter(Manager.id == manager_id).first()
    if not manager:
        raise HTTPException(status_code=404, detail="Manager not found")

    allowed = active_permission_keys(db)
    stored = dict(manager.permissions or {})
    for key in list(stored):
        if key not in allowed:
            stored[key] = False
    for key, enabled in (payload.permissions or {}).items():
        if key in allowed:
            stored[key] = bool(enabled)
        else:
            stored[key] = False
    manager.permissions = stored
    db.commit()
    db.refresh(manager)
    return _manager_out(db, manager)


@app.get("/api/managers/{manager_id}/notification-prefs", response_model=NotificationPrefsOut)
def get_manager_notification_prefs(manager_id: int, db: Session = Depends(get_db)):
    manager = db.query(Manager).filter(Manager.id == manager_id).first()
    if not manager:
        raise HTTPException(status_code=404, detail="Manager not found")
    ensure_alert_type_settings(db)
    offered = offered_alert_types(db)
    known = [row.alert_type for row in db.query(AlertTypeSetting).order_by(AlertTypeSetting.alert_type.asc()).all()]
    stored = dict(manager.notification_prefs or {})
    for alert_type in known:
        if alert_type not in offered:
            stored[alert_type] = False
    return NotificationPrefsOut(
        notification_prefs=merge_bell_prefs(stored, known, default=True),
    )


@app.patch("/api/managers/{manager_id}/notification-prefs", response_model=NotificationPrefsOut)
def update_manager_notification_prefs(
    manager_id: int,
    payload: NotificationPrefsUpdate,
    db: Session = Depends(get_db),
):
    manager = db.query(Manager).filter(Manager.id == manager_id).first()
    if not manager:
        raise HTTPException(status_code=404, detail="Manager not found")
    ensure_alert_type_settings(db)
    offered = offered_alert_types(db)
    known = [row.alert_type for row in db.query(AlertTypeSetting).all()]
    stored = dict(manager.notification_prefs or {})
    for alert_type in known:
        if alert_type not in offered:
            stored[alert_type] = False
    for alert_type, enabled in (payload.notification_prefs or {}).items():
        if alert_type in offered:
            stored[alert_type] = bool(enabled)
        elif alert_type in set(known):
            stored[alert_type] = False
    manager.notification_prefs = stored
    db.commit()
    db.refresh(manager)
    return NotificationPrefsOut(
        notification_prefs=merge_bell_prefs(manager.notification_prefs, known, default=True),
    )


@app.delete("/api/managers/{manager_id}")
def delete_manager(manager_id: int, db: Session = Depends(get_db)):
    """Demotes a manager back to a plain user. Everyone assigned to
    them is unassigned (manager_id -> NULL), not deleted, first — see
    manager_service.demote_manager.
    """
    manager = db.query(Manager).filter(Manager.id == manager_id).first()
    if not manager:
        raise HTTPException(status_code=404, detail="Manager not found")

    manager_service.demote_manager(db, manager_id)
    return {"success": True, "message": f"Manager {manager_id} demoted"}


@app.post("/api/managers/{manager_id}/assign-users", response_model=ManagerDetailOut)
def assign_manager_users(
    manager_id: int,
    payload: ManagerAssignUsers,
    db: Session = Depends(get_db),
    _admin: dict = Depends(get_current_admin),
):
    """The "Assign Users" modal action — assigns the given users to
    THIS manager (whichever manager's detail panel is open), moving
    each off any manager they previously reported to.
    """
    manager = db.query(Manager).filter(Manager.id == manager_id).first()
    if not manager:
        raise HTTPException(status_code=404, detail="Manager not found")

    if payload.user_ids:
        manager_accounts = db.query(Manager).filter(Manager.user_id.in_(payload.user_ids)).all()
        for other in manager_accounts:
            if other.id != manager_id:
                raise HTTPException(
                    status_code=400,
                    detail="Cannot reassign a manager's own account to a different manager",
                )

    manager_service.assign_users_to_manager(db, manager_id, payload.user_ids)
    return _manager_out(db, manager, include_assigned_users=True)


@app.post("/api/managers/{manager_id}/unassign-user", response_model=ManagerDetailOut)
def unassign_manager_user(
    manager_id: int,
    payload: ManagerUnassignUser,
    db: Session = Depends(get_db),
    _admin: dict = Depends(get_current_admin),
):
    manager = db.query(Manager).filter(Manager.id == manager_id).first()
    if not manager:
        raise HTTPException(status_code=404, detail="Manager not found")

    if payload.user_id == manager.user_id:
        raise HTTPException(
            status_code=400,
            detail="A manager's own account cannot be unassigned from themselves",
        )

    user = db.query(User).filter(User.id == payload.user_id, User.manager_id == manager_id).first()
    if user is None:
        raise HTTPException(status_code=400, detail="That user is not assigned to this manager")

    manager_service.unassign_user(db, payload.user_id)
    return _manager_out(db, manager, include_assigned_users=True)


# ─────────────────────────────────────────
# SETTINGS — permission catalog + fleet-wide alert-type toggles
# ─────────────────────────────────────────

@app.get("/api/settings/permissions", response_model=list[PermissionDefinitionOut])
def list_permission_definitions(include_inactive: bool = False, db: Session = Depends(get_db)):
    """Permission-key catalog for the admin Settings page. Active-only
    by default; pass include_inactive=true to also return soft-deleted
    rows so they can be reactivated.
    """
    ensure_permission_definitions(db)
    query = db.query(PermissionDefinition)
    if not include_inactive:
        query = query.filter(PermissionDefinition.is_active.is_(True))
    return query.order_by(PermissionDefinition.key.asc()).all()


@app.post("/api/settings/permissions", response_model=PermissionDefinitionOut)
def create_permission_definition(payload: PermissionDefinitionCreate, db: Session = Depends(get_db)):
    key = (payload.key or "").strip()
    label = (payload.label or "").strip()
    if not key:
        raise HTTPException(status_code=400, detail="Permission key is required")
    if not label:
        raise HTTPException(status_code=400, detail="Permission label is required")

    existing = db.query(PermissionDefinition).filter(PermissionDefinition.key == key).first()
    if existing is not None:
        raise HTTPException(status_code=409, detail="Permission key already exists")

    applies_to_user = bool(payload.applies_to_user)
    default_for_new_users = bool(payload.default_for_new_users)
    if default_for_new_users and not applies_to_user:
        raise HTTPException(
            status_code=400,
            detail="Cannot default for new users unless applies_to_user is true",
        )

    row = PermissionDefinition(
        key=key,
        label=label,
        description=(payload.description or "").strip() or None,
        default_for_new_managers=payload.default_for_new_managers,
        applies_to_user=applies_to_user,
        default_for_new_users=default_for_new_users,
        is_active=True,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


@app.patch("/api/settings/permissions/{definition_id}", response_model=PermissionDefinitionOut)
def update_permission_definition(
    definition_id: int,
    payload: PermissionDefinitionUpdate,
    db: Session = Depends(get_db),
):
    row = db.query(PermissionDefinition).filter(PermissionDefinition.id == definition_id).first()
    if not row:
        raise HTTPException(status_code=404, detail="Permission definition not found")

    updates = payload.dict(exclude_unset=True)
    if "key" in updates:
        new_key = (updates["key"] or "").strip()
        if not new_key:
            raise HTTPException(status_code=400, detail="Permission key is required")
        clash = (
            db.query(PermissionDefinition)
            .filter(PermissionDefinition.key == new_key, PermissionDefinition.id != definition_id)
            .first()
        )
        if clash is not None:
            raise HTTPException(status_code=409, detail="Permission key already exists")
        updates["key"] = new_key
    if "label" in updates:
        new_label = (updates["label"] or "").strip()
        if not new_label:
            raise HTTPException(status_code=400, detail="Permission label is required")
        updates["label"] = new_label
    if "description" in updates and isinstance(updates["description"], str):
        updates["description"] = updates["description"].strip() or None

    applies_to_user = updates.get("applies_to_user", row.applies_to_user)
    default_for_new_users = updates.get("default_for_new_users", row.default_for_new_users)
    if default_for_new_users and not applies_to_user:
        raise HTTPException(
            status_code=400,
            detail="Cannot default for new users unless applies_to_user is true",
        )
    if "applies_to_user" in updates and not applies_to_user:
        updates["default_for_new_users"] = False

    becoming_inactive = (
        "is_active" in updates
        and not updates["is_active"]
        and row.is_active
    )

    for field, value in updates.items():
        setattr(row, field, value)

    if becoming_inactive:
        revoke_permission_from_managers(db, row.key)

    db.commit()
    db.refresh(row)
    return row


@app.delete("/api/settings/permissions/{definition_id}", response_model=PermissionDefinitionOut)
def delete_permission_definition(definition_id: int, db: Session = Depends(get_db)):
    """Soft-delete: sets is_active=false. Hard-delete would leave
    orphan keys in existing Manager.permissions JSON blobs.
    """
    row = db.query(PermissionDefinition).filter(PermissionDefinition.id == definition_id).first()
    if not row:
        raise HTTPException(status_code=404, detail="Permission definition not found")

    row.is_active = False
    revoke_permission_from_managers(db, row.key)
    db.commit()
    db.refresh(row)
    return row


@app.get("/api/settings/alert-types", response_model=list[AlertTypeSettingOut])
def list_alert_type_settings(db: Session = Depends(get_db)):
    ensure_alert_type_settings(db)
    alert_type_settings_cache.refresh(db)
    return db.query(AlertTypeSetting).order_by(AlertTypeSetting.alert_type.asc()).all()


@app.patch("/api/settings/alert-types/{alert_type}", response_model=AlertTypeSettingOut)
def update_alert_type_setting(
    alert_type: str,
    payload: AlertTypeSettingUpdate,
    db: Session = Depends(get_db),
):
    row = db.query(AlertTypeSetting).filter(AlertTypeSetting.alert_type == alert_type).first()
    if not row:
        raise HTTPException(status_code=404, detail="Alert type setting not found")

    updates = payload.dict(exclude_unset=True)
    if not updates:
        raise HTTPException(status_code=400, detail="No fields to update")

    becoming_unoffered = (
        "offered_to_managers" in updates
        and not updates["offered_to_managers"]
        and row.offered_to_managers
    )

    for field, value in updates.items():
        setattr(row, field, value)

    if becoming_unoffered:
        revoke_alert_type_from_managers(db, row.alert_type)

    db.commit()
    db.refresh(row)
    # Take effect on the next raise without waiting for the next poll
    # cycle's refresh — Settings toggles should apply immediately.
    alert_type_settings_cache.set_enabled(row.alert_type, row.is_enabled)
    return row


# ─────────────────────────────────────────
# DRIVERS
# ─────────────────────────────────────────

def _driver_out(db: Session, driver: Driver) -> DriverOut:
    """Builds a DriverOut, filling in the currently-assigned vehicle (if
    any) from the driver's open DriverAssignment — this isn't a column
    on Driver itself, so it's resolved here on every read.
    """
    out = DriverOut.model_validate(driver)
    # Convert stored relative paths to URLs the frontend can drop
    # straight into an <img src>.
    out.license_pic_path = _pic_url(driver.license_pic_path)
    out.driver_pic_path = _pic_url(driver.driver_pic_path)
    open_assignment = driver_service.get_active_assignment_for_driver(db, driver.id)
    if open_assignment is not None:
        device = db.query(Device).filter(Device.id == open_assignment.device_id).first()
        if device is not None:
            out.current_device_id = device.id
            out.current_device_name = device.name
            out.current_device_plate = device.plate_number
        out.assigned_since = open_assignment.start_time
    return out


def _assignment_out(db: Session, assignment: DriverAssignment, driver: Driver | None = None) -> DriverAssignmentOut:
    device = db.query(Device).filter(Device.id == assignment.device_id).first()
    if driver is None:
        driver = db.query(Driver).filter(Driver.id == assignment.driver_id).first()
    return DriverAssignmentOut(
        id=assignment.id,
        driver_id=assignment.driver_id,
        device_id=assignment.device_id,
        device_name=device.name if device else None,
        device_plate=device.plate_number if device else None,
        driver_name=driver.name if driver else None,
        driver_pic_url=_pic_url(driver.driver_pic_path) if driver else None,
        start_time=assignment.start_time,
        end_time=assignment.end_time,
    )


@app.post("/api/drivers", response_model=DriverOut)
async def create_driver(
    db: Session = Depends(get_db),
    name: str = Form(...),
    id_card_number: str = Form(...),
    phone_number: str | None = Form(None),
    license_number: str | None = Form(None),
    license_expiry: date | None = Form(None),
    status: str = Form("active"),
    date_joined: date | None = Form(None),
    license_pic: UploadFile | None = File(None),
    driver_pic: UploadFile | None = File(None),
):
    validate_cnic(id_card_number)

    existing = db.query(Driver).filter(Driver.id_card_number == id_card_number).first()
    if existing is not None:
        raise HTTPException(status_code=400, detail="A driver with this ID card number already exists")

    license_pic_path = await save_upload(license_pic, "drivers/license") if license_pic and license_pic.filename else None
    driver_pic_path = await save_upload(driver_pic, "drivers/photo") if driver_pic and driver_pic.filename else None

    driver = Driver(
        name=name,
        id_card_number=id_card_number,
        phone_number=phone_number,
        license_number=license_number,
        license_expiry=license_expiry,
        status=status,
        date_joined=date_joined,
        license_pic_path=license_pic_path,
        driver_pic_path=driver_pic_path,
    )
    db.add(driver)
    db.commit()
    db.refresh(driver)
    return _driver_out(db, driver)


@app.get("/api/drivers", response_model=list[DriverOut])
def list_drivers(db: Session = Depends(get_db)):
    drivers = db.query(Driver).order_by(Driver.name.asc()).all()
    return [_driver_out(db, d) for d in drivers]


@app.get("/api/drivers/{driver_id}", response_model=DriverOut)
def get_driver(driver_id: int, db: Session = Depends(get_db)):
    driver = db.query(Driver).filter(Driver.id == driver_id).first()
    if not driver:
        raise HTTPException(status_code=404, detail="Driver not found")
    return _driver_out(db, driver)


@app.get("/api/drivers/{driver_id}/assignments", response_model=list[DriverAssignmentOut])
def list_driver_assignments(driver_id: int, db: Session = Depends(get_db)):
    """Full vehicle assignment history for a driver, newest first."""
    driver = db.query(Driver).filter(Driver.id == driver_id).first()
    if not driver:
        raise HTTPException(status_code=404, detail="Driver not found")
    assignments = driver_service.get_assignments_for_driver(db, driver_id)
    return [_assignment_out(db, a, driver) for a in assignments]


@app.patch("/api/drivers/{driver_id}", response_model=DriverOut)
async def update_driver(
    driver_id: int,
    db: Session = Depends(get_db),
    name: str | None = Form(None),
    id_card_number: str | None = Form(None),
    phone_number: str | None = Form(None),
    license_number: str | None = Form(None),
    license_expiry: date | None = Form(None),
    status: str | None = Form(None),
    date_joined: date | None = Form(None),
    license_pic: UploadFile | None = File(None),
    driver_pic: UploadFile | None = File(None),
):
    driver = db.query(Driver).filter(Driver.id == driver_id).first()
    if not driver:
        raise HTTPException(status_code=404, detail="Driver not found")

    await driver_service.apply_driver_form_update(
        db,
        driver,
        name=name,
        id_card_number=id_card_number,
        phone_number=phone_number,
        license_number=license_number,
        license_expiry=license_expiry,
        status=status,
        date_joined=date_joined,
        license_pic=license_pic,
        driver_pic=driver_pic,
    )
    return _driver_out(db, driver)


@app.delete("/api/drivers/{driver_id}")
def delete_driver(driver_id: int, db: Session = Depends(get_db)):
    driver = db.query(Driver).filter(Driver.id == driver_id).first()
    if not driver:
        raise HTTPException(status_code=404, detail="Driver not found")

    delete_upload(driver.license_pic_path)
    delete_upload(driver.driver_pic_path)

    db.delete(driver)
    db.commit()
    return {"success": True, "message": f"Driver {driver_id} deleted"}


@app.post("/api/drivers/{driver_id}/assign")
def assign_driver_to_vehicle(driver_id: int, device_id: int, db: Session = Depends(get_db)):
    """Assigns a driver to a vehicle right now. Automatically closes:
    - the driver's previous open assignment (if any), and
    - the target vehicle's previous open assignment (if any, to a
      different driver) — so a vehicle never has two active drivers.
    """
    driver = db.query(Driver).filter(Driver.id == driver_id).first()
    if not driver:
        raise HTTPException(status_code=404, detail="Driver not found")
    device = db.query(Device).filter(Device.id == device_id).first()
    if not device:
        raise HTTPException(status_code=404, detail="Device not found")

    assignment = driver_service.assign_driver(db, driver_id, device_id)
    return {
        "success": True,
        "message": f"{driver.name} assigned to {device.name}",
        "assignment": DriverAssignmentOut(
            id=assignment.id,
            driver_id=assignment.driver_id,
            device_id=assignment.device_id,
            device_name=device.name,
            driver_name=driver.name,
            driver_pic_url=_pic_url(driver.driver_pic_path),
            start_time=assignment.start_time,
            end_time=assignment.end_time,
        ),
    }


@app.post("/api/drivers/{driver_id}/unassign")
def unassign_driver_from_vehicle(driver_id: int, db: Session = Depends(get_db)):
    driver = db.query(Driver).filter(Driver.id == driver_id).first()
    if not driver:
        raise HTTPException(status_code=404, detail="Driver not found")

    closed = driver_service.unassign_driver(db, driver_id)
    if closed is None:
        raise HTTPException(status_code=400, detail="Driver is not currently assigned to a vehicle")
    return {"success": True, "message": f"{driver.name} unassigned"}


@app.get("/api/drivers/{driver_id}/detail")
def get_driver_detail(driver_id: int, date: str = None, start: str = None, end: str = None, db: Session = Depends(get_db)):
    """Everything the Driver Detail page needs in one call:
    - driver: profile fields + currently-assigned vehicle
    - assignments: every vehicle this driver was on that overlaps the
      selected range, with from/to
    - trips: every trip made on any of those vehicles during the
      overlapping portion of the range, each with full metrics (same
      shape as vehicle-report's trips) — including a trip still in
      progress

    Accepts the same single `date` / explicit `start`+`end` range modes
    as /api/report and /api/vehicle-report, defaulting to today (UTC).
    """
    driver = db.query(Driver).filter(Driver.id == driver_id).first()
    if not driver:
        raise HTTPException(status_code=404, detail="Driver not found")

    start_dt, end_dt, label, _price_date = _resolve_time_range(date, start, end)

    assignments = driver_service.get_assignments_for_driver_in_range(db, driver_id, start_dt, end_dt)

    device_ids = {a.device_id for a in assignments}
    devices_by_id = {d.id: d for d in db.query(Device).filter(Device.id.in_(device_ids)).all()} if device_ids else {}

    assignments_out = []
    # (trip, device_name, assignment_id) collected first so we can batch
    # geofence lookup and commit once after any metric recalcs.
    pending_trips = []
    metrics_dirty = False
    running_totals = driver_service.empty_driver_detail_totals()

    for a in assignments:
        device = devices_by_id.get(a.device_id)
        device_name = device.name if device else f"Device {a.device_id}"

        assignments_out.append({
            "id": a.id,
            "device_id": a.device_id,
            "device_name": device_name,
            "device_plate": device.plate_number if device else None,
            "start_time": _utc_iso(a.start_time),
            "end_time": _utc_iso(a.end_time) if a.end_time else None,
        })

        # Trips on this vehicle, clipped to the overlap between the
        # assignment's own window and the requested range — so a trip
        # made under a DIFFERENT driver's assignment (before/after this
        # one) never gets attributed here.
        window_start = max(start_dt, a.start_time)
        window_end = min(end_dt, a.end_time) if a.end_time else end_dt
        if window_end <= window_start or device is None:
            continue

        trips = get_trips_in_range(db, a.device_id, window_start, window_end)
        for trip in trips:
            if not driver_service.trip_attributed_to_driver(trip, driver_id, a):
                continue
            if trip.status == "in_progress" or trip.distance_km is None:
                calculate_trip_metrics(db, trip, device)
                metrics_dirty = True
            pending_trips.append((trip, device_name, a.id))

    # Trips confirmed to this driver outside their assignment windows.
    confirmed_extra = (
        db.query(Trip)
        .filter(
            Trip.confirmed_driver_id == driver_id,
            Trip.start_time < end_dt,
            or_(Trip.end_time.is_(None), Trip.end_time >= start_dt),
        )
        .all()
    )
    pending_ids = {t.id for t, _, _ in pending_trips}
    for trip in confirmed_extra:
        if trip.id in pending_ids:
            continue
        device = devices_by_id.get(trip.device_id)
        if device is None:
            device = db.query(Device).filter(Device.id == trip.device_id).first()
            if device is not None:
                devices_by_id[device.id] = device
        device_name = device.name if device else f"Device {trip.device_id}"
        if device is not None and (trip.status == "in_progress" or trip.distance_km is None):
            calculate_trip_metrics(db, trip, device)
            metrics_dirty = True
        pending_trips.append((trip, device_name, None))
        pending_ids.add(trip.id)

    if metrics_dirty:
        db.commit()

    # One row per trip — overlapping assignment windows can otherwise
    # attach the same trip twice.
    unique_pending = []
    seen_trip_ids = set()
    for item in pending_trips:
        trip_id = item[0].id
        if trip_id in seen_trip_ids:
            continue
        seen_trip_ids.add(trip_id)
        unique_pending.append(item)
    pending_trips = unique_pending

    geofence_ids = {trip.geofence_id for trip, _, _ in pending_trips if trip.geofence_id}
    geofence_names_by_id = {}
    if geofence_ids:
        for gf in db.query(Geofence).filter(Geofence.id.in_(geofence_ids)).all():
            geofence_names_by_id[gf.id] = gf.name

    display_number = driver_service.completed_trip_ranks_for_driver(db, driver_id)

    all_trips_out = []
    for trip, device_name, assignment_id in pending_trips:
        row = driver_service.serialize_driver_detail_trip(
            trip,
            device_name=device_name,
            geofence_name=geofence_names_by_id.get(trip.geofence_id),
            assignment_id=assignment_id,
        )
        row["trip_number"] = display_number.get(trip.id)
        all_trips_out.append(row)
        driver_service.accumulate_driver_detail_totals(running_totals, trip)

    all_trips_out.sort(key=lambda t: t["end_time"] or t["start_time"] or "", reverse=True)

    running_totals = driver_service.finalize_driver_detail_totals(running_totals)

    return {
        "driver": _driver_out(db, driver),
        "date": label,
        "range_start": _utc_iso(start_dt),
        "range_end": _utc_iso(end_dt),
        "assignments": assignments_out,
        "trips": all_trips_out,
        "totals": running_totals,
    }


# ─────────────────────────────────────────
# POSITIONS — served from cache, instant
# ─────────────────────────────────────────
@app.get("/api/positions")
async def get_positions():
    """Current positions of all devices, raw from Traccar (every attribute
    Traccar reports — ignition, motion, battery, adc1, alarm, etc. — is
    included untouched inside each position's `attributes` field)."""
    return {
        "success": True,
        "count": len(traccar_cache.positions),
        "cache_status": traccar_cache.status(),
        "positions": traccar_cache.positions,
    }


@app.get("/api/positions/{device_id}")
async def get_device_position(device_id: int):
    """Position of a specific device, from cache."""
    position = next(
        (p for p in traccar_cache.positions if p.get("deviceId") == device_id),
        None,
    )
    if position is None:
        raise HTTPException(
            status_code=404,
            detail=f"No cached position for device_id={device_id}. "
            f"Check /api/devices for valid IDs, or /api/cache/status "
            f"to see if the last poll failed.",
        )
    return {"success": True, "device_id": device_id, "position": position}


# ─────────────────────────────────────────
# LIVE — device + position merged, everything in one place
# ─────────────────────────────────────────
@app.get("/api/live")
async def get_live(compact: bool = False, db_id: int | None = None):
    """Every device merged with its latest position in one object —
    this is the 'show me everything Traccar can offer' endpoint.

    `compact=true` skips per-device driver/owner lookups — used by the
    admin dashboard map so first paint is not blocked on N+1 queries.
    `db_id` limits the payload to one fleet device (vehicle detail polls).
    """
    live = traccar_cache.merged_live_view()

    db = SessionLocal()
    try:
        if db_id is not None:
            devices = db.query(Device).filter(Device.id == db_id).all()
        else:
            devices = db.query(Device).all()
        traccar_to_db = {d.traccar_device_id: d.id for d in devices}
        devices_by_id = {d.id: d for d in devices}
        allowed_traccar = set(traccar_to_db.keys()) if db_id is not None else None

        enriched = []
        for item in live:
            traccar_id = item["device"]["id"]
            if allowed_traccar is not None and traccar_id not in allowed_traccar:
                continue
            db_device_id = traccar_to_db.get(traccar_id)
            row = dict(item)
            row["db_id"] = db_device_id

            db_device = devices_by_id.get(db_device_id) if db_device_id is not None else None
            row["vehicle_type"] = db_device.vehicle_type if db_device else None
            row["plate_number"] = db_device.plate_number if db_device else None
            row["pic_url"] = _pic_url(db_device.pic_path) if db_device else None

            row["active_driver"] = None
            row["driver_alert"] = False
            row["owner"] = None
            if not compact and db_device_id is not None:
                driver, alert = driver_service.get_live_driver_alert(db, db_device_id)
                if driver is not None:
                    row["active_driver"] = {
                        "id": driver.id,
                        "name": driver.name,
                        "pic_url": _pic_url(driver.driver_pic_path),
                    }
                row["driver_alert"] = alert
                if db_device is not None and db_device.user_id is not None:
                    owner = db.query(User).filter(User.id == db_device.user_id).first()
                    if owner is not None:
                        row["owner"] = {
                            "id": owner.id,
                            "username": owner.username,
                            "full_name": owner.full_name,
                            "is_manager": manager_service.get_manager_by_user_id(db, owner.id) is not None,
                            "pic_url": _pic_url(owner.pic_path),
                        }
            enriched.append(row)
            if db_id is not None:
                break
    finally:
        db.close()

    return {
        "success": True,
        "count": len(enriched),
        "cache_status": traccar_cache.status(),
        "live": enriched,
    }


@app.get("/api/live/{device_id}")
async def get_live_device(device_id: int):
    """Single device + its latest position merged together."""
    match = next(
        (m for m in traccar_cache.merged_live_view() if m["device"]["id"] == device_id),
        None,
    )
    if match is None:
        raise HTTPException(status_code=404, detail=f"No device with id={device_id}")
    return {"success": True, "live": match}


# ─────────────────────────────────────────
# ROUTE HISTORY — DB-first, with Traccar fallback for genuine gaps.
# Same DevicePosition source as admin Routes / Trips / Vehicle Report;
# Playback still receives the Traccar-shaped point dict the frontend
# already reads (latitude/longitude/speed_kmh/course/fixTime).
# ─────────────────────────────────────────
@app.get("/api/route/{device_id}")
async def get_route(
    device_id: int,
    from_time: str,
    to_time: str,
    max_points: int | None = None,
    db: Session = Depends(get_db),
):
    device = db.query(Device).filter(Device.id == device_id).first()
    if not device:
        raise HTTPException(status_code=404, detail="Device not found")
    from_dt = _parse_flexible_datetime(from_time)
    to_dt = _parse_flexible_datetime(to_time)
    if max_points is not None and max_points < 2:
        raise HTTPException(status_code=400, detail="max_points must be at least 2")

    def _build_route():
        # Playback is DB-only: gap fill runs in background repair, never
        # while the user waits. Cap DB read ~3x max_points, then thin.
        fetch_cap = (max_points * 3) if max_points is not None else None
        positions = position_writer.ensure_positions_for_range(
            db,
            device,
            from_dt,
            to_dt,
            fill_gaps=False,
            fetch_cap=fetch_cap,
        )
        original_count = len(positions)
        if max_points is not None:
            positions = position_writer.thin_route_positions(positions, max_points)
        route = [
            {
                "latitude": p.lat,
                "longitude": p.lon,
                "speed_kmh": p.speed_kmh,
                "course": p.course,
                "fixTime": position_writer.naive_utc_iso(p.fix_time),
            }
            for p in positions
        ]
        return original_count, route

    try:
        # Thin + serialize in the worker thread so the event loop is not
        # blocked on large month-sized routes (same output as before).
        original_count, route = await asyncio.to_thread(_build_route)
        return {
            "success": True,
            "device_id": device_id,
            "count": len(route),
            "original_count": original_count,
            "route": route,
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ─────────────────────────────────────────
# DAILY REPORT — aggregated metrics from the database
# ─────────────────────────────────────────
@app.get("/api/report/{device_id}")
async def get_report(device_id: int, date: str = None, start: str = None, end: str = None):
    """Report for a device — either a single day (`date`, the original
    behavior) or an explicit `start`/`end` datetime range (new). Defaults
    to today (UTC) if nothing is given.
    """
    start_dt, end_dt, label, price_lookup_date = _resolve_time_range(date, start, end)

    db = SessionLocal()
    try:
        device = db.query(Device).filter(Device.id == device_id).first()
        if not device:
            raise HTTPException(status_code=404, detail="Device not found")

        price_per_liter = None
        price_effective_date = None
        if device.fuel_type_id is not None:
            price_row = get_applicable_fuel_price_row(
                db, device.fuel_type_id, price_lookup_date
            )
            if price_row is not None:
                price_per_liter = price_row.price_per_liter
                price_effective_date = price_row.effective_date_start

        report = get_daily_report(
            db,
            device_id,
            start_dt,
            end_dt,
            label,
            device.fuel_avg_running,
            device.fuel_avg_idle,
            price_per_liter,
            price_effective_date,
            device.speed_limit_kmh,
            device.harsh_brake_delta_kmh,
            device.harsh_accel_delta_kmh,
        )
        if report is None:
            raise HTTPException(
                status_code=404,
                detail=f"No position data found for device_id={device_id} in range {label}",
            )

        assignments = driver_service.get_assignments_in_range(db, device_id, start_dt, end_dt)
        driver_ids = {a.driver_id for a in assignments}
        drivers_by_id = {d.id: d for d in db.query(Driver).filter(Driver.id.in_(driver_ids)).all()} if driver_ids else {}
        report["drivers"] = [
            {
                "driver_id": a.driver_id,
                "driver_name": drivers_by_id[a.driver_id].name if a.driver_id in drivers_by_id else None,
                "driver_pic_url": _pic_url(drivers_by_id[a.driver_id].driver_pic_path) if a.driver_id in drivers_by_id else None,
                "from": _utc_iso(a.start_time),
                "to": _utc_iso(a.end_time) if a.end_time else None,
            }
            for a in assignments
        ]

        # Right-now state (independent of the selected range), same as
        # vehicle-report — powers the "no driver assigned" banner.
        live_driver, live_driver_alert = driver_service.get_live_driver_alert(db, device_id)
        report["current_driver"] = {
            "id": live_driver.id,
            "name": live_driver.name,
            "pic_url": _pic_url(live_driver.driver_pic_path),
        } if live_driver else None
        report["live_driver_alert"] = live_driver_alert

        return report
    finally:
        db.close()


# ─────────────────────────────────────────
# VEHICLE REPORT — one combined call: vehicle details + daily report +
# trips (with geofence names attached), for the Vehicle Report page.
# ─────────────────────────────────────────
@app.get("/api/vehicle-report/{device_id}")
async def get_vehicle_report(
    device_id: int,
    date: str = None,
    start: str = None,
    end: str = None,
    summary: bool = False,
):
    """Everything the Vehicle Report page needs in one call:
    - device: fleet metadata (plate, vehicle type, fuel type name, etc.)
    - report: the same metrics as /api/report/{device_id}, plus
      idle_count / stop_count / avg_speed_kmh
    - trips: trips overlapping the selected range (geofence exit ->
      re-entry), each with its own driving-behavior metrics and the
      geofence's name attached — including a trip still in progress,
      even if it started before the selected range began

    Accepts either a single day (`date`, the original behavior) or an
    explicit `start`/`end` datetime range (new). Defaults to today
    (UTC) if nothing is given.

    `summary=true` skips trips/drivers/position payloads — used by the
    user dashboard for a fast first paint with the same metric fields.
    """
    start_dt, end_dt, label, price_lookup_date = _resolve_time_range(date, start, end)

    db = SessionLocal()
    try:
        device = db.query(Device).filter(Device.id == device_id).first()
        if not device:
            raise HTTPException(status_code=404, detail="Device not found")

        fuel_type_name = None
        if device.fuel_type_id is not None:
            fuel_type = db.query(FuelType).filter(FuelType.id == device.fuel_type_id).first()
            fuel_type_name = fuel_type.name if fuel_type else None

        primary_geofence_name = None
        if device.primary_geofence_id is not None:
            primary_geofence = (
                db.query(Geofence).filter(Geofence.id == device.primary_geofence_id).first()
            )
            primary_geofence_name = primary_geofence.name if primary_geofence else None

        price_per_liter = None
        price_effective_date = None
        if device.fuel_type_id is not None:
            price_row = get_applicable_fuel_price_row(db, device.fuel_type_id, price_lookup_date)
            if price_row is not None:
                price_per_liter = price_row.price_per_liter
                price_effective_date = price_row.effective_date_start

        # Owner identity — not columns on Device, resolved here same as
        # _device_out. AdminVehicleDetail.jsx's owner section needs this
        # from this endpoint directly rather than a second round trip to
        # /api/fleet/devices/{id}.
        owner_username = None
        owner_full_name = None
        owner_phone_number = None
        if device.user_id is not None:
            owner = db.query(User).filter(User.id == device.user_id).first()
            if owner is not None:
                owner_username = owner.username
                owner_full_name = owner.full_name
                owner_phone_number = owner.phone_number

        report = get_daily_report(
            db,
            device_id,
            start_dt,
            end_dt,
            label,
            device.fuel_avg_running,
            device.fuel_avg_idle,
            price_per_liter,
            price_effective_date,
            device.speed_limit_kmh,
            device.harsh_brake_delta_kmh,
            device.harsh_accel_delta_kmh,
            include_detailed_positions=not summary,
        )

        device_payload = {
            "id": device.id,
            "traccar_device_id": device.traccar_device_id,
            "name": device.name,
            "device_type": device.device_type,
            "vehicle_type": device.vehicle_type,
            "plate_number": device.plate_number,
            "user_id": device.user_id,
            "owner_username": owner_username,
            "owner_full_name": owner_full_name,
            "owner_phone_number": owner_phone_number,
            "fuel_type_id": device.fuel_type_id,
            "fuel_type_name": fuel_type_name,
            "fuel_avg_running": device.fuel_avg_running,
            "fuel_avg_idle": device.fuel_avg_idle,
            "fuel_avg_idle_auto": device.fuel_avg_idle_auto,
            "primary_geofence_id": device.primary_geofence_id,
            "primary_geofence_name": primary_geofence_name,
            "speed_limit_kmh": device.speed_limit_kmh,
            "harsh_brake_delta_kmh": device.harsh_brake_delta_kmh,
            "harsh_accel_delta_kmh": device.harsh_accel_delta_kmh,
            "last_seen_at": _utc_iso(device.last_seen_at) if device.last_seen_at else None,
            "pic_url": _pic_url(device.pic_path),
        }

        if summary:
            return {
                "device": device_payload,
                "date": label,
                "range_start": _utc_iso(start_dt),
                "range_end": _utc_iso(end_dt),
                "report": report,
                "trips": [],
                "drivers": [],
                "current_driver": None,
                "live_driver_alert": False,
            }

        # Trips overlapping this range — recalculate metrics on every
        # fetch, same approach as list_trips, so they always reflect the
        # latest DevicePosition data (including in-progress trips). Uses
        # get_trips_in_range (time-based) rather than a trip_date match,
        # so a trip that's still open keeps showing up in "today's"
        # report even if it started on an earlier day.
        trips = get_trips_in_range(db, device_id, start_dt, end_dt)
        for trip in trips:
            calculate_trip_metrics(db, trip, device)
        db.commit()

        geofence_ids = {t.geofence_id for t in trips}
        geofence_names_by_id = {}
        if geofence_ids:
            for gf in db.query(Geofence).filter(Geofence.id.in_(geofence_ids)).all():
                geofence_names_by_id[gf.id] = gf.name

        # trips is already ordered by start_time ascending (see
        # get_trips_in_range). Renumber 1, 2, 3... across the WHOLE
        # requested range here for display only — same reasoning as in
        # list_trips: the DB's trip_number stays scoped per calendar
        # day, this is just what's shown to the user.
        trips_out = []
        for index, t in enumerate(trips, start=1):
            driver, driver_alert = driver_service.get_driver_for_trip(db, device_id, t.start_time, t.status)
            trips_out.append({
                "id": t.id,
                "trip_number": index,
                "status": t.status,
                "geofence_id": t.geofence_id,
                "geofence_name": geofence_names_by_id.get(t.geofence_id),
                "start_time": _utc_iso(t.start_time) if t.start_time else None,
                "end_time": _utc_iso(t.end_time) if t.end_time else None,
                "start_lat": t.start_lat,
                "start_lon": t.start_lon,
                "end_lat": t.end_lat,
                "end_lon": t.end_lon,
                "distance_km": t.distance_km,
                "duration_min": t.duration_min,
                "driving_fuel_liters": t.driving_fuel_liters,
                "idle_fuel_liters": t.idle_fuel_liters,
                "total_fuel_liters": t.total_fuel_liters,
                "price_per_liter_used": t.price_per_liter_used,
                "fuel_cost_pkr": t.fuel_cost_pkr,
                "max_speed_kmh": t.max_speed_kmh,
                "harsh_brake_count": t.harsh_brake_count,
                "harsh_accel_count": t.harsh_accel_count,
                "overspeed_count": t.overspeed_count,
                "idle_count": t.idle_count,
                "driver_id": driver.id if driver else None,
                "driver_name": driver.name if driver else None,
                "driver_pic_url": _pic_url(driver.driver_pic_path) if driver else None,
                "driver_alert": driver_alert,
            })

        # Drivers assigned to this vehicle at ANY point during the
        # selected range (may be more than one if the vehicle changed
        # hands mid-range) — each with its own from/to window.
        assignments = driver_service.get_assignments_in_range(db, device_id, start_dt, end_dt)
        driver_ids = {a.driver_id for a in assignments}
        drivers_by_id = {d.id: d for d in db.query(Driver).filter(Driver.id.in_(driver_ids)).all()} if driver_ids else {}
        drivers_in_range = [
            {
                "driver_id": a.driver_id,
                "driver_name": drivers_by_id[a.driver_id].name if a.driver_id in drivers_by_id else None,
                "driver_pic_url": _pic_url(drivers_by_id[a.driver_id].driver_pic_path) if a.driver_id in drivers_by_id else None,
                "from": _utc_iso(a.start_time),
                "to": _utc_iso(a.end_time) if a.end_time else None,
            }
            for a in assignments
        ]

        # Right-now state (independent of the selected range) — powers
        # the prominent "trip in progress, no driver assigned" banner.
        live_driver, live_driver_alert = driver_service.get_live_driver_alert(db, device_id)

        return {
            "device": device_payload,
            "date": label,
            "range_start": _utc_iso(start_dt),
            "range_end": _utc_iso(end_dt),
            "report": report,
            "trips": trips_out,
            "drivers": drivers_in_range,
            "current_driver": {
                "id": live_driver.id,
                "name": live_driver.name,
                "phone_number": live_driver.phone_number,
                "pic_url": _pic_url(live_driver.driver_pic_path),
            } if live_driver else None,
            "live_driver_alert": live_driver_alert,
        }
    finally:
        db.close()


@app.get("/api/vehicle-report/{device_id}/trend")
def get_vehicle_trend(device_id: int, days: int = 7, db: Session = Depends(get_db)):
    """Compact daily distance series for the last `days` days
    (oldest first, including today) — feeds the small trend sparkline on
    vehicle detail pages.

    Uses first/last odometer per day (fast LIMIT-1 lookups) instead of
    running full get_daily_report for every day.
    """
    device = db.query(Device).filter(Device.id == device_id).first()
    if not device:
        raise HTTPException(status_code=404, detail="Device not found")

    return {"points": get_distance_trend_points(db, device_id, days)}


# ─────────────────────────────────────────
# ALERTS — driving-event feed for the Alert page (harsh brake/accel,
# overspeed, geofence exit, silence/offline, driver-unassigned).
# Events are written by services/alert_monitor.py and
# services/security_monitor.py on every poll cycle; these endpoints
# just read the device_alerts table back out.
# ─────────────────────────────────────────
def _alert_out(alert: DeviceAlert, device: Device | None) -> AlertOut:
    return AlertOut.model_validate({
        "id": alert.id,
        "device_id": alert.device_id,
        "device_name": device.name if device else None,
        "device_plate": device.plate_number if device else None,
        "alert_type": alert.alert_type,
        "severity": alert.severity,
        "message": alert.message,
        "is_resolved": alert.is_resolved,
        "triggered_at": alert.triggered_at,
        "resolved_at": alert.resolved_at,
    })


@app.get("/api/alerts", response_model=list[AlertOut])
def list_alerts(
    severity: str = None,
    device_id: int = None,
    resolved: bool = None,
    date: str = None,
    start: str = None,
    end: str = None,
    limit: int = 200,
    db: Session = Depends(get_db),
):
    """Alert feed, newest first. Filter by severity ('critical' |
    'warning' | 'info'), device_id, resolved state, and/or a single
    `date` or explicit `start`/`end` range (same convention as
    /api/report and /api/trips). No date params -> no date filtering,
    matching the original behavior."""
    query = db.query(DeviceAlert)
    if severity is not None:
        query = query.filter(DeviceAlert.severity == severity)
    if device_id is not None:
        query = query.filter(DeviceAlert.device_id == device_id)
    if resolved is not None:
        query = query.filter(DeviceAlert.is_resolved == resolved)
    if date is not None or start is not None or end is not None:
        start_dt, end_dt, _label, _price_date = _resolve_time_range(date, start, end)
        query = query.filter(DeviceAlert.triggered_at >= start_dt, DeviceAlert.triggered_at < end_dt)

    alerts = query.order_by(DeviceAlert.triggered_at.desc()).limit(limit).all()

    device_ids = {a.device_id for a in alerts}
    devices_by_id = {
        d.id: d for d in db.query(Device).filter(Device.id.in_(device_ids)).all()
    } if device_ids else {}

    return [_alert_out(a, devices_by_id.get(a.device_id)) for a in alerts]


@app.get("/api/alerts/summary", response_model=AlertSummaryOut)
def get_alerts_summary(
    device_id: int = None,
    period: str = "day",
    db: Session = Depends(get_db),
):
    """Counts of alerts in the selected dashboard period (PKT window), by severity
    — feeds the Alerts KPI on the Dashboard. Pass device_id to
    scope the counts to a single vehicle instead of the whole fleet."""
    if period not in TREND_PERIOD_DAYS:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid period {period!r}. Expected one of: {', '.join(TREND_PERIOD_DAYS)}",
        )

    start_utc, end_utc = period_window_utc(period)
    query = db.query(DeviceAlert)
    if start_utc is not None:
        query = query.filter(DeviceAlert.triggered_at >= start_utc)
    if end_utc is not None:
        query = query.filter(DeviceAlert.triggered_at < end_utc)
    if device_id is not None:
        query = query.filter(DeviceAlert.device_id == device_id)

    period_alerts = query.all()

    counts = {"critical": 0, "warning": 0, "info": 0}
    for a in period_alerts:
        if a.severity in counts:
            counts[a.severity] += 1

    return AlertSummaryOut(
        date=date.today().isoformat(),
        critical=counts["critical"],
        warning=counts["warning"],
        info=counts["info"],
        total=len(period_alerts),
    )


@app.patch("/api/alerts/{alert_id}/resolve", response_model=AlertOut)
def resolve_alert(alert_id: int, db: Session = Depends(get_db)):
    """Manually mark an alert resolved (e.g. an operator acknowledging
    it from the Alert page), independent of the auto-resolve logic in
    alert_monitor.py for conditions that clear on their own."""
    alert = db.query(DeviceAlert).filter(DeviceAlert.id == alert_id).first()
    if not alert:
        raise HTTPException(status_code=404, detail="Alert not found")

    alert.is_resolved = True
    alert.resolved_at = datetime.utcnow()
    db.commit()
    db.refresh(alert)

    device = db.query(Device).filter(Device.id == alert.device_id).first()
    return _alert_out(alert, device)


# ─────────────────────────────────────────
# ADMIN DASHBOARD
# ─────────────────────────────────────────

@app.get("/api/admin/dashboard/summary", response_model=AdminDashboardSummaryOut)
def get_admin_dashboard_summary(period: str = "day", db: Session = Depends(get_db)):
    """Fleet-wide aggregates the Admin Dashboard needs that no existing
    endpoint provides. Vehicle moving/idle/parked/offline counts stay
    client-side from /api/live; trip stats respect `period`; driver/
    maintenance snapshots stay current."""
    if period not in TREND_PERIOD_DAYS:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid period {period!r}. Expected one of: {', '.join(TREND_PERIOD_DAYS)}",
        )

    today = date.today()
    today_stats = aggregate_trips_for_period(db, period=period)
    drivers_on_trip, drivers_available = count_assigned_driver_buckets(db)

    vehicles_due_maintenance, vehicles_overdue_maintenance = (
        maintenance_service.count_due_vehicles(db)
    )

    year_start = date(today.year, 1, 1)
    maintenance_records_ytd = (
        db.query(func.count(MaintenanceRecord.id))
        .filter(
            MaintenanceRecord.record_date >= year_start,
            MaintenanceRecord.is_baseline.is_(False),
        )
        .scalar()
        or 0
    )

    drivers_total = db.query(func.count(Driver.id)).scalar() or 0
    drivers_active = (
        db.query(func.count(Driver.id)).filter(Driver.status == "active").scalar() or 0
    )
    drivers_on_leave = (
        db.query(func.count(Driver.id)).filter(Driver.status == "on_leave").scalar() or 0
    )

    return AdminDashboardSummaryOut(
        trips_today=today_stats.trips_today,
        vehicles_due_maintenance=vehicles_due_maintenance,
        vehicles_overdue_maintenance=vehicles_overdue_maintenance,
        maintenance_records_ytd=maintenance_records_ytd,
        trips_completed_today=today_stats.trips_completed_today,
        trips_ongoing_today=today_stats.trips_ongoing_today,
        trips_total_distance_km=today_stats.trips_total_distance_km,
        trips_total_fuel_cost_pkr=today_stats.trips_total_fuel_cost_pkr,
        trips_total_toll_cost_pkr=today_stats.trips_total_toll_cost_pkr,
        trips_total_challan_cost_pkr=today_stats.trips_total_challan_cost_pkr,
        trips_total_cost_pkr=today_stats.trips_total_cost_pkr,
        drivers_total=drivers_total,
        drivers_active=drivers_active,
        drivers_on_trip=drivers_on_trip,
        drivers_on_leave=drivers_on_leave,
        drivers_available=drivers_available,
        user_count=db.query(func.count(User.id)).scalar() or 0,
        managers_count=db.query(func.count(Manager.id)).scalar() or 0,
        users_with_vehicles=(
            db.query(func.count(func.distinct(Device.user_id)))
            .filter(Device.user_id.isnot(None))
            .scalar()
            or 0
        ),
        users_unassigned=(
            db.query(func.count(User.id))
            .filter(User.manager_id.is_(None))
            .scalar()
            or 0
        ),
    )


@app.get("/api/admin/dashboard/trends", response_model=DashboardTrendsOut)
def get_admin_dashboard_trends(period: str = "month", db: Session = Depends(get_db)):
    """Pre-bucketed fleet distance/fuel series for the dashboard chart.

    Do not use GET /api/trips for this — that path recalculates GPS
    metrics per trip and is far too slow for a 30-day chart.
    """
    if period not in TREND_PERIOD_DAYS:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid period {period!r}. Expected one of: {', '.join(TREND_PERIOD_DAYS)}",
        )
    return DashboardTrendsOut(
        period=period,
        points=get_dashboard_trend_points(db, period),
    )


@app.get("/api/admin/dashboard/maintenance-trends", response_model=DashboardMaintenanceTrendsOut)
def get_admin_dashboard_maintenance_trends(
    period: str = "month",
    db: Session = Depends(get_db),
):
    """Daily maintenance visits and cost for the dashboard bar chart."""
    if period not in TREND_PERIOD_DAYS:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid period {period!r}. Expected one of: {', '.join(TREND_PERIOD_DAYS)}",
        )
    return DashboardMaintenanceTrendsOut(
        period=period,
        points=get_dashboard_maintenance_points(db, period),
    )


# ─────────────────────────────────────────
# MAINTENANCE
# ─────────────────────────────────────────

def _get_device_or_404(db: Session, device_id: int) -> Device:
    device = db.query(Device).filter(Device.id == device_id).first()
    if not device:
        raise HTTPException(status_code=404, detail="Device not found")
    return device


@app.get("/api/maintenance/items", response_model=list[MaintenanceItemOut])
def list_maintenance_items(db: Session = Depends(get_db)):
    """Static catalog list, active items only, ordered by sort_order.
    Used for reference/admin — the per-vehicle applicability/status a
    device's Maintenance page actually renders comes from the
    /status endpoint below, not this one."""
    return (
        db.query(MaintenanceItem)
        .filter(MaintenanceItem.is_active.is_(True))
        .order_by(MaintenanceItem.sort_order.asc())
        .all()
    )


@app.get("/api/maintenance/devices/{device_id}/status", response_model=MaintenanceStatusOut)
def get_maintenance_status(device_id: int, db: Session = Depends(get_db)):
    """Main data source for the Maintenance page. has_baseline=False ->
    frontend shows the baseline setup form instead of the normal page;
    `items` is still populated in that case (each with status
    "no_baseline") so the baseline form can render the same item list
    as a normal maintenance entry."""
    device = _get_device_or_404(db, device_id)
    status = maintenance_service.get_status_for_device(db, device)
    return MaintenanceStatusOut(
        device_id=status["device_id"],
        has_baseline=status["has_baseline"],
        today=date.today(),
        odometer_km=status["odometer_km"],
        engine_hours=status["engine_hours"],
        items=status["items"],
    )


@app.patch("/api/maintenance/devices/{device_id}/engine-hours", response_model=DeviceOut)
def update_engine_hours(device_id: int, payload: MaintenanceEngineHoursUpdate, db: Session = Depends(get_db)):
    """Manual correction/set of Device.engine_hours — for devices that
    never report it via Traccar (mobile), or to fix a bad auto-filled
    value. See services/position_writer.py for the auto-fill path."""
    device = _get_device_or_404(db, device_id)
    device.engine_hours = payload.engine_hours
    db.commit()
    db.refresh(device)
    return device


def _record_line_out(db: Session, line: MaintenanceRecordLine, items_by_id: dict) -> dict:
    if line.item_id is not None:
        item = items_by_id.get(line.item_id)
        label = item.label if item else f"Item {line.item_id}"
    else:
        label = line.custom_label or "Other repair"
    return {
        "item_id": line.item_id,
        "label": label,
        "price": line.price,
        "checked": line.checked,
    }


def _record_out(db: Session, record: MaintenanceRecord) -> dict:
    lines = (
        db.query(MaintenanceRecordLine)
        .filter(MaintenanceRecordLine.record_id == record.id)
        .all()
    )
    item_ids = {l.item_id for l in lines if l.item_id is not None}
    items_by_id = {
        i.id: i for i in db.query(MaintenanceItem).filter(MaintenanceItem.id.in_(item_ids)).all()
    } if item_ids else {}

    return {
        "id": record.id,
        "device_id": record.device_id,
        "record_date": record.record_date,
        "odometer_km": record.odometer_km,
        "engine_hours": record.engine_hours,
        "is_baseline": record.is_baseline,
        "total_cost": record.total_cost,
        "notes": record.notes,
        "lines": [_record_line_out(db, l, items_by_id) for l in lines],
    }


def _records_out(db: Session, records: list[MaintenanceRecord]) -> list[dict]:
    """Batch variant of _record_out — one lines query + one items query."""
    if not records:
        return []

    record_ids = [r.id for r in records]
    all_lines = (
        db.query(MaintenanceRecordLine)
        .filter(MaintenanceRecordLine.record_id.in_(record_ids))
        .all()
    )
    lines_by_record: dict[int, list] = {rid: [] for rid in record_ids}
    item_ids = set()
    for line in all_lines:
        lines_by_record.setdefault(line.record_id, []).append(line)
        if line.item_id is not None:
            item_ids.add(line.item_id)

    items_by_id = {
        i.id: i for i in db.query(MaintenanceItem).filter(MaintenanceItem.id.in_(item_ids)).all()
    } if item_ids else {}

    out = []
    for record in records:
        lines = lines_by_record.get(record.id, [])
        out.append({
            "id": record.id,
            "device_id": record.device_id,
            "record_date": record.record_date,
            "odometer_km": record.odometer_km,
            "engine_hours": record.engine_hours,
            "is_baseline": record.is_baseline,
            "total_cost": record.total_cost,
            "notes": record.notes,
            "lines": [_record_line_out(db, l, items_by_id) for l in lines],
        })
    return out


@app.post("/api/maintenance/devices/{device_id}/records", response_model=MaintenanceRecordOut)
def submit_maintenance_record(device_id: int, payload: MaintenanceRecordCreate, db: Session = Depends(get_db)):
    """Submits a maintenance visit — the very first one for a device is
    the mandatory baseline. Skipping items is always allowed EXCEPT on
    baseline, where the backend auto-creates a line for every
    applicable item the client didn't include, using the record's own
    odometer/engine_hours as that line's starting point (unchecked,
    price=0) — this is what guarantees every applicable item has a
    due-status starting point once baseline is done."""
    device = _get_device_or_404(db, device_id)

    is_baseline = (
        db.query(MaintenanceRecord).filter(MaintenanceRecord.device_id == device_id).first()
        is None
    )

    record = MaintenanceRecord(
        device_id=device_id,
        record_date=payload.record_date or date.today(),
        odometer_km=payload.odometer_km,
        engine_hours=payload.engine_hours,
        is_baseline=is_baseline,
        total_cost=(
            payload.total_cost if payload.total_cost is not None
            else sum(l.price for l in payload.lines if l.checked)
        ),
        notes=payload.notes,
    )
    db.add(record)
    db.flush()  # get record.id without a full commit yet

    covered_item_ids = set()
    for line in payload.lines:
        if not line.checked:
            continue
        db.add(MaintenanceRecordLine(
            record_id=record.id,
            item_id=line.item_id,
            custom_label=line.custom_label,
            price=line.price,
            checked=True,
            service_odometer_km=(
                line.service_odometer_km if line.service_odometer_km is not None
                else payload.odometer_km
            ),
            service_engine_hours=(
                line.service_engine_hours if line.service_engine_hours is not None
                else payload.engine_hours
            ),
        ))
        if line.item_id is not None:
            covered_item_ids.add(line.item_id)

    if is_baseline:
        # Guarantee every applicable item has a starting point, even
        # ones the client didn't check — unchecked, price=0, "serviced"
        # at the record's own odometer/engine_hours (an implicit "last
        # known point observed at baseline", not a real service).
        for item in maintenance_service.get_applicable_items(db, device.vehicle_type):
            if item.id in covered_item_ids:
                continue
            db.add(MaintenanceRecordLine(
                record_id=record.id,
                item_id=item.id,
                custom_label=None,
                price=0,
                checked=False,
                service_odometer_km=payload.odometer_km,
                service_engine_hours=payload.engine_hours,
            ))

    # Keep the manual engine_hours value in sync with the latest
    # submitted reading, same as the PATCH endpoint above.
    if payload.engine_hours is not None:
        device.engine_hours = payload.engine_hours

    db.commit()
    db.refresh(record)

    # Re-run the monitor for just this device now, rather than waiting
    # for the next poll cycle — the alert should clear/update
    # immediately after a real submission.
    maintenance_monitor.check_maintenance_for_device(db, device)
    db.commit()

    return _record_out(db, record)


@app.get("/api/maintenance/devices/{device_id}/records")
def list_maintenance_records(
    device_id: int,
    start: str = None,
    end: str = None,
    db: Session = Depends(get_db),
):
    """History for the Report page. `start`/`end` are optional ISO dates
    — omit both for all-time. Newest first."""
    device = _get_device_or_404(db, device_id)

    query = db.query(MaintenanceRecord).filter(MaintenanceRecord.device_id == device_id)
    if start is not None or end is not None:
        start_dt, end_dt, _label, _price_date = _resolve_time_range(None, start, end)
        query = query.filter(
            MaintenanceRecord.record_date >= start_dt.date(),
            MaintenanceRecord.record_date < end_dt.date(),
        )

    records = query.order_by(MaintenanceRecord.record_date.desc(), MaintenanceRecord.id.desc()).all()

    return {
        "success": True,
        "device_id": device_id,
        "count": len(records),
        "records": _records_out(db, records),
    }


@app.get("/api/maintenance/devices/{device_id}/due-report", response_model=MaintenanceDueReportOut)
def get_maintenance_due_report(
    device_id: int,
    start: str = None,
    end: str = None,
    db: Session = Depends(get_db),
):
    """Maintenance Due Report data — one row per stored daily snapshot
    (see maintenance_service.ensure_daily_snapshot, run every poll
    cycle), columns are the device's applicable maintenance items.
    `start`/`end` are optional ISO dates, same convention as the
    /records endpoint above (end exclusive) — omit both for all-time."""
    device = _get_device_or_404(db, device_id)

    start_date = None
    end_date = None
    if start is not None or end is not None:
        start_dt, end_dt, _label, _price_date = _resolve_time_range(None, start, end)
        start_date = start_dt.date()
        end_date = end_dt.date()

    report = maintenance_service.get_due_report(db, device, start=start_date, end=end_date)
    return {"success": True, **report}


@app.put("/api/maintenance/devices/{device_id}/settings/{item_id}", response_model=VehicleMaintenanceSettingOut)
def upsert_vehicle_maintenance_setting(
    device_id: int,
    item_id: int,
    payload: VehicleMaintenanceSettingUpdate,
    db: Session = Depends(get_db),
):
    """Upserts a per-vehicle manual interval override — takes priority
    over the type default for this device+item."""
    _get_device_or_404(db, device_id)
    item = db.query(MaintenanceItem).filter(MaintenanceItem.id == item_id).first()
    if not item:
        raise HTTPException(status_code=404, detail="Maintenance item not found")

    setting = (
        db.query(VehicleMaintenanceSetting)
        .filter_by(device_id=device_id, item_id=item_id)
        .first()
    )
    if setting is None:
        setting = VehicleMaintenanceSetting(device_id=device_id, item_id=item_id)
        db.add(setting)

    setting.dimension = payload.dimension
    setting.interval_value = payload.interval_value
    db.commit()
    db.refresh(setting)
    return setting


@app.delete("/api/maintenance/devices/{device_id}/settings/{item_id}")
def delete_vehicle_maintenance_setting(device_id: int, item_id: int, db: Session = Depends(get_db)):
    """Removes the override, reverting the item back to its type-default
    interval for this vehicle."""
    setting = (
        db.query(VehicleMaintenanceSetting)
        .filter_by(device_id=device_id, item_id=item_id)
        .first()
    )
    if not setting:
        raise HTTPException(status_code=404, detail="No override set for this item")
    db.delete(setting)
    db.commit()
    return {"success": True, "message": "Override removed"}