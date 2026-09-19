# Project Context & Architecture Report — Traccar Backend (Fleet Management System)

---

## 1. EXECUTIVE OVERVIEW

### Project Name & Primary Purpose
- **Project Name:** `backend` (internal package: `tracker_backend`)
- **Repository:** `https://github.com/abdulhannan709/BEGPS.git`
- **Primary Purpose:** A FastAPI-based backend service that acts as a wrapper/proxy around a Traccar GPS tracking server. It polls Traccar for real-time device positions every 5 seconds, caches them in-memory for instant API responses, persists position history to a MySQL database, detects GPS anomalies (teleports/signal-loss), and runs an anti-theft silence monitor for mobile devices.

### Tech Stack

| Category | Technology | Version Constraint |
|---|---|---|
| **Language** | Python | >=3.12 |
| **Web Framework** | FastAPI | >=0.139.2, <0.140.0 |
| **ASGI Server** | Uvicorn | >=0.51.0, <0.52.0 |
| **ORM** | SQLAlchemy | >=2.0.51, <3.0.0 |
| **Database Engine** | MySQL | (via PyMySQL driver) |
| **DB Driver** | PyMySQL | >=1.2.0, <2.0.0 |
| **HTTP Client** | httpx | >=0.28.1, <0.29.0 |
| **Settings Management** | pydantic-settings | >=2.14.2, <3.0.0 |
| **Env Var Loading** | python-dotenv | >=1.2.2, <2.0.0 |
| **Task Scheduling** | APScheduler | >=3.11.3, <4.0.0 *(listed as dependency but NOT used in code; polling implemented via `asyncio.sleep` loop)* |
| **Database Migrations** | Alembic | >=1.18.5, <2.0.0 |
| **Package Manager** | Poetry | poetry-core >=2.0.0 |
| **Timezone Handling** | zoneinfo (stdlib) | Python 3.12 stdlib |

### High-Level Architecture Pattern
- **Pattern:** Client-Server with Background Polling, In-Memory Cache, and Database Persistence
- **Architecture Flow:**
  1. A **background poller** (`poller.py`) runs an `asyncio` loop every 5 seconds.
  2. It fetches devices and positions from the **Traccar REST API** (`traccar.py` service).
  3. It updates an **in-memory cache** (`cache.py`) for instant API reads.
  4. It persists new positions to **MySQL** (`position_writer.py`) with deduplication and anomaly detection.
  5. It runs an **anti-theft silence check** (`security_monitor.py`) for mobile devices.
  6. **FastAPI endpoints** (`main.py`) serve cached data to the frontend instantly, and proxy historical route queries directly to Traccar.
- **Key Design Principle:** Decouple "how often we bother Traccar" (5s poll interval) from "how fast the API responds" (instant cache reads). Only the poller talks to Traccar; all API endpoints read from cache.

---

## 2. DIRECTORY STRUCTURE & FILE MAP

```
backend/
├── .env.example                    # Template for required environment variables
├── .gitignore                      # Ignores .venv/, __pycache__/, *.pyc, .env, .vscode/, *.log
├── alembic.ini                     # Alembic migration configuration (contains hardcoded DB URL)
├── poetry.lock                     # Poetry lock file for reproducible builds
├── pyproject.toml                  # Project metadata and dependencies (Poetry)
├── README.md                       # Setup instructions
├── test_login.py                   # Manual test script for Traccar connection/login
├── PROJECT_CONTEXT_REPORT.md       # This report
│
├── alembic/                        # Database migration configuration
│   ├── README                      # "Generic single-database configuration."
│   ├── env.py                      # Alembic environment script (imports Base + models)
│   ├── script.py.mako              # Migration file template
│   └── versions/                   # Migration scripts (6 revisions)
│       ├── 05f1d863ec15_create_devices_and_device_positions_.py
│       ├── f0e6640c840a_replace_is_moving_boolean_with_motion_.py
│       ├── d632a52476db_replace_is_moving_boolean_with_motion_.py
│       ├── 1a735ebc86cb_add_last_seen_at_to_devices_and_device_.py
│       ├── 7d73ca9ce284_add_last_seen_at_device_type_is_gps_.py
│       └── 93f3575614b4_make_device_alerts_timestamps_utc_based_.py
│
├── tests/                          # Test suite
│   ├── __init__.py                 # Empty
│   └── test_gps_anomaly.py         # Manual test for GPS anomaly detection logic
│
└── tracker_backend/                # Main application package
    ├── __init__.py                 # Empty
    ├── config.py                   # Pydantic Settings (env var loading)
    ├── db.py                       # SQLAlchemy engine, session, and Base
    ├── main.py                     # FastAPI app, endpoints, lifespan, CORS
    ├── models.py                   # SQLAlchemy ORM models (Device, DevicePosition, DeviceAlert)
    ├── poller.py                   # Background polling loop (5s interval)
    │
    ├── services/                   # Business logic services
    │   ├── __init__.py             # Empty
    │   ├── traccar.py              # Async HTTP client for Traccar REST API
    │   ├── cache.py                # In-memory cache for devices/positions
    │   ├── position_writer.py      # Persists positions to MySQL with anomaly detection
    │   └── security_monitor.py     # Anti-theft silence detection for mobile devices
    │
    └── utils/                      # Utility modules
        └── time_utils.py           # UTC to Pakistan timezone conversion helpers
```

