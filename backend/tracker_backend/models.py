from sqlalchemy import (
    Column, Integer, String, Float, Boolean, DateTime, Date,
    ForeignKey, TIMESTAMP, JSON, Enum, UniqueConstraint, Index, Computed
)
from sqlalchemy.sql import func
from datetime import datetime, timezone
from tracker_backend.db import Base


class Admin(Base):
    """Fleet owner (tenant). One admin = one fleet of users/devices/etc."""
    __tablename__ = "admins"

    id = Column(Integer, primary_key=True)
    username = Column(String(60), unique=True, nullable=False)
    password_hash = Column(String(255), nullable=False)
    full_name = Column(String(120), nullable=True)
    phone = Column(String(20), nullable=True)
    is_active = Column(Boolean, nullable=False, default=True)
    created_at = Column(TIMESTAMP, server_default=func.now())
    updated_at = Column(TIMESTAMP, server_default=func.now(), onupdate=func.now())


class SuperAdmin(Base):
    """Platform owner. Exactly one row (enforced by singleton_key unique)."""
    __tablename__ = "super_admins"

    id = Column(Integer, primary_key=True)
    username = Column(String(60), unique=True, nullable=False)
    password_hash = Column(String(255), nullable=False)
    full_name = Column(String(120), nullable=True)
    phone = Column(String(20), nullable=True)
    is_active = Column(Boolean, nullable=False, default=True)
    # Always 1 — unique constraint guarantees at most one row.
    singleton_key = Column(Integer, nullable=False, default=1, unique=True)
    created_at = Column(TIMESTAMP, server_default=func.now())
    updated_at = Column(TIMESTAMP, server_default=func.now(), onupdate=func.now())


class Device(Base):
    __tablename__ = "devices"

    id = Column(Integer, primary_key=True)
    traccar_device_id = Column(Integer, unique=True, nullable=False)
    name = Column(String(120), nullable=False)

    last_seen_at = Column(DateTime, nullable=True)
    device_type = Column(String(20), nullable=True)  # "mobile" | "hardware", auto-detected

    # NEW — fleet metadata, set manually via your own CRUD, not from Traccar
    vehicle_type = Column(String(30), nullable=True)          # "truck" | "car" | "bike" | etc.
    plate_number = Column(String(30), nullable=True)

    # Path relative to the uploads root, e.g. "vehicles/photo/<uuid>.jpg".
    pic_path = Column(String(255), nullable=True)

    # Owner of this vehicle (see Users & Managers feature). NULL means
    # no owner has been linked yet. A user owns AT MOST one vehicle
    # (product decision — see migration 934f74786d41) — unique=True
    # enforces this at the DB level; MySQL/InnoDB unique indexes treat
    # each NULL as distinct, so multiple ownerless devices are still
    # fine. update_fleet_device in main.py checks this up front too,
    # to return a clean 400 instead of a raw IntegrityError.
    user_id = Column(Integer, ForeignKey("users.id"), unique=True, nullable=True)
    # Tenant: mirrors owning user's admin_id (NULL = unassigned/orphan).
    admin_id = Column(Integer, ForeignKey("admins.id"), nullable=True, index=True)
    fuel_type_id = Column(Integer, ForeignKey("fuel_types.id"), nullable=True)
    fuel_avg_running = Column(Float, nullable=True)        # km per liter, used for fuel-cost estimates later
    fuel_avg_idle = Column(Float, nullable=True)           # liters per hour while idling
    fuel_avg_idle_auto = Column(Boolean, nullable=False, default=True)

    primary_geofence_id = Column(Integer, ForeignKey("geofences.id"), nullable=True)

    # NEW — per-vehicle driving-behavior customization. NULL means "use
    # the fleet-wide default" (see services/report.py's OVERSPEED_THRESHOLD_KMH /
    # HARSH_BRAKE_DELTA_KMH / HARSH_ACCEL_DELTA_KMH) — every place that
    # evaluates these (daily report, trip metrics, live alerts) falls
    # back to that default when a vehicle hasn't set its own value.
    speed_limit_kmh = Column(Float, nullable=True)
    harsh_brake_delta_kmh = Column(Float, nullable=True)   # km/h speed drop within one poll counted as harsh braking
    harsh_accel_delta_kmh = Column(Float, nullable=True)   # km/h speed gain within one poll counted as harsh acceleration

    # NEW — maintenance feature. Manually maintained; auto-filled from a
    # position's raw_attributes["hours"] when Traccar reports it (see
    # services/position_writer.py), and correctable via
    # PATCH /api/maintenance/devices/{id}/engine-hours for devices that
    # never report it (mobile). See services/maintenance_service.py.
    engine_hours = Column(Float, nullable=True)

    created_at = Column(TIMESTAMP, server_default=func.now())


