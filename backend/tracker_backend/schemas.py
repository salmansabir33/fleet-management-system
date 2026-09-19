import re
from datetime import date, datetime, timezone
from typing import Optional

from pydantic import BaseModel, field_serializer, field_validator

from tracker_backend.services.password_policy import validate_new_user_password

# 12345-1234567-1 — 13 digits with dashes, matching the format used on
# Pakistani CNICs (the "id card number" field on Driver).
CNIC_PATTERN = re.compile(r"^\d{5}-\d{7}-\d{1}$")


def validate_cnic(value: str) -> str:
    if not CNIC_PATTERN.match(value):
        from fastapi import HTTPException
        raise HTTPException(
            status_code=400,
            detail=f"Invalid ID card number {value!r} — expected format 12345-1234567-1",
        )
    return value


class DeviceCreate(BaseModel):
    name: str
    imei: str                              # becomes Traccar's uniqueId
    vehicle_type: Optional[str] = None     # "truck" | "car" | "bike" | etc.
    plate_number: Optional[str] = None
    fuel_type_id: Optional[int] = None
    fuel_avg_running: Optional[float] = None
    fuel_avg_idle: Optional[float] = None
    primary_geofence_id: Optional[int] = None
    speed_limit_kmh: Optional[float] = None
    harsh_brake_delta_kmh: Optional[float] = None
    harsh_accel_delta_kmh: Optional[float] = None
    user_id: Optional[int] = None          # NEW — links this vehicle to its owner (User)


class DeviceUpdate(BaseModel):
    name: Optional[str] = None
    vehicle_type: Optional[str] = None
    plate_number: Optional[str] = None
    fuel_type_id: Optional[int] = None
    fuel_avg_running: Optional[float] = None
    fuel_avg_idle: Optional[float] = None
    primary_geofence_id: Optional[int] = None
    speed_limit_kmh: Optional[float] = None
    harsh_brake_delta_kmh: Optional[float] = None
    harsh_accel_delta_kmh: Optional[float] = None
    user_id: Optional[int] = None          # NEW


class DeviceOut(BaseModel):
    id: int
    traccar_device_id: int
    name: str
    device_type: Optional[str] = None
    vehicle_type: Optional[str] = None
    plate_number: Optional[str] = None
    fuel_type_id: Optional[int] = None
    fuel_avg_running: Optional[float] = None
    fuel_avg_idle: Optional[float] = None
    fuel_avg_idle_auto: Optional[bool] = None
    primary_geofence_id: Optional[int] = None
    engine_hours: Optional[float] = None
    speed_limit_kmh: Optional[float] = None
    harsh_brake_delta_kmh: Optional[float] = None
    harsh_accel_delta_kmh: Optional[float] = None
    user_id: Optional[int] = None          # NEW

    # NEW — populated by the endpoint (not a column on Device) when the
    # owning User is loaded, so the frontend doesn't need a second call
    # just to show the owner's name on a vehicle page.
    owner_username: Optional[str] = None
    owner_full_name: Optional[str] = None
    owner_phone_number: Optional[str] = None
    pic_url: Optional[str] = None

    class Config:
        from_attributes = True


class FuelTypeOut(BaseModel):
    id: int
    name: str

    class Config:
        from_attributes = True


class FuelTypeCreate(BaseModel):
    name: str


class FuelPriceCreate(BaseModel):
    fuel_type_id: int
    price_per_liter: float
    effective_date_start: date


class FuelPriceUpdate(BaseModel):
    price_per_liter: Optional[float] = None


class FuelPriceOut(BaseModel):
    id: int
    fuel_type_id: int
    price_per_liter: float
    effective_date_start: date
    effective_date_end: Optional[date] = None

    class Config:
        from_attributes = True


class GeofenceCreate(BaseModel):
    name: str
    center_lat: float
    center_lon: float
    radius_meters: float


class GeofenceUpdate(BaseModel):
    name: Optional[str] = None
    center_lat: Optional[float] = None
    center_lon: Optional[float] = None
    radius_meters: Optional[float] = None