### Top-Level Directory Descriptions

| Directory | Purpose |
|---|---|
| `alembic/` | Database migration scripts and Alembic configuration. Contains 6 migration revisions defining the schema evolution. |
| `tests/` | Test suite. Contains a manual integration test for GPS anomaly detection. |
| `tracker_backend/` | Main application package. Contains the FastAPI app, ORM models, database setup, background poller, and all service modules. |
| `tracker_backend/services/` | Core business logic services: Traccar API client, in-memory cache, position persistence, and security monitoring. |
| `tracker_backend/utils/` | Utility functions (timezone conversion). |

---

## 3. ENVIRONMENT & CONFIGURATION

### Environment Variables

The application uses `pydantic-settings` (`BaseSettings`) to load environment variables from a `.env` file. All variables are **required** (no defaults provided in the `Settings` class).

| Variable Name | Purpose | Source |
|---|---|---|
| `TRACCAR_URL` | Base URL of the Traccar GPS server (e.g., `https://your-traccar-server.com`) | `.env.example` |
| `TRACCAR_EMAIL` | Email used for Traccar HTTP Basic Auth | `.env.example` |
| `TRACCAR_PASSWORD` | Password used for Traccar HTTP Basic Auth | `.env.example` |
| `FRONTEND_URL` | URL of the frontend application (used for CORS `allow_origins`) | `.env.example` |
| `DB_USER` | MySQL database username | `config.py` (not in `.env.example`) |
| `DB_PASSWORD` | MySQL database password | `config.py` (not in `.env.example`) |
| `DB_HOST` | MySQL database host | `config.py` (not in `.env.example`) |
| `DB_PORT` | MySQL database port (integer) | `config.py` (not in `.env.example`) |
| `DB_NAME` | MySQL database name | `config.py` (not in `.env.example`) |

**Note:** The `.env.example` file only documents 4 of the 9 required variables. The remaining 5 (`DB_USER`, `DB_PASSWORD`, `DB_HOST`, `DB_PORT`, `DB_NAME`) are defined in `config.py` but missing from `.env.example`.

### Configuration Files

#### `config.py` — Pydantic Settings
```python
class Settings(BaseSettings):
    TRACCAR_URL: str
    TRACCAR_EMAIL: str
    TRACCAR_PASSWORD: str
    FRONTEND_URL: str
    DB_USER: str
    DB_PASSWORD: str
    DB_HOST: str
    DB_PORT: int
    DB_NAME: str

    class Config:
        env_file = ".env"

settings = Settings()  # Single instance used everywhere
```

#### `alembic.ini` — Migration Configuration
- **Script location:** `%(here)s/alembic`
- **Database URL (placeholder):** `driver://user:pass@localhost/dbname`
  - **Note:** `alembic/env.py` overrides this placeholder with the URL built from environment variables (`DB_USER`, `DB_PASSWORD`, `DB_HOST`, `DB_PORT`, `DB_NAME`), consistent with `db.py`.
- **Database name:** `fleet_tracker`

#### `db.py` — Database Connection
```python
DATABASE_URL = (
    f"mysql+pymysql://{settings.DB_USER}:{settings.DB_PASSWORD}"
    f"@{settings.DB_HOST}:{settings.DB_PORT}/{settings.DB_NAME}"
)
engine = create_engine(DATABASE_URL, pool_pre_ping=True)
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)
Base = declarative_base()
```
- `pool_pre_ping=True` enables connection health checks before use (prevents stale connection errors).

### Build/Deployment Setup

#### Package Management: Poetry
- **Build system:** `poetry-core>=2.0.0,<3.0.0`
- **Install dependencies:** `poetry install --no-root`
- **Run the server:** `poetry run uvicorn tracker_backend.main:app --reload`

