// Per-browser admin bell filter (no backend — there's no login yet).
// Key/shape is part of the Settings feature contract.

export const ADMIN_NOTIFICATION_PREFS_KEY = 'admin_notification_display_prefs'
export const ADMIN_NOTIFICATION_PREFS_EVENT = 'admin-notification-prefs-changed'

export const ALERT_TYPE_LABELS = {
  overspeed: 'Overspeeding',
  harsh_brake: 'Harsh Braking',
  harsh_accel: 'Harsh Acceleration',
  geofence_exit: 'Geofence Exit',
  route_deviation: 'Route Deviation',
  silence: 'Device Offline',
  driver_unassigned: 'Driver Not Assigned',
  trip_driver_pending_confirmation: 'Confirm Trip Driver',
  trip_route_pending_confirmation: 'Confirm Trip Route',
}

export const readNotificationDisplayPrefs = () => {
  try {
    const raw = localStorage.getItem(ADMIN_NOTIFICATION_PREFS_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

export const isAlertTypeDisplayed = (alertType, prefs = readNotificationDisplayPrefs()) => (
  prefs[alertType] !== false
)

export const writeNotificationDisplayPrefs = (prefs) => {
  localStorage.setItem(ADMIN_NOTIFICATION_PREFS_KEY, JSON.stringify(prefs))
  window.dispatchEvent(new Event(ADMIN_NOTIFICATION_PREFS_EVENT))
}

export const mergePrefsWithKnownTypes = (knownTypes) => {
  const stored = readNotificationDisplayPrefs()
  const merged = {}
  for (const type of knownTypes) {
    merged[type] = stored[type] !== false
  }
  return merged
}

export const setNotificationDisplayPref = (alertType, enabled) => {
  const stored = readNotificationDisplayPrefs()
  stored[alertType] = enabled
  writeNotificationDisplayPrefs(stored)
}