class GeofenceOut(BaseModel):
    id: int
    name: str
    center_lat: float
    center_lon: float
    radius_meters: float

    class Config:
        from_attributes = True


class RoutePoint(BaseModel):
    lat: float
    lon: float


class ActualPathPoint(RoutePoint):
    fix_time: Optional[datetime] = None


class RouteCreate(BaseModel):
    name: str
    direction_label: Optional[str] = None
    waypoints: list[RoutePoint]
    tolerance_meters: Optional[float] = 400


class RoutePreviewOut(BaseModel):
    waypoints: list[RoutePoint]
    path: list[RoutePoint]


class RouteUpdate(BaseModel):
    name: Optional[str] = None
    direction_label: Optional[str] = None
    waypoints: Optional[list[RoutePoint]] = None
    tolerance_meters: Optional[float] = None


class RouteVehicleAssign(BaseModel):
    device_id: int


class RouteAssignedVehicleOut(BaseModel):
    id: int
    name: str


class RouteAssignedVehicleWithDriverOut(BaseModel):
    id: int
    name: str
    driver_name: Optional[str] = None


class RouteListOut(BaseModel):
    id: int
    name: str
    direction_label: Optional[str] = None
    vehicle_count: int = 0
    assigned_vehicles: list[RouteAssignedVehicleWithDriverOut] = []
    created_at: Optional[datetime] = None

    @field_serializer("created_at")
    def _serialize_created_at(self, dt: Optional[datetime]) -> Optional[str]:
        if dt is None:
            return None
        if dt.tzinfo is not None:
            dt = dt.astimezone(timezone.utc)
        return dt.strftime("%Y-%m-%dT%H:%M:%SZ")


class RouteOut(BaseModel):
    id: int
    name: str
    direction_label: Optional[str] = None
    waypoints: list[RoutePoint]
    path: list[RoutePoint]
    tolerance_meters: float
    assigned_vehicles: list[RouteAssignedVehicleOut] = []
    created_at: Optional[datetime] = None

    @field_serializer("created_at")
    def _serialize_route_created_at(self, dt: Optional[datetime]) -> Optional[str]:
        if dt is None:
            return None
        if dt.tzinfo is not None:
            dt = dt.astimezone(timezone.utc)
        return dt.strftime("%Y-%m-%dT%H:%M:%SZ")


class TripOut(BaseModel):
    id: int
    device_id: int
    geofence_id: int
    trip_date: date
    trip_number: int
    status: str
    start_time: datetime
    end_time: Optional[datetime] = None
    start_lat: float
    start_lon: float
    end_lat: Optional[float] = None
    end_lon: Optional[float] = None
    distance_km: Optional[float] = None
    duration_min: Optional[float] = None
    driving_fuel_liters: Optional[float] = None
    idle_fuel_liters: Optional[float] = None
    total_fuel_liters: Optional[float] = None
    price_per_liter_used: Optional[float] = None
    fuel_cost_pkr: Optional[float] = None
    toll_tax_pkr: Optional[float] = None
    challan_pkr: Optional[float] = None
    max_speed_kmh: Optional[float] = None
    harsh_brake_count: Optional[int] = None
    harsh_accel_count: Optional[int] = None
    overspeed_count: Optional[int] = None
    idle_count: Optional[int] = None

    # NEW — driver active on the vehicle at the time this trip started
    # (None if nobody was assigned). Populated by the endpoint, not by
    # model_validate, since it isn't a column on Trip itself — see
    # driver_service.get_driver_for_trip.
    driver_id: Optional[int] = None
    driver_name: Optional[str] = None
    driver_pic_url: Optional[str] = None
    # True only when this trip is still in_progress AND the vehicle
    # currently has no actively-assigned driver — the "prominent alert"
    # case, as opposed to a completed trip that simply has no driver on
    # record.
    driver_alert: bool = False

    # Per-trip confirmation (independent of vehicle assignment).
    # pending until admin/manager confirms; confirmed_* then hold the
    # actual driver for this trip.
    driver_confirmation_status: str = "pending"
    confirmed_driver_id: Optional[int] = None
    confirmed_driver_name: Optional[str] = None
    confirmed_driver_pic_url: Optional[str] = None

    # Route assigned to the vehicle at trip start (None if unassigned).
    # Populated by the endpoint from RouteVehicle covering start_time.
    route_id: Optional[int] = None
    route_name: Optional[str] = None
    route_confirmation_status: str = "pending"
    confirmed_route_id: Optional[int] = None
    confirmed_route_name: Optional[str] = None

    @field_serializer("start_time", "end_time")
    def _serialize_utc(self, dt: Optional[datetime]) -> Optional[str]:
        """Serialize naive-UTC datetimes with an explicit 'Z' suffix so
        JavaScript's new Date(...) treats them as UTC (not local time),
        matching the _utc_iso() format used by report.py's detailed_positions.
        """
        if dt is None:
            return None
        if dt.tzinfo is not None:
            dt = dt.astimezone(timezone.utc)
        return dt.strftime("%Y-%m-%dT%H:%M:%SZ")

    class Config:
        from_attributes = True