#### Database Migrations: Alembic
- Migration chain (revision order):
  ```
  05f1d863ec15 (initial: create devices + device_positions)
    → f0e6640c840a (replace is_moving boolean with motion_status enum)
    → d632a52476db (add is_gps_anomaly column)
    → 1a735ebc86cb (add device_alerts table + last_seen_at to devices)
    → 7d73ca9ce284 (add device_type to devices)
    → 93f3575614b4 (change device_alerts.triggered_at from TIMESTAMP to DateTime)
  ```
- **Run migrations:** `alembic upgrade head` (from the `backend/` directory)

#### VS Code Configuration (`.vscode/settings.json`)
```json
{
    "python-envs.defaultEnvManager": "ms-python.python:poetry",
    "python-envs.defaultPackageManager": "ms-python.python:poetry",
    "python.analysis.extraPaths": ["."]
}
```

#### Dockerfile / Docker Compose
- **[DATA NOT FOUND]** — No Dockerfile or docker-compose.yml present in the workspace.

---

## 4. DATABASE SCHEMA & MODELS

The database is MySQL (`fleet_tracker`), accessed via SQLAlchemy 2.0 ORM with PyMySQL driver. Three tables exist.

### 4.1 Table: `devices`

| Property | Value |
|---|---|
| **Model Class** | `Device` |
| **File Location** | `tracker_backend/models.py` (lines 10-24) |
| **Primary Key** | `id` (Integer) |

#### Schema Definition

| Column Name | Data Type | Nullable | Default | Constraints |
|---|---|---|---|---|
| `id` | Integer | NO | — | **Primary Key** |
| `traccar_device_id` | Integer | NO | — | **Unique** |
| `name` | String(120) | NO | — | — |
| `last_seen_at` | DateTime | YES | — | Updated every poll from device's `fixTime` (not poll time) |
| `device_type` | String(20) | YES | — | `"mobile"` or `"hardware"` (auto-classified from protocol) |
| `created_at` | TIMESTAMP | YES | `now()` | Server-side default |

#### Relationships
- **One-to-many** with `device_positions` (via `device_positions.device_id` → `devices.id`, `ON DELETE CASCADE`)
- **One-to-many** with `device_alerts` (via `device_alerts.device_id` → `devices.id`, `ON DELETE CASCADE`)

#### Hooks/Triggers
- **[DATA NOT FOUND]** — No SQLAlchemy event hooks (e.g., `before_insert`, `after_update`) defined on this model. The `last_seen_at` and `device_type` fields are updated programmatically in `position_writer.py` during the poll cycle.

---

### 4.2 Table: `device_positions`

| Property | Value |
|---|---|
| **Model Class** | `DevicePosition` |
| **File Location** | `tracker_backend/models.py` (lines 27-63) |
| **Primary Key** | `id` (Integer) |

#### Schema Definition

| Column Name | Data Type | Nullable | Default | Constraints |
|---|---|---|---|---|
| `id` | Integer | NO | — | **Primary Key** |
| `device_id` | Integer | NO | — | **Foreign Key** → `devices.id`, `ON DELETE CASCADE` |
| `lat` | Float | NO | — | — |
| `lon` | Float | NO | — | — |
| `altitude` | Float | YES | — | — |
| `speed_kmh` | Float | YES | — | — |
| `course` | Float | YES | — | — |
| `accuracy` | Float | YES | — | — |
| `protocol` | String(30) | YES | — | — |
| `address` | String(255) | YES | — | — |
| `ignition` | Boolean | YES | — | — |
| `motion` | Boolean | YES | — | — |
| `battery_level` | Integer | YES | — | — |
| `distance` | Float | YES | — | — |
| `total_distance` | Float | YES | — | — |
| `geofence_ids` | JSON | YES | — | — |
| `motion_status` | Enum('moving', 'idle', 'stopped') | NO | `'stopped'` | Enum name: `motion_status_enum` |
| `is_gps_anomaly` | Boolean | NO | `False` | — |
| `raw_attributes` | JSON | YES | — | Stores all raw Traccar attributes untouched |
| `fix_time` | DateTime | NO | — | Device's own GPS fix time (UTC, naive) |
| `created_at` | TIMESTAMP | YES | `now()` | Server-side default |

#### Relationships
- **Many-to-one** with `devices` (via `device_id` foreign key)

#### Hooks/Triggers
- **[DATA NOT FOUND]** — No SQLAlchemy event hooks defined. All logic (anomaly detection, motion status, deduplication) is handled in `position_writer.py` before the `db.add()` call.

#### Schema Evolution (Migration History)
1. **Initial creation** (`05f1d863ec15`): Created with `is_moving` Boolean column instead of `motion_status`.
2. **`f0e6640c840a`**: Dropped `is_moving`, added `motion_status` Enum('moving', 'idle', 'stopped').
3. **`d632a52476db`**: Added `is_gps_anomaly` Boolean column.