class User(Base):
    """A person — currently used as the "vehicle owner" on Device, and
    as the pool of candidates that can be promoted to Manager (see
    Manager below). Deliberately NOT auth/login yet (see project plan —
    that's a separate later step); this just holds identity fields.
    """
    __tablename__ = "users"

    id = Column(Integer, primary_key=True)
    username = Column(String(60), unique=True, nullable=False)
    full_name = Column(String(120), nullable=True)
    phone_number = Column(String(20), nullable=True)

    # Which Manager this user currently reports to. NULL = unassigned.
    # A user can report to at most one manager at a time (set directly
    # by services/manager_service.py — no history table, unlike
    # DriverAssignment, since there's no reporting requirement yet).
    manager_id = Column(Integer, ForeignKey("managers.id"), nullable=True)

    # Path relative to the uploads root, e.g. "users/photo/<uuid>.jpg".
    pic_path = Column(String(255), nullable=True)

    # User-panel grants {permission_key: bool}. Only keys with
    # PermissionDefinition.applies_to_user are meaningful; the user
    # shell hides nav from missing keys. API 403 for users waits on
    # login / user-scoped routes.
    permissions = Column(JSON, nullable=True)

    # Per-user alert-type bell filter {alert_type: bool}. Independent of
    # fleet detection (AlertTypeSetting.is_enabled).
    notification_prefs = Column(JSON, nullable=True)

    password_hash = Column(String(255), nullable=True)
    password_enc = Column(String(512), nullable=True)

    # Tenant fleet owner. NULL = unassigned/orphan (Super Admin only list).
    admin_id = Column(Integer, ForeignKey("admins.id"), nullable=True, index=True)

    created_at = Column(TIMESTAMP, server_default=func.now())


class Manager(Base):
    """A User promoted to oversee a group of other Users (and, through
    each assigned user's owned vehicle(s), those vehicles too). One-to-
    one with User — a given user can be promoted at most once; demoting
    (DELETE /api/managers/{id}) removes this row and the promotion, but
    leaves the underlying User intact.
    """
    __tablename__ = "managers"

    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), unique=True, nullable=False)

    # {permission_key: bool} granted to this manager. Enforced on
    # /api/manager/{id}/… via require_manager_permission (deps.py) and
    # the manager-panel PermissionGate. Catalog of keys lives in
    # PermissionDefinition.
    permissions = Column(JSON, nullable=True)

    # Per-manager alert-type bell filter {alert_type: bool}. Independent
    # of fleet detection (AlertTypeSetting.is_enabled).
    notification_prefs = Column(JSON, nullable=True)

    created_at = Column(TIMESTAMP, server_default=func.now())


class PermissionDefinition(Base):
    """Catalog of permission keys grantable to a Manager (and a subset
    to a User). Manager grants are enforced on /api/manager/{id}/…;
    user grants currently hide the user-panel nav. Soft-deactivated via
    is_active rather than deleted, because existing people may already
    have the key in their permissions JSON.
    """
    __tablename__ = "permission_definitions"

    id = Column(Integer, primary_key=True)
    key = Column(String(60), unique=True, nullable=False)
    label = Column(String(120), nullable=False)
    description = Column(String(255), nullable=True)
    is_active = Column(Boolean, nullable=False, default=True)
    default_for_new_managers = Column(Boolean, nullable=False, default=False)
    applies_to_user = Column(Boolean, nullable=False, default=False)
    default_for_new_users = Column(Boolean, nullable=False, default=False)
    created_at = Column(TIMESTAMP, server_default=func.now())


class Geofence(Base):
    __tablename__ = "geofences"

    id = Column(Integer, primary_key=True)
    name = Column(String(120), nullable=False)
    center_lat = Column(Float, nullable=False)
    center_lon = Column(Float, nullable=False)
    radius_meters = Column(Float, nullable=False)
    admin_id = Column(Integer, ForeignKey("admins.id"), nullable=True, index=True)
    created_at = Column(TIMESTAMP, server_default=func.now())