class AdminTripOut(TripOut):
    """Fleet-wide trip row — same fields as TripOut plus the vehicle
    name, the vehicle owner's display name, and the manager that owner
    reports to (none of these is a column on Trip; all are populated
    by list_all_trips).
    `user_name` is the owner's `full_name` (falling back to `username`).
    `manager_name` is the manager's display name (`full_name`, falling
    back to `username`), matching how /api/managers already presents
    managers. None if the vehicle has no owner or the owner isn't
    assigned to a manager.
    """
    vehicle_name: str
    user_name: Optional[str] = None
    manager_name: Optional[str] = None


class TripDriverConfirm(BaseModel):
    driver_id: int


class ConfirmableDriverOut(BaseModel):
    id: int
    name: str
    driver_pic_url: Optional[str] = None
    current_device_id: Optional[int] = None
    current_device_name: Optional[str] = None

    class Config:
        from_attributes = True


class TripRouteConfirm(BaseModel):
    route_id: int


class ConfirmableRouteOut(BaseModel):
    id: int
    name: str
    current_device_names: list[str] = []

    class Config:
        from_attributes = True


class RouteVehicleMatchOut(BaseModel):
    device_id: int
    vehicle_name: str
    trip_count: int


class RouteMatchedTripOut(BaseModel):
    trip_id: int
    date: date
    start_time: Optional[datetime] = None
    end_time: Optional[datetime] = None
    match_percent: float = 0

    @field_serializer("start_time", "end_time")
    def _serialize_route_trip_time(self, dt: Optional[datetime]) -> Optional[str]:
        if dt is None:
            return None
        if dt.tzinfo is not None:
            dt = dt.astimezone(timezone.utc)
        return dt.strftime("%Y-%m-%dT%H:%M:%SZ")


class RouteOtherTripOut(RouteMatchedTripOut):
    device_id: int
    vehicle_name: str


class RouteStatusSegment(BaseModel):
    start_index: int
    end_index: int
    on_route: bool


class TripRouteDetailOut(BaseModel):
    trip_id: int
    route_id: int
    route_name: str
    trip_date: date
    route_path: list[RoutePoint]
    actual_path: list[ActualPathPoint]
    deviation_segments: list[dict] = []
    leg_start_index: int
    leg_end_index: int
    route_status_segments: list[RouteStatusSegment] = []
    driver_name: Optional[str] = None
    vehicle_name: str
    distance_km: Optional[float] = None
    avg_speed_kmh: Optional[float] = None
    duration_min: Optional[float] = None
    fuel_avg: Optional[float] = None
    fuel_cost_pkr: Optional[float] = None
    price_per_liter_used: Optional[float] = None
    toll_tax_pkr: Optional[float] = None
    challan_pkr: Optional[float] = None


class TripCostsUpdate(BaseModel):
    toll_tax_pkr: Optional[float] = None
    challan_pkr: Optional[float] = None