---

### 4.3 Table: `device_alerts`

| Property | Value |
|---|---|
| **Model Class** | `DeviceAlert` |
| **File Location** | `tracker_backend/models.py` (lines 66-78) |
| **Primary Key** | `id` (Integer) |

#### Schema Definition

| Column Name | Data Type | Nullable | Default | Constraints |
|---|---|---|---|---|
| `id` | Integer | NO | — | **Primary Key** |
| `device_id` | Integer | NO | — | **Foreign Key** → `devices.id`, `ON DELETE CASCADE` |
| `alert_type` | String(50) | NO | — | — |
| `message` | String(255) | YES | — | — |
| `is_resolved` | Boolean | NO | `False` | — |
| `triggered_at` | DateTime | YES | `datetime.now(timezone.utc).replace(tzinfo=None)` | Python-side default (UTC, naive) |
| `resolved_at` | DateTime | YES | — | Set when alert is resolved |

#### Relationships
- **Many-to-one** with `devices` (via `device_id` foreign key)

#### Hooks/Triggers
- **[DATA NOT FOUND]** — No SQLAlchemy event hooks defined. Alert creation and resolution are handled programmatically in `security_monitor.py`.

#### Schema Evolution (Migration History)
1. **`1a735ebc86cb`**: Table created with `triggered_at` as `TIMESTAMP` with `server_default=now()`.
2. **`93f3575614b4`**: `triggered_at` altered from `TIMESTAMP` to `DateTime` to use UTC-based Python timestamps instead of MySQL's local `NOW()`.

---

## 5. CORE BUSINESS LOGIC & SERVICES

### 5.1 `tracker_backend/services/traccar.py` — Traccar REST API Client

**File Location:** `tracker_backend/services/traccar.py`

**Class:** `TraccarService`
**Singleton Instance:** `traccar_service = TraccarService()`

**Design Notes:**
- Uses HTTP Basic Auth on every request (no session/cookie login dance).
- Reuses a single `httpx.AsyncClient` for connection pooling.
- Speed is always returned by Traccar in knots; converted to km/h via `KNOTS_TO_KMH = 1.852`.
- All raw Traccar attributes (ignition, motion, battery, power, adc1, in1-4, out1-4, alarm, etc.) are passed through untouched in the `attributes` field.

#### Exported Methods

| Method | Signature | Parameters | Description | Return Type |
|---|---|---|---|---|
| `__init__` | `__init__(self)` | None | Initializes `httpx.AsyncClient` with `base_url`, Basic Auth credentials, and 10s timeout. | None |
| `aclose` | `async aclose(self)` | None | Closes the pooled HTTP connection. Called on app shutdown. | `None` |
| `_with_speed_kmh` | `_with_speed_kmh(self, position: dict) -> dict` | `position`: A single Traccar position dict | Adds a `speed_kmh` field (rounded to 2 decimals) alongside Traccar's raw `speed` (knots). Does not overwrite the original `speed` field. | `dict` (modified position with `speed_kmh` added) |
| `get_devices` | `async get_devices(self) -> list` | None | Fetches all registered devices from Traccar's `/api/devices` endpoint. | `list` of device dicts |
| `get_positions` | `async get_positions(self) -> list` | None | Fetches current positions of all devices from `/api/positions`. Adds `speed_kmh` to each. | `list` of position dicts (with `speed_kmh`) |
| `get_device_positions` | `async get_device_positions(self, device_id: int) -> list` | `device_id`: Traccar device ID | Fetches current position of a specific device from `/api/positions?deviceId={id}`. Adds `speed_kmh`. | `list` of position dicts (with `speed_kmh`) |
| `get_route` | `async get_route(self, device_id: int, from_time: str, to_time: str) -> list` | `device_id`: Traccar device ID; `from_time`: ISO start time; `to_time`: ISO end time | Fetches historical route from `/api/reports/route`. Adds `speed_kmh` to each position. | `list` of position dicts (with `speed_kmh`) |

---

### 5.2 `tracker_backend/services/cache.py` — In-Memory Cache

**File Location:** `tracker_backend/services/cache.py`

**Class:** `TraccarCache`
**Singleton Instance:** `traccar_cache = TraccarCache()`

**Design Notes:**
- Plain Python in-memory cache (no database, no Redis).
- Holds the latest known state from Traccar.
- Serves last-good data even if a poll fails (does not blank out the cache on error).
- Intended as the "hot" layer; can be replaced by Redis if scaling beyond a single process.

#### Exported Methods

