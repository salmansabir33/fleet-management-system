// /api/live returns Traccar's raw position (speed_kmh, attributes.ignition)
// plus the raw Traccar device (status: 'online'|'offline'|'unknown') — it
// does NOT include the motion_status ('moving'|'idle'|'stopped') that only
// gets computed when a position is written to our own DB. Mirrors
// tracker_backend/services/position_writer.py::determine_motion_status so
// the two stay in agreement.
const SPEED_MOVING_THRESHOLD_KMH = 2

/**
 * item: one entry from /api/live's `live` array — { device, position, ... }
 * returns one of 'moving' | 'idle' | 'stopped' | 'offline'
 */
export function deriveVehicleStatus(item) {
  const device = item?.device
  const position = item?.position

  // Traccar keeps re-serving a device's last known position forever, even
  // long after it stops reporting — so speed_kmh/ignition on that stale
  // position must never be trusted once Traccar itself no longer considers
  // the device live. 'unknown' is just as untrustworthy as 'offline' here
  // (it means Traccar can't currently vouch for this device's state either)
  // — but a device Traccar calls 'online' IS trusted even if its last fix
  // is old, since some trackers (e.g. mobile-app clients) legitimately stay
  // connected/online without pushing frequent position updates while
  // stationary. Don't second-guess Traccar's own status with a fixed time
  // threshold — that's what broke "mobile" showing offline while Traccar
  // had it online.
  if (!device || device.status === 'offline' || device.status === 'unknown' || !position) {
    return 'offline'
  }

  const speedKmh = position.speed_kmh || 0
  const ignition = position.attributes?.ignition

  if (speedKmh > SPEED_MOVING_THRESHOLD_KMH) return 'moving'
  if (ignition) return 'idle'
  return 'stopped'
}

/** Connected to Traccar — includes moving, idle, and parked (ignition off). */
export function isVehicleOnline(status) {
  return status != null && status !== 'offline'
}

/**
 * Filter keys:
 * - 'all' — every vehicle
 * - 'online' — any connected vehicle (moving, idle, or parked)
 * - 'moving' | 'idle' | 'stopped' | 'offline' — exact motion status
 */
export function matchesVehicleStatusFilter(status, filter) {
  if (!filter || filter === 'all') return true
  if (filter === 'online') return isVehicleOnline(status)
  return status === filter
}

export const VEHICLE_STATUS_FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'online', label: 'Online' },
  { key: 'moving', label: 'Moving' },
  { key: 'idle', label: 'Idle' },
  { key: 'stopped', label: 'Parked' },
  { key: 'offline', label: 'Offline' },
]

export const MOTION_STATUS_LABELS = {
  moving: 'Moving',
  idle: 'Idle',
  stopped: 'Parked',
  offline: 'Offline',
}

export function motionStatusLabel(status) {
  return MOTION_STATUS_LABELS[status] || status || 'Unknown'
}

/** e.g. "Online · Parked" when connected with ignition off. */
export function formatVehiclePresenceLabel(status) {
  if (!isVehicleOnline(status)) return 'Offline'
  return `Online · ${motionStatusLabel(status)}`
}

export function tallyVehicleStatusCounts(statuses) {
  const counts = {
    all: 0,
    online: 0,
    moving: 0,
    idle: 0,
    stopped: 0,
    offline: 0,
  }
  for (const status of statuses) {
    counts.all += 1
    if (Object.prototype.hasOwnProperty.call(counts, status)) counts[status] += 1
    if (isVehicleOnline(status)) counts.online += 1
  }
  return counts
}