# ─────────────────────────────────────────
# ALERTS
# ─────────────────────────────────────────

class AlertOut(BaseModel):
    id: int
    device_id: int
    device_name: Optional[str] = None
    device_plate: Optional[str] = None
    alert_type: str
    severity: str
    message: Optional[str] = None
    is_resolved: bool
    triggered_at: datetime
    resolved_at: Optional[datetime] = None

    @field_serializer("triggered_at", "resolved_at")
    def _serialize_utc(self, dt: Optional[datetime]) -> Optional[str]:
        if dt is None:
            return None
        if dt.tzinfo is not None:
            dt = dt.astimezone(timezone.utc)
        return dt.strftime("%Y-%m-%dT%H:%M:%SZ")

    class Config:
        from_attributes = True


class AlertSummaryOut(BaseModel):
    date: str  # UTC calendar date this summary covers
    critical: int
    warning: int
    info: int
    total: int


# ─────────────────────────────────────────
# ADMIN DASHBOARD
# ─────────────────────────────────────────

class AdminDashboardSummaryOut(BaseModel):
    """Fleet-wide aggregates the Admin Dashboard can't get from an
    existing endpoint. Vehicle status breakdown still comes from
    /api/live client-side; trip/driver counters below are computed here."""
    trips_today: int
    vehicles_due_maintenance: int  # vehicles with >=1 item due_soon/overdue
    vehicles_overdue_maintenance: int = 0  # vehicles with >=1 overdue item
    maintenance_records_ytd: int = 0  # non-baseline visits this calendar year
    trips_completed_today: int
    trips_ongoing_today: int
    trips_total_distance_km: float
    trips_total_fuel_cost_pkr: float
    trips_total_toll_cost_pkr: float
    trips_total_challan_cost_pkr: float
    trips_total_cost_pkr: float
    drivers_total: int
    drivers_active: int
    drivers_on_trip: int
    drivers_on_leave: int
    drivers_available: int
    user_count: int = 0
    managers_count: int = 0
    users_with_vehicles: int = 0
    users_unassigned: int = 0


class DashboardTrendPointOut(BaseModel):
    """One Fleet Trends chart bucket (hour or calendar day)."""
    label: str
    distance: float
    fuelLiters: float
    fuelCost: float


class DashboardTrendsOut(BaseModel):
    period: str
    points: list[DashboardTrendPointOut]


class DashboardMaintenancePointOut(BaseModel):
    """One Maintenance chart bucket (calendar day)."""
    label: str
    visits: int
    cost: float


class DashboardMaintenanceTrendsOut(BaseModel):
    period: str
    points: list[DashboardMaintenancePointOut]


# ─────────────────────────────────────────
# USERS & MANAGERS
#
# A User is a person — currently the "vehicle owner" on Device, and the
# pool of candidates that can be promoted to Manager. A Manager oversees
# a group of Users (and, through each assigned user's owned vehicle(s),
# those vehicles too — see the Managers admin page).
# ─────────────────────────────────────────

# Permission keys used to live here as MANAGER_PERMISSION_KEYS (a
# hardcoded list the Permissions modal rendered as checkboxes). The
# catalog is now the `permission_definitions` table — see
# GET /api/settings/permissions and GET /api/managers/permission-keys.
# Original seed keys (comments became `description` in the migration):
#   geofence              # create/edit geofences
#   live_tracking         # view live vehicle positions/map
#   reports_analytics     # daily/vehicle reports
#   trip_history          # view trip logs
#   alerts_notifications  # view + resolve alerts
#   maintenance           # log/edit maintenance records
#   fuel_prices           # manage fuel price entries
#   driver_management     # add/edit drivers, assign to vehicles
#   vehicle_management    # add/edit vehicles
#   user_management       # add/edit users (seeded later; see alembic f1a6c3d8e475)


class UserCreate(BaseModel):
    username: str
    password: str
    full_name: Optional[str] = None
    phone_number: Optional[str] = None

    @field_validator("password")
    @classmethod
    def _validate_new_user_password(cls, value: str) -> str:
        return validate_new_user_password(value)