| Method | Signature | Parameters | Description | Return Type |
|---|---|---|---|---|
| `__init__` | `__init__(self)` | None | Initializes empty `devices` list, `positions` list, `last_updated=None`, `last_error=None`, `poll_count=0`. | None |
| `update` | `update(self, devices: list, positions: list)` | `devices`: list of device dicts; `positions`: list of position dicts | Replaces cached devices and positions, sets `last_updated` to current UTC time, clears `last_error`, increments `poll_count`. | `None` |
| `record_error` | `record_error(self, error: str)` | `error`: error message string | Records an error message without clearing the cache (keeps serving last-good data). | `None` |
| `merged_live_view` | `merged_live_view(self) -> list` | None | Combines device info + latest position into one object per device. Creates a dict mapping `deviceId` → position, then for each device appends `{"device": device, "position": position_or_None}`. | `list` of `{"device": dict, "position": dict|None}` |
| `status` | `status(self) -> dict` | None | Returns cache status: `last_updated` (ISO string or None), `last_error`, `poll_count`, `device_count`, `position_count`. | `dict` |

---

### 5.3 `tracker_backend/services/position_writer.py` — Position Persistence & Anomaly Detection

**File Location:** `tracker_backend/services/position_writer.py`

**Design Notes:**
- Called every poll cycle (5s) from `poller.py`.
- Only writes a new `DevicePosition` row when:
  1. Traccar reports a genuinely NEW `fix_time` (hard gate — prevents stale/duplicate rows for offline devices), AND
  2. The position actually moved (>25m), OR motion_status changed, OR heartbeat interval (5min) elapsed, OR a GPS anomaly was detected.
- GPS anomaly detection: calculates implied speed (distance/time); if >180 km/h, flags as anomaly.
- Anomaly handling: flagged points are saved but do NOT update the "last known good" reference (prevents cascading false anomalies).
- Uses in-memory `_last_saved` dict to avoid a DB read every 5s.

#### Module-Level Constants

| Constant | Value | Purpose |
|---|---|---|
| `MOVE_THRESHOLD_METERS` | `25` | Minimum distance (meters) to consider a position as "moved significantly" |
| `HEARTBEAT_INTERVAL` | `timedelta(minutes=5)` | Maximum time between position writes for a stationary device |
| `SPEED_MOVING_THRESHOLD_KMH` | `2` | Speed above which a device is considered "moving" |
| `MAX_PLAUSIBLE_SPEED_KMH` | `180` | Implied speed above which a position is flagged as a GPS anomaly |
| `MOBILE_PROTOCOLS` | `{"osmand", "tr20"}` | Traccar protocols indicating a mobile client app (vs. hardware tracker) |
| `_last_saved` | `dict[int, dict]` | In-memory cache of last saved position per device (resets on restart) |

#### Exported Functions

| Function | Signature | Parameters | Description | Return Type |
|---|---|---|---|---|
| `haversine_meters` | `haversine_meters(lat1, lon1, lat2, lon2)` | `lat1`, `lon1`: first point coords; `lat2`, `lon2`: second point coords | Calculates the great-circle distance in meters between two lat/lon points using the Haversine formula (Earth radius = 6,371,000m). | `float` (meters) |
| `determine_motion_status` | `determine_motion_status(speed_kmh: float, ignition: bool \| None) -> str` | `speed_kmh`: speed in km/h; `ignition`: ignition state (bool or None) | Classifies motion: `"moving"` if speed >2 km/h; `"idle"` if ignition on but not moving; `"stopped"` if ignition off and not moving. | `str` (`"moving"`, `"idle"`, or `"stopped"`) |
| `_get_or_create_device` | `_get_or_create_device(db, devices_by_id, traccar_device_id)` | `db`: SQLAlchemy session; `devices_by_id`: dict mapping Traccar IDs to device dicts; `traccar_device_id`: Traccar's device ID | Queries for a `Device` by `traccar_device_id`; if not found, creates a new one with the name from the Traccar device dict (or fallback `"Device {id}"`). Flushes to get the DB-assigned `id`. | `Device` (SQLAlchemy model instance) |
| `save_positions` | `save_positions(devices: list, positions: list)` | `devices`: list of Traccar device dicts; `positions`: list of Traccar position dicts | **Main persistence function.** For each device, ensures it exists in the DB. For each position: parses `fixTime` to UTC, determines `motion_status`, updates `device.last_seen_at` and `device.device_type`, then checks the hard gate (same `fix_time` → skip). If new, checks movement/status/heartbeat/anomaly conditions to decide whether to insert. Commits all changes. | `None` |