class Route(Base):
    __tablename__ = "routes"

    id = Column(Integer, primary_key=True)
    name = Column(String(120), nullable=False)
    direction_label = Column(String(120), nullable=True)
    waypoints = Column(JSON, nullable=False)
    path = Column(JSON, nullable=False)
    tolerance_meters = Column(Float, nullable=False, default=400, server_default="400")
    admin_id = Column(Integer, ForeignKey("admins.id"), nullable=True, index=True)
    created_at = Column(TIMESTAMP, server_default=func.now())


class RouteVehicle(Base):
    """Time-ranged link between a route and a vehicle (Device).

    end_time IS NULL means this is the CURRENTLY active assignment for
    the device. A vehicle can have only one open route at a time; the
    same route can be assigned to many vehicles. History is preserved
    by closing (setting end_time), never deleting.
    """
    __tablename__ = "route_vehicles"

    id = Column(Integer, primary_key=True)
    route_id = Column(Integer, ForeignKey("routes.id", ondelete="CASCADE"), nullable=False)
    device_id = Column(Integer, ForeignKey("devices.id", ondelete="CASCADE"), nullable=False)
    start_time = Column(DateTime, nullable=False)
    end_time = Column(DateTime, nullable=True)  # NULL = currently assigned
    created_at = Column(TIMESTAMP, server_default=func.now())

    __table_args__ = (
        Index("ix_route_vehicles_route_id", "route_id"),
        Index("ix_route_vehicles_device_end", "device_id", "end_time"),
    )


class DevicePosition(Base):
    __tablename__ = "device_positions"
    __table_args__ = (
        Index("ix_device_positions_device_id_fix_time", "device_id", "fix_time"),
    )

    id = Column(Integer, primary_key=True)
    device_id = Column(Integer, ForeignKey("devices.id", ondelete="CASCADE"), nullable=False)

    lat = Column(Float, nullable=False)
    lon = Column(Float, nullable=False)
    altitude = Column(Float)
    speed_kmh = Column(Float)
    course = Column(Float)
    accuracy = Column(Float)

    protocol = Column(String(30))
    address = Column(String(255))

    ignition = Column(Boolean)
    motion = Column(Boolean)
    battery_level = Column(Integer)

    distance = Column(Float)
    total_distance = Column(Float)

    geofence_ids = Column(JSON)

    motion_status = Column(
        Enum("moving", "idle", "stopped", name="motion_status_enum"),
        nullable=False,
        default="stopped",
    )

    is_gps_anomaly = Column(Boolean, nullable=False, default=False)

    raw_attributes = Column(JSON)

    fix_time = Column(DateTime, nullable=False)
    created_at = Column(TIMESTAMP, server_default=func.now())


class DeviceAlert(Base):
    __tablename__ = "device_alerts"

    id = Column(Integer, primary_key=True)
    device_id = Column(Integer, ForeignKey("devices.id", ondelete="CASCADE"), nullable=False)
    alert_type = Column(String(50), nullable=False)
    message = Column(String(255))
    is_resolved = Column(Boolean, nullable=False, default=False)

    # NEW — 3-tier severity for the Alert page (critical/warning/info).
    # "critical" = needs attention now (geofence exit, overspeed, device
    # silent/power-off). "warning" = driving-behavior flags (harsh brake,
    # harsh accel). "info" = informational (driver not assigned, trip
    # completed). Written by security_monitor.py and alert_monitor.py.
    severity = Column(
        Enum("critical", "warning", "info", name="alert_severity_enum"),
        nullable=False,
        server_default="warning",
    )

    # Both set via Python's own UTC clock (datetime.utcnow), NOT MySQL's
    # NOW() — keeps this table on the same clock as last_seen_at/fix_time
    # everywhere else, instead of mixing UTC and the server's local time.
    triggered_at = Column(DateTime, default=lambda: datetime.now(timezone.utc).replace(tzinfo=None))
    resolved_at = Column(DateTime, nullable=True)