class UserUpdate(BaseModel):
    username: Optional[str] = None
    password: Optional[str] = None
    full_name: Optional[str] = None
    phone_number: Optional[str] = None


class ManagerVehicleCreateIn(BaseModel):
    """Vehicle half of ManagerCreateUserWithVehicle — same fields as
    DeviceCreate except user_id (set server-side to the new user).
    """
    name: str
    imei: str
    vehicle_type: Optional[str] = None
    plate_number: Optional[str] = None
    fuel_type_id: Optional[int] = None
    fuel_avg_running: Optional[float] = None
    fuel_avg_idle: Optional[float] = None
    primary_geofence_id: Optional[int] = None
    speed_limit_kmh: Optional[float] = None
    harsh_brake_delta_kmh: Optional[float] = None
    harsh_accel_delta_kmh: Optional[float] = None


class ManagerCreateUserWithVehicle(BaseModel):
    """Bundled manager "Add User" payload — one request creates the
    user (auto-assigned to the manager) and their mandatory vehicle.
    Nested shape matches MaintenanceRecordCreate (parent + nested list/
    object) rather than a flat merge of two schemas.
    """
    user: UserCreate
    vehicle: ManagerVehicleCreateIn


class UserVehicleOut(BaseModel):
    """Vehicle summary embedded in UserOut — identity plus the driving
    parameters the Edit User modal needs without a second round trip.
    """
    id: int
    name: str
    plate_number: Optional[str] = None
    vehicle_type: Optional[str] = None
    fuel_type_id: Optional[int] = None
    fuel_avg_running: Optional[float] = None
    fuel_avg_idle: Optional[float] = None
    primary_geofence_id: Optional[int] = None
    speed_limit_kmh: Optional[float] = None
    harsh_brake_delta_kmh: Optional[float] = None
    harsh_accel_delta_kmh: Optional[float] = None
    pic_url: Optional[str] = None

    class Config:
        from_attributes = True


class UserOut(BaseModel):
    id: int
    username: str
    full_name: Optional[str] = None
    phone_number: Optional[str] = None
    manager_id: Optional[int] = None
    is_manager: bool = False   # True if this user has ALSO been promoted to Manager
    has_password: bool = False
    pic_url: Optional[str] = None
    permissions: dict[str, bool] = {}
    notification_prefs: dict[str, bool] = {}
    vehicles: list[UserVehicleOut] = []
    created_at: Optional[datetime] = None

    @field_validator("permissions", "notification_prefs", mode="before")
    @classmethod
    def _empty_json_dict(cls, value):
        return value or {}

    @field_serializer("created_at")
    def _serialize_created_at(self, dt: Optional[datetime]) -> Optional[str]:
        if dt is None:
            return None
        if dt.tzinfo is not None:
            dt = dt.astimezone(timezone.utc)
        return dt.strftime("%Y-%m-%dT%H:%M:%SZ")

    class Config:
        from_attributes = True


class PasswordRevealOut(BaseModel):
    password: str


class ManagerCreate(BaseModel):
    user_id: int   # which existing User to promote


class ManagerPermissionsUpdate(BaseModel):
    permissions: dict[str, bool] = {}


class UserPermissionsUpdate(BaseModel):
    permissions: dict[str, bool] = {}


class NotificationPrefsUpdate(BaseModel):
    notification_prefs: dict[str, bool] = {}


class NotificationPrefsOut(BaseModel):
    notification_prefs: dict[str, bool] = {}


class ManagerAssignUsers(BaseModel):
    user_ids: list[int]


class ManagerUnassignUser(BaseModel):
    user_id: int