#### `save_positions` Logic Flow (Detailed)
1. Build `devices_by_id` dict from the devices list.
2. Open a DB session.
3. Ensure every device exists in the `devices` table (get-or-create).
4. For each position:
   - Parse `fixTime` (ISO format with `Z` suffix) to naive UTC datetime.
   - Extract `speed_kmh`, `ignition` from attributes.
   - Determine `motion_status`.
   - Get or create the `Device` row.
   - Unconditionally update `device.last_seen_at = fix_time` (anti-theft signal).
   - Auto-classify `device.device_type` from protocol (`"mobile"` if in `MOBILE_PROTOCOLS`, else `"hardware"`).
   - **Hard gate:** If `fix_time` == last saved `fix_time` for this device → `continue` (skip, stale data).
   - If last saved exists: calculate `distance_m` (Haversine), `hours_elapsed`, `implied_speed_kmh`.
   - Flag `is_gps_anomaly = True` if `implied_speed_kmh > 180`.
   - Determine `should_insert` = moved_significantly OR status_changed OR heartbeat_due OR is_gps_anomaly.
   - If `should_insert`: add new `DevicePosition` row.
   - If NOT `is_gps_anomaly`: update `_last_saved` reference (so a glitch doesn't cascade).
5. Commit and close session.

---

### 5.4 `tracker_backend/services/security_monitor.py` — Anti-Theft Silence Monitor

**File Location:** `tracker_backend/services/security_monitor.py`

**Design Notes:**
- Flags mobile devices that were reporting normally but have gone silent longer than `SILENCE_THRESHOLD`.
- Hardware GT06 trackers are excluded (they legitimately lose signal more often).
- All timestamps are UTC (`datetime.utcnow()`), consistent with `last_seen_at`.
- Called every poll cycle from `poller.py`, right after `save_positions()`.

#### Module-Level Constants

| Constant | Value | Purpose |
|---|---|---|
| `SILENCE_THRESHOLD` | `timedelta(minutes=2)` | Time without a position report before triggering a silence alert (lowered from 5 to 2 for testing) |

#### Exported Functions

| Function | Signature | Parameters | Description | Return Type |
|---|---|---|---|---|
| `check_device_silence` | `check_device_silence()` | None | Queries all `Device` rows where `last_seen_at` is not None AND `device_type == "mobile"`. For each, calculates `silent_for = now - last_seen_at`. If `silent_for > SILENCE_THRESHOLD` and no open `"silence"` alert exists, creates a new `DeviceAlert` with a descriptive message. If the device is reporting again and an open alert exists, resolves it (`is_resolved=True`, `resolved_at=now`). | `None` |

---

### 5.5 `tracker_backend/poller.py` — Background Polling Loop

**File Location:** `tracker_backend/poller.py`

**Design Notes:**
- Decouples "how often we bother Traccar" (5s) from "how fast the API responds" (instant cache reads).
- Runs DB operations via `asyncio.to_thread()` to avoid blocking the event loop.
- Catches exceptions in the loop (logs error, records to cache, continues).

#### Module-Level Constants

| Constant | Value | Purpose |
|---|---|---|
| `POLL_INTERVAL_SECONDS` | `5` | Seconds between poll cycles |

#### Exported Functions

| Function | Signature | Parameters | Description | Return Type |
|---|---|---|---|---|
| `poll_once` | `async poll_once()` | None | Fetches devices and positions from Traccar, updates the in-memory cache, then runs `position_writer.save_positions()` and `security_monitor.check_device_silence()` in a background thread (via `asyncio.to_thread`). | `None` |
| `poll_loop` | `async poll_loop()` | None | Runs forever: calls `poll_once()`, logs success/failure, sleeps `POLL_INTERVAL_SECONDS`, repeats. Catches exceptions, logs them, and records errors to cache without crashing. | `None` |

---

### 5.6 `tracker_backend/utils/time_utils.py` — Timezone Conversion Helper

**File Location:** `tracker_backend/utils/time_utils.py`

**Design Notes:**
- All DB timestamps are stored in UTC. This module converts to Pakistan time (Asia/Karachi, UTC+5) ONLY for display purposes.
- Never stores the converted value back to the DB.

#### Module-Level Constants

| Constant | Value | Purpose |
|---|---|---|
| `PAKISTAN_TZ` | `ZoneInfo("Asia/Karachi")` | Pakistan timezone object |

#### Exported Functions

| Function | Signature | Parameters | Description | Return Type |
|---|---|---|---|---|
| `to_pakistan_time` | `to_pakistan_time(utc_dt: datetime \| None) -> datetime \| None` | `utc_dt`: a datetime object (naive or aware UTC) or None | Converts a naive-UTC datetime to a timezone-aware Pakistan-time datetime. If the datetime has no `tzinfo`, assumes UTC. Returns `None` if input is `None`. | `datetime \| None` |
| `format_pakistan_time` | `format_pakistan_time(utc_dt: datetime \| None, fmt: str = "%Y-%m-%d %I:%M %p") -> str` | `utc_dt`: datetime or None; `fmt`: strftime format string | Converts UTC datetime to Pakistan time and formats it as a string. Returns `"—"` if input is `None`. | `str` |

---

## 6. API ENDPOINTS / ROUTES

All endpoints are defined in `tracker_backend/main.py`. The FastAPI app is titled `"Tracker API"` (version `2.0.0`).

### Authentication/Authorization
- **[DATA NOT FOUND]** — No authentication or authorization middleware is implemented on the FastAPI endpoints. The API is open/unauthenticated. The only auth in the system is HTTP Basic Auth used by `TraccarService` to communicate with the external Traccar server.

### CORS Configuration
```python
app.add_middleware(
    CORSMiddleware,
    allow_origins=[settings.FRONTEND_URL],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
```
- Only the `FRONTEND_URL` origin is allowed.

### Application Lifespan
- On startup: runs `poll_once()` immediately (synchronous), then starts `poll_loop()` as a background `asyncio.Task`.
- On shutdown: cancels the background task and calls `traccar_service.aclose()`.

---

### 6.1 Health Check

| Property | Value |
|---|---|
| **HTTP Method** | `GET` |
| **Path** | `/` |
| **Handler** | `root()` in `main.py` (line 57) |
| **Parameters** | None |
| **Auth** | None |
| **Response** | `{"status": "running", "message": "Tracker API is working"}` |

---

### 6.2 Cache Status

| Property | Value |
|---|---|
| **HTTP Method** | `GET` |
| **Path** | `/api/cache/status` |
| **Handler** | `cache_status()` in `main.py` (line 65) |
| **Parameters** | None |
| **Auth** | None |
| **Response** | `{"last_updated": str|null, "last_error": str|null, "poll_count": int, "device_count": int, "position_count": int}` |

---

### 6.3 Get All Devices

| Property | Value |
|---|---|
| **HTTP Method** | `GET` |
| **Path** | `/api/devices` |
| **Handler** | `get_devices()` in `main.py` (line 75) |
| **Parameters** | None |
| **Auth** | None |
| **Response** | `{"success": true, "count": int, "cache_status": {...}, "devices": [...]}` — All registered devices, raw from Traccar (cached, refreshed every 5s). |

---

### 6.4 Get All Positions

| Property | Value |
|---|---|
| **HTTP Method** | `GET` |
| **Path** | `/api/positions` |
| **Handler** | `get_positions()` in `main.py` (line 90) |
| **Parameters** | None |
| **Auth** | None |
| **Response** | `{"success": true, "count": int, "cache_status": {...}, "positions": [...]}` — Current positions of all devices, raw from Traccar. Each position includes all attributes (ignition, motion, battery, adc1, alarm, etc.) untouched in the `attributes` field, plus a `speed_kmh` field. |

---

### 6.5 Get Position by Device ID

| Property | Value |
|---|---|
| **HTTP Method** | `GET` |
| **Path** | `/api/positions/{device_id}` |
| **Handler** | `get_device_position(device_id: int)` in `main.py` (line 103) |
| **Parameters** | `device_id` (path param, integer) — Traccar device ID |
| **Auth** | None |
| **Response** | `{"success": true, "device_id": int, "position": {...}}` — Position of a specific device from cache. Returns `404` if no cached position exists for the given `device_id`. |

---

### 6.6 Get Live View (All Devices)

| Property | Value |
|---|---|
| **HTTP Method** | `GET` |
| **Path** | `/api/live` |
| **Handler** | `get_live()` in `main.py` (line 123) |
| **Parameters** | None |
| **Auth** | None |
| **Response** | `{"success": true, "count": int, "cache_status": {...}, "live": [{"device": {...}, "position": {...}|null}, ...]}` — Every device merged with its latest position in one object. |

---

### 6.7 Get Live View by Device ID

| Property | Value |
|---|---|
| **HTTP Method** | `GET` |
| **Path** | `/api/live/{device_id}` |
| **Handler** | `get_live_device(device_id: int)` in `main.py` (line 135) |
| **Parameters** | `device_id` (path param, integer) — Traccar device ID |
| **Auth** | None |
| **Response** | `{"success": true, "live": {"device": {...}, "position": {...}|null}}` — Single device + its latest position merged. Returns `404` if no device with the given ID. |

---

### 6.8 Get Route History

| Property | Value |
|---|---|
| **HTTP Method** | `GET` |
| **Path** | `/api/route/{device_id}` |
| **Handler** | `get_route(device_id: int, from_time: str, to_time: str)` in `main.py` (line 151) |
| **Parameters** | `device_id` (path param, integer); `from_time` (query param, ISO format string, e.g., `2024-01-15T00:00:00Z`); `to_time` (query param, ISO format string) |
| **Auth** | None |
| **Response** | `{"success": true, "device_id": int, "count": int, "route": [...]}` — Historical route for a device, fetched on-demand directly from Traccar (not cached). Returns `500` on error. |

**Example:** `/api/route/1?from_time=2024-01-15T00:00:00Z&to_time=2024-01-15T23:59:59Z`

---

## 7. FRONTEND ARCHITECTURE

- **[DATA NOT FOUND]** — No frontend code exists in this workspace. The `c:\projects\traccar` directory contains only the `backend/` folder.
- The `.env.example` file defines `FRONTEND_URL=http://localhost:3000`, suggesting a separate frontend application running on port 3000 (common for React/Next.js development servers), but the frontend codebase is not included in this workspace.
- The backend's CORS configuration allows only the `FRONTEND_URL` origin to make requests.
- **State Management:** [DATA NOT FOUND]
- **Routing Structure:** [DATA NOT FOUND]
- **Key UI Components:** [DATA NOT FOUND]

---

## 8. THIRD-PARTY INTEGRATIONS & WEBHOOKS

### External API: Traccar GPS Tracking Server

| Property | Value |
|---|---|
| **API Base URL** | `settings.TRACCAR_URL` (from `.env`) |
| **Authentication** | HTTP Basic Auth (`settings.TRACCAR_EMAIL`, `settings.TRACCAR_PASSWORD`) |
| **HTTP Client** | `httpx.AsyncClient` (connection pooling, 10s timeout) |
| **Service File** | `tracker_backend/services/traccar.py` |

#### Traccar Endpoints Used

| Traccar Endpoint | Method | Purpose | Called By |
|---|---|---|---|
| `/api/devices` | GET | Fetch all registered devices | `traccar_service.get_devices()` |
| `/api/positions` | GET | Fetch current positions of all devices | `traccar_service.get_positions()` |
| `/api/positions?deviceId={id}` | GET | Fetch current position of a specific device | `traccar_service.get_device_positions()` |
| `/api/reports/route?deviceId={id}&from={time}&to={time}` | GET | Fetch historical route for a device | `traccar_service.get_route()` |

#### Speed Conversion
- Traccar always returns speed in **knots** (normalized by protocol decoders).
- The backend converts to km/h: `speed_kmh = round(speed * 1.852, 2)`.
- The original `speed` field is preserved untouched.

### Real-Time Data Ingestion (GPS Pings)

- **No webhooks are used.** The backend does not receive push notifications from Traccar.
- Instead, it uses a **pull-based polling model**: the background `poll_loop()` in `poller.py` fetches the latest positions from Traccar's `/api/positions` endpoint every 5 seconds.
- Traccar itself handles the ingestion of GPS pings from hardware trackers and mobile apps via its own protocol decoders (GT06, OsmAnd, etc.). This backend simply reads the normalized data from Traccar's REST API.

### Other External Integrations
- **Google Maps API:** [DATA NOT FOUND]
- **Stripe:** [DATA NOT FOUND]
- **Twilio:** [DATA NOT FOUND]
- **Message Queues (RabbitMQ, Kafka, etc.):** [DATA NOT FOUND]
- **Caching (Redis, Memcached):** [DATA NOT FOUND] — Uses plain Python in-memory cache only.

---

## 9. EXECUTION COMMAND

### Setup & Run

```bash
# 1. Copy environment template and fill in credentials
cp .env.example .env
# Edit .env with: TRACCAR_URL, TRACCAR_EMAIL, TRACCAR_PASSWORD, FRONTEND_URL,
#                  DB_USER, DB_PASSWORD, DB_HOST, DB_PORT, DB_NAME

# 2. Install dependencies (Poetry)
poetry install --no-root

# 3. Run database migrations (Alembic)
alembic upgrade head

# 4. Start the development server
poetry run uvicorn tracker_backend.main:app --reload
```

### Manual Tests

```bash
# Test Traccar connection and login (uses session/cookie auth — legacy)
python test_login.py

# Test GPS anomaly detection (requires running MySQL database)
python -m tests.test_gps_anomaly
```

### API Server
- **Default URL:** `http://localhost:8000`
- **Interactive Docs (Swagger UI):** `http://localhost:8000/docs`
- **ReDoc:** `http://localhost:8000/redoc`

---

*Report generated from exhaustive analysis of all files in the `c:\projects\traccar\backend` workspace.*