class AlertTypeSetting(Base):
    """Fleet-wide on/off switch for generating a given DeviceAlert type.

    When is_enabled is False, alert_monitor.py / security_monitor.py skip
    raising new alerts of this type. Existing open rows are left alone
    (and can still auto-resolve when the condition clears). Independent
    of per-person notification_prefs and the admin topbar's localStorage
    display filter.

    default_manager_bell / default_user_bell seed notification_prefs
    when a user is created. Managers seed from offered_to_managers
    (all offered types on at promote).

    offered_to_managers controls whether the type appears in the
    Managers Notifications modal. Turning it off also revokes the
    type from every manager's notification_prefs.
    """
    __tablename__ = "alert_type_settings"

    id = Column(Integer, primary_key=True)
    alert_type = Column(String(60), unique=True, nullable=False)
    is_enabled = Column(Boolean, nullable=False, default=True)
    default_manager_bell = Column(Boolean, nullable=False, default=True)
    default_user_bell = Column(Boolean, nullable=False, default=True)
    offered_to_managers = Column(Boolean, nullable=False, default=True)
    updated_at = Column(TIMESTAMP, server_default=func.now(), onupdate=func.now())


class AdminPermissionOffering(Base):
    """Per-fleet overlay: which PermissionDefinition keys this admin offers
    to managers. Missing row = offered (default on). Turning off revokes
    the key from managers in this fleet only.
    """
    __tablename__ = "admin_permission_offerings"
    __table_args__ = (
        UniqueConstraint("admin_id", "permission_key", name="uq_admin_permission_offering"),
    )

    id = Column(Integer, primary_key=True)
    admin_id = Column(Integer, ForeignKey("admins.id", ondelete="CASCADE"), nullable=False, index=True)
    permission_key = Column(String(60), nullable=False)
    is_offered = Column(Boolean, nullable=False, default=True)
    updated_at = Column(TIMESTAMP, server_default=func.now(), onupdate=func.now())


class AdminAlertOffering(Base):
    """Per-fleet overlay: which alert types this admin offers in the
    manager Notifications modal. Missing row = offered (default on).
    Detection (AlertTypeSetting.is_enabled) stays global.
    """
    __tablename__ = "admin_alert_offerings"
    __table_args__ = (
        UniqueConstraint("admin_id", "alert_type", name="uq_admin_alert_offering"),
    )

    id = Column(Integer, primary_key=True)
    admin_id = Column(Integer, ForeignKey("admins.id", ondelete="CASCADE"), nullable=False, index=True)
    alert_type = Column(String(60), nullable=False)
    offered_to_managers = Column(Boolean, nullable=False, default=True)
    updated_at = Column(TIMESTAMP, server_default=func.now(), onupdate=func.now())


class FuelType(Base):
    __tablename__ = "fuel_types"

    id = Column(Integer, primary_key=True)
    name = Column(String(30), unique=True, nullable=False)
    created_at = Column(TIMESTAMP, server_default=func.now())


class FuelPrice(Base):
    __tablename__ = "fuel_prices"

    id = Column(Integer, primary_key=True)
    fuel_type_id = Column(Integer, ForeignKey("fuel_types.id", ondelete="CASCADE"), nullable=False)
    # NULL = global price (Super Admin); N = fleet override for admin N.
    admin_id = Column(Integer, ForeignKey("admins.id"), nullable=True, index=True)
    price_per_liter = Column(Float, nullable=False)
    effective_date_start = Column(Date, nullable=False)
    effective_date_end = Column(Date, nullable=True)  # NULL = currently active, no newer price yet
    created_at = Column(TIMESTAMP, server_default=func.now())
    # MySQL: IFNULL(admin_id,0) so two global rows cannot share a start date.
    admin_id_key = Column(
        Integer,
        Computed("IFNULL(admin_id, 0)", persisted=True),
        nullable=True,
    )

    __table_args__ = (
        UniqueConstraint(
            "fuel_type_id",
            "admin_id_key",
            "effective_date_start",
            name="uq_fuel_price_type_admin_date",
        ),
    )