class ManagerOut(BaseModel):
    """Summary shape — used in the managers list panel."""
    id: int
    user_id: int
    username: str
    full_name: Optional[str] = None
    phone_number: Optional[str] = None
    pic_url: Optional[str] = None
    permissions: dict[str, bool] = {}
    notification_prefs: dict[str, bool] = {}
    assigned_user_count: int = 0
    total_vehicle_count: int = 0
    created_at: Optional[datetime] = None

    @field_validator("permissions", "notification_prefs", mode="before")
    @classmethod
    def _empty_json_dict(cls, value):
        return value or {}

    @field_serializer("created_at")
    def _serialize_created_at(self, dt: Optional[datetime]) -> Optional[str]:
        if dt is None:
            return None
        if dt.tzinfo is not None:
            dt = dt.astimezone(timezone.utc)
        return dt.strftime("%Y-%m-%dT%H:%M:%SZ")

    class Config:
        from_attributes = True


class ManagerDetailOut(ManagerOut):
    """Full shape — used when a manager's detail panel is opened.
    Adds the actual list of assigned users (each with their vehicles),
    which is where the "Total Vehicles" section on the wireframe comes
    from — it's just every vehicle owned by every assigned user.
    """
    assigned_users: list[UserOut] = []


# ─────────────────────────────────────────
# SETTINGS — permission catalog + fleet-wide alert-type toggles
# ─────────────────────────────────────────

class PermissionDefinitionOut(BaseModel):
    id: int
    key: str
    label: str
    description: Optional[str] = None
    is_active: bool
    default_for_new_managers: bool
    applies_to_user: bool = False
    default_for_new_users: bool = False
    created_at: Optional[datetime] = None

    @field_serializer("created_at")
    def _serialize_created_at(self, dt: Optional[datetime]) -> Optional[str]:
        if dt is None:
            return None
        if dt.tzinfo is not None:
            dt = dt.astimezone(timezone.utc)
        return dt.strftime("%Y-%m-%dT%H:%M:%SZ")

    class Config:
        from_attributes = True


class PermissionDefinitionCreate(BaseModel):
    key: str
    label: str
    description: Optional[str] = None
    default_for_new_managers: bool = False
    applies_to_user: bool = False
    default_for_new_users: bool = False


class PermissionDefinitionUpdate(BaseModel):
    key: Optional[str] = None
    label: Optional[str] = None
    description: Optional[str] = None
    is_active: Optional[bool] = None
    default_for_new_managers: Optional[bool] = None
    applies_to_user: Optional[bool] = None
    default_for_new_users: Optional[bool] = None


class AlertTypeSettingOut(BaseModel):
    id: int
    alert_type: str
    is_enabled: bool
    default_manager_bell: bool = True
    default_user_bell: bool = True
    offered_to_managers: bool = True
    updated_at: Optional[datetime] = None

    @field_serializer("updated_at")
    def _serialize_updated_at(self, dt: Optional[datetime]) -> Optional[str]:
        if dt is None:
            return None
        if dt.tzinfo is not None:
            dt = dt.astimezone(timezone.utc)
        return dt.strftime("%Y-%m-%dT%H:%M:%SZ")

    class Config:
        from_attributes = True


class AlertTypeSettingUpdate(BaseModel):
    is_enabled: Optional[bool] = None
    default_manager_bell: Optional[bool] = None
    default_user_bell: Optional[bool] = None
    offered_to_managers: Optional[bool] = None


# ─────────────────────────────────────────
# DRIVERS
# ─────────────────────────────────────────

class DriverOut(BaseModel):
    id: int
    name: str
    id_card_number: str
    phone_number: Optional[str] = None
    license_number: Optional[str] = None
    license_expiry: Optional[date] = None
    status: str
    date_joined: Optional[date] = None
    license_pic_path: Optional[str] = None
    driver_pic_path: Optional[str] = None

    # NEW — populated by the endpoint (not a column on Driver), from the
    # driver's currently-open DriverAssignment, if any.
    current_device_id: Optional[int] = None
    current_device_name: Optional[str] = None
    current_device_plate: Optional[str] = None
    assigned_since: Optional[datetime] = None

    @field_serializer("assigned_since")
    def _serialize_assigned_since(self, dt: Optional[datetime]) -> Optional[str]:
        if dt is None:
            return None
        if dt.tzinfo is not None:
            dt = dt.astimezone(timezone.utc)
        return dt.strftime("%Y-%m-%dT%H:%M:%SZ")

    class Config:
        from_attributes = True


# ─────────────────────────────────────────
# MAINTENANCE
# ─────────────────────────────────────────

class MaintenanceItemOut(BaseModel):
    id: int
    key: str
    label: str
    sort_order: int

    class Config:
        from_attributes = True


class MaintenanceItemStatusOut(BaseModel):
    item_id: int
    key: str
    label: str
    dimension: str  # "distance" | "engine_hours"
    interval_value: float
    interval_source: str  # "vehicle" | "type" | "fallback"
    last_service_value: Optional[float] = None
    current_value: Optional[float] = None
    progress_pct: Optional[float] = None
    status: str  # "ok" | "due_soon" | "overdue" | "no_baseline" | "unknown"


class MaintenanceStatusOut(BaseModel):
    success: bool = True
    device_id: int
    has_baseline: bool
    today: date
    odometer_km: Optional[float] = None
    engine_hours: Optional[float] = None
    items: list[MaintenanceItemStatusOut] = []


class MaintenanceEngineHoursUpdate(BaseModel):
    engine_hours: float


class MaintenanceRecordLineCreate(BaseModel):
    item_id: Optional[int] = None
    custom_label: Optional[str] = None
    price: float = 0
    checked: bool = True
    service_odometer_km: Optional[float] = None
    service_engine_hours: Optional[float] = None


class MaintenanceRecordCreate(BaseModel):
    record_date: Optional[date] = None
    odometer_km: float
    engine_hours: Optional[float] = None
    notes: Optional[str] = None
    lines: list[MaintenanceRecordLineCreate] = []
    total_cost: Optional[float] = None


class MaintenanceRecordLineOut(BaseModel):
    item_id: Optional[int] = None
    label: str
    price: float
    checked: bool

    class Config:
        from_attributes = True


class MaintenanceRecordOut(BaseModel):
    id: int
    device_id: int
    record_date: date
    odometer_km: float
    engine_hours: Optional[float] = None
    is_baseline: bool
    total_cost: float
    notes: Optional[str] = None
    lines: list[MaintenanceRecordLineOut] = []

    class Config:
        from_attributes = True


class MaintenanceDueLineOut(BaseModel):
    item_id: int
    key: str
    label: str
    dimension: Optional[str] = None  # "distance" | "engine_hours"
    interval_value: Optional[float] = None
    last_service_value: Optional[float] = None
    current_value: Optional[float] = None
    progress_pct: Optional[float] = None
    status: str  # "ok" | "due_soon" | "overdue" | "no_baseline" | "unknown"


class MaintenanceDueReportRowOut(BaseModel):
    snapshot_date: date
    odometer_km: Optional[float] = None
    engine_hours: Optional[float] = None
    lines: list[MaintenanceDueLineOut] = []


class MaintenanceDueReportOut(BaseModel):
    success: bool = True
    device_id: int
    items: list[MaintenanceItemOut] = []
    rows: list[MaintenanceDueReportRowOut] = []


class VehicleMaintenanceSettingUpdate(BaseModel):
    dimension: str  # "distance" | "engine_hours"
    interval_value: float


class VehicleMaintenanceSettingOut(BaseModel):
    id: int
    device_id: int
    item_id: int
    dimension: str
    interval_value: float

    class Config:
        from_attributes = True


class DriverAssignmentOut(BaseModel):
    id: int
    driver_id: int
    device_id: int
    device_name: Optional[str] = None
    device_plate: Optional[str] = None
    driver_name: Optional[str] = None
    driver_pic_url: Optional[str] = None
    start_time: datetime
    end_time: Optional[datetime] = None

    @field_serializer("start_time", "end_time")
    def _serialize_utc(self, dt: Optional[datetime]) -> Optional[str]:
        if dt is None:
            return None
        if dt.tzinfo is not None:
            dt = dt.astimezone(timezone.utc)
        return dt.strftime("%Y-%m-%dT%H:%M:%SZ")

    class Config:
        from_attributes = True