class Trip(Base):
    __tablename__ = "trips"

    id = Column(Integer, primary_key=True)
    device_id = Column(Integer, ForeignKey("devices.id", ondelete="CASCADE"), nullable=False)
    geofence_id = Column(Integer, ForeignKey("geofences.id"), nullable=False)
    trip_date = Column(Date, nullable=False)
    trip_number = Column(Integer, nullable=False)
    status = Column(
        Enum("in_progress", "completed", name="trip_status_enum"),
        nullable=False,
        default="in_progress",
    )
    start_time = Column(DateTime, nullable=False)
    end_time = Column(DateTime, nullable=True)
    start_lat = Column(Float, nullable=False)
    start_lon = Column(Float, nullable=False)
    end_lat = Column(Float, nullable=True)
    end_lon = Column(Float, nullable=True)
    distance_km = Column(Float, nullable=True)
    duration_min = Column(Float, nullable=True)
    driving_fuel_liters = Column(Float, nullable=True)
    idle_fuel_liters = Column(Float, nullable=True)
    total_fuel_liters = Column(Float, nullable=True)
    price_per_liter_used = Column(Float, nullable=True)
    fuel_cost_pkr = Column(Float, nullable=True)
    toll_tax_pkr = Column(Float, nullable=True)
    challan_pkr = Column(Float, nullable=True)

    # NEW — driving-behavior metrics for this trip specifically (mirrors
    # the same metrics report.py computes for a full day, but scoped to
    # just this trip's positions). Populated by calculate_trip_metrics().
    max_speed_kmh = Column(Float, nullable=True)
    harsh_brake_count = Column(Integer, nullable=True)
    harsh_accel_count = Column(Integer, nullable=True)
    overspeed_count = Column(Integer, nullable=True)
    idle_count = Column(Integer, nullable=True)  # number of separate idle/stop occurrences during this trip

    # Per-trip driver confirmation (independent of vehicle assignment).
    # NULL = pending; set when admin/manager confirms who actually drove.
    confirmed_driver_id = Column(
        Integer, ForeignKey("drivers.id", ondelete="SET NULL"), nullable=True
    )
    driver_confirmed_at = Column(DateTime, nullable=True)
    driver_confirmed_by_user_id = Column(
        Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    # When confirmation borrows a driver from another vehicle, that
    # device id is stored so close can restore the assignment if the
    # borrowed-from vehicle stayed empty for the whole trip.
    borrowed_from_device_id = Column(
        Integer, ForeignKey("devices.id", ondelete="SET NULL"), nullable=True
    )

    # Per-trip route confirmation (independent of vehicle assignment).
    # NULL = pending; set when admin/manager confirms which route this
    # trip actually used. Confirming does not reassign the vehicle.
    confirmed_route_id = Column(
        Integer, ForeignKey("routes.id", ondelete="SET NULL"), nullable=True
    )
    route_confirmed_at = Column(DateTime, nullable=True)
    route_confirmed_by_user_id = Column(
        Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )

    created_at = Column(TIMESTAMP, server_default=func.now())
    updated_at = Column(TIMESTAMP, server_default=func.now(), onupdate=func.now())

    # DB-computed only (VIRTUAL generated column). device_id when
    # status = 'in_progress', else NULL. Never set this from app code —
    # the unique index on it is the safety net against two open trips
    # per device. Mapped so alembic autogenerate does not try to drop it.
    open_trip_marker = Column(
        Integer,
        Computed(
            "CASE WHEN status = 'in_progress' THEN device_id ELSE NULL END",
            persisted=False,
        ),
        nullable=True,
    )

    __table_args__ = (
        UniqueConstraint("device_id", "trip_date", "trip_number", name="uq_trip_device_date_number"),
        Index("uq_trips_open_trip_marker", "open_trip_marker", unique=True),
    )


class TripRouteMatch(Base):
    __tablename__ = "trip_route_matches"

    id = Column(Integer, primary_key=True)
    trip_id = Column(Integer, ForeignKey("trips.id", ondelete="CASCADE"), nullable=False)
    route_id = Column(Integer, ForeignKey("routes.id", ondelete="CASCADE"), nullable=False)
    match_percent = Column(Float, nullable=False)
    deviation_segments = Column(JSON, nullable=True)
    leg_start_index = Column(Integer, nullable=True)
    leg_end_index = Column(Integer, nullable=True)
    created_at = Column(TIMESTAMP, server_default=func.now())


class Driver(Base):
    __tablename__ = "drivers"

    id = Column(Integer, primary_key=True)
    name = Column(String(120), nullable=False)

    # Format enforced at the API layer: 12345-1234567-1
    id_card_number = Column(String(15), unique=True, nullable=False)

    phone_number = Column(String(20), nullable=True)
    license_number = Column(String(50), nullable=True)
    license_expiry = Column(Date, nullable=True)

    # "active" | "inactive" | "on_leave"
    status = Column(String(20), nullable=False, default="active")
    date_joined = Column(Date, nullable=True)

    # Paths relative to the uploads root, e.g. "drivers/photo/<uuid>.jpg" —
    # served back at /uploads/<path> (see StaticFiles mount in main.py).
    license_pic_path = Column(String(255), nullable=True)
    driver_pic_path = Column(String(255), nullable=True)

    admin_id = Column(Integer, ForeignKey("admins.id"), nullable=True, index=True)

    created_at = Column(TIMESTAMP, server_default=func.now())


class DriverAssignment(Base):
    """Time-ranged link between a driver and a vehicle (Device).

    end_time IS NULL means this is the CURRENTLY active assignment for
    both the driver and the device. Application logic (see
    services/driver_service.py) guarantees at most one open row per
    driver and at most one open row per device at any time — a driver
    can't be on two vehicles at once, and a vehicle can't have two
    drivers at once. History is preserved by closing (setting
    end_time), never deleting, so a date range can always be answered
    with "which driver(s) had this vehicle, and from/to when."
    """
    __tablename__ = "driver_assignments"

    id = Column(Integer, primary_key=True)
    driver_id = Column(Integer, ForeignKey("drivers.id", ondelete="CASCADE"), nullable=False)
    device_id = Column(Integer, ForeignKey("devices.id", ondelete="CASCADE"), nullable=False)

    start_time = Column(DateTime, nullable=False)
    end_time = Column(DateTime, nullable=True)  # NULL = currently active

    created_at = Column(TIMESTAMP, server_default=func.now())


# ─────────────────────────────────────────
# MAINTENANCE — see services/maintenance_service.py for the due-status
# computation this schema backs, and services/maintenance_monitor.py for
# the alert raise/resolve logic built on top of it.
# ─────────────────────────────────────────

class MaintenanceItem(Base):
    """The maintenance catalog — e.g. 'Engine Oil & Filter', 'Air Filter'.
    Fixed list, seeded by the migration. Not vehicle-specific;
    per-vehicle-type defaults live in MaintenanceItemTypeDefault below."""
    __tablename__ = "maintenance_items"

    id = Column(Integer, primary_key=True)
    key = Column(String(40), unique=True, nullable=False)   # stable slug, e.g. "engine_oil"
    label = Column(String(120), nullable=False)              # display name, e.g. "Engine Oil & Filter"
    sort_order = Column(Integer, nullable=False, default=0)  # controls display order on the page
    is_active = Column(Boolean, nullable=False, default=True)  # soft-disable without deleting history
    created_at = Column(TIMESTAMP, server_default=func.now())


class MaintenanceItemTypeDefault(Base):
    """Default due-interval for one item, for one vehicle_type. A row with
    vehicle_type=NULL is the fallback used for any vehicle_type that has
    no specific row (so the catalog doesn't need an entry for every
    item x every type combination)."""
    __tablename__ = "maintenance_item_type_defaults"

    id = Column(Integer, primary_key=True)
    item_id = Column(Integer, ForeignKey("maintenance_items.id", ondelete="CASCADE"), nullable=False)
    vehicle_type = Column(String(30), nullable=True)  # "car" | "bike" | "van" | "truck" | NULL=fallback

    dimension = Column(
        Enum("distance", "engine_hours", name="maintenance_dimension_enum"),
        nullable=False,
    )
    interval_value = Column(Float, nullable=False)  # km if dimension=distance, hours if engine_hours

    __table_args__ = (
        UniqueConstraint("item_id", "vehicle_type", name="uq_item_type_default"),
    )


class VehicleMaintenanceSetting(Base):
    """Per-vehicle manual override of an item's due interval — takes
    priority over MaintenanceItemTypeDefault when present. Deleting a row
    here reverts that vehicle/item back to the type default."""
    __tablename__ = "vehicle_maintenance_settings"

    id = Column(Integer, primary_key=True)
    device_id = Column(Integer, ForeignKey("devices.id", ondelete="CASCADE"), nullable=False)
    item_id = Column(Integer, ForeignKey("maintenance_items.id", ondelete="CASCADE"), nullable=False)

    dimension = Column(Enum("distance", "engine_hours", name="maintenance_dimension_enum"), nullable=False)
    interval_value = Column(Float, nullable=False)

    created_at = Column(TIMESTAMP, server_default=func.now())
    updated_at = Column(TIMESTAMP, server_default=func.now(), onupdate=func.now())

    __table_args__ = (
        UniqueConstraint("device_id", "item_id", name="uq_vehicle_item_setting"),
    )


class MaintenanceRecord(Base):
    """One maintenance visit/submission for a vehicle. The very first one
    for a device is the mandatory baseline (is_baseline=True)."""
    __tablename__ = "maintenance_records"

    id = Column(Integer, primary_key=True)
    device_id = Column(Integer, ForeignKey("devices.id", ondelete="CASCADE"), nullable=False)

    record_date = Column(Date, nullable=False)          # the "Date" box — defaults to today
    odometer_km = Column(Float, nullable=False)          # the "Odometer reading" box
    engine_hours = Column(Float, nullable=True)           # the "Total engine hours" box (nullable)
    is_baseline = Column(Boolean, nullable=False, default=False)

    total_cost = Column(Float, nullable=False, default=0)  # editable — see main.py records endpoint
    notes = Column(String(500), nullable=True)             # free-text note for the whole visit

    created_at = Column(TIMESTAMP, server_default=func.now())

    __table_args__ = (
        UniqueConstraint("device_id", "record_date", "id", name="uq_maintenance_record_natural"),
        # (id is already unique via PK; this composite constraint is a
        # no-op safety net, not load-bearing for the feature.)
    )


class MaintenanceRecordLine(Base):
    """One line item within a MaintenanceRecord — either a catalog item
    (item_id set) or a free-text "other repair" line (item_id NULL,
    custom_label set instead)."""
    __tablename__ = "maintenance_record_lines"

    id = Column(Integer, primary_key=True)
    record_id = Column(Integer, ForeignKey("maintenance_records.id", ondelete="CASCADE"), nullable=False)
    item_id = Column(Integer, ForeignKey("maintenance_items.id"), nullable=True)  # NULL = custom line

    custom_label = Column(String(120), nullable=True)  # only used when item_id is NULL
    price = Column(Float, nullable=False, default=0)
    checked = Column(Boolean, nullable=False, default=True)

    # The odometer/engine-hours reading AT WHICH this specific item was
    # serviced. Defaults to the parent record's odometer_km/engine_hours
    # but is independently editable per line — needed at baseline time,
    # where the user might remember "oil was actually changed 800km ago,
    # not today". This is the value due-date math is computed FROM (see
    # services/maintenance_service.py).
    service_odometer_km = Column(Float, nullable=True)
    service_engine_hours = Column(Float, nullable=True)

    created_at = Column(TIMESTAMP, server_default=func.now())


class MaintenanceDueSnapshot(Base):
    """One row per device per calendar day — a frozen snapshot of the due
    status computed that day (mirrors compute_item_status()'s live output,
    just persisted so the Maintenance Due Report can show a real history
    instead of only "right now"). Created once per day, idempotently, by
    services/maintenance_service.ensure_daily_snapshot() from the poll
    loop (see poller.py / maintenance_monitor.check_maintenance_due).
    """
    __tablename__ = "maintenance_due_snapshots"

    id = Column(Integer, primary_key=True)
    device_id = Column(Integer, ForeignKey("devices.id", ondelete="CASCADE"), nullable=False)

    snapshot_date = Column(Date, nullable=False)
    odometer_km = Column(Float, nullable=True)
    engine_hours = Column(Float, nullable=True)

    created_at = Column(TIMESTAMP, server_default=func.now())

    __table_args__ = (
        UniqueConstraint("device_id", "snapshot_date", name="uq_due_snapshot_device_date"),
    )


class MaintenanceDueSnapshotLine(Base):
    """Per-item due status within a MaintenanceDueSnapshot — one line per
    applicable catalog item, frozen at snapshot time. Same fields as
    compute_item_status()'s dict output."""
    __tablename__ = "maintenance_due_snapshot_lines"

    id = Column(Integer, primary_key=True)
    snapshot_id = Column(Integer, ForeignKey("maintenance_due_snapshots.id", ondelete="CASCADE"), nullable=False)
    item_id = Column(Integer, ForeignKey("maintenance_items.id"), nullable=False)

    dimension = Column(
        Enum("distance", "engine_hours", name="maintenance_dimension_enum"),
        nullable=False,
    )
    interval_value = Column(Float, nullable=False)
    last_service_value = Column(Float, nullable=True)
    current_value = Column(Float, nullable=True)
    progress_pct = Column(Float, nullable=True)
    status = Column(String(20), nullable=False)  # "ok" | "due_soon" | "overdue" | "no_baseline" | "unknown"

    created_at = Column(TIMESTAMP, server_default=func.now())