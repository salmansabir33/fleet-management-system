import { ALERT_TYPE_LABELS } from '../../admin/utils/notificationDisplayPrefs'

export const MANAGER_PREFERENCES_EVENT = 'manager-preferences-changed'

const profileKey = (managerId) => `ft.manager.${managerId || 'unknown'}.profilePrefs`
const notificationKey = (managerId) => `ft.manager.${managerId || 'unknown'}.notificationPrefs`

const readObject = (key) => {
  try {
    const parsed = JSON.parse(localStorage.getItem(key) || '{}')
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

export const readManagerProfilePrefs = (managerId) => {
  const stored = readObject(profileKey(managerId))
  return {
    language: stored.language || 'en',
    timezone: stored.timezone || 'Asia/Karachi',
  }
}

export const readManagerNotificationPrefs = (managerId) => {
  const stored = readObject(notificationKey(managerId))
  return Object.fromEntries(
    Object.keys(ALERT_TYPE_LABELS).map((alertType) => [alertType, stored[alertType] !== false]),
  )
}

export const writeManagerProfilePrefs = (managerId, profile) => {
  localStorage.setItem(profileKey(managerId), JSON.stringify(profile))
}

export const writeManagerNotificationPrefs = (managerId, notifications) => {
  localStorage.setItem(notificationKey(managerId), JSON.stringify(notifications))
  window.dispatchEvent(new CustomEvent(MANAGER_PREFERENCES_EVENT, {
    detail: { managerId: String(managerId) },
  }))
}

export const writeManagerPreferences = (managerId, profile, notifications) => {
  writeManagerProfilePrefs(managerId, profile)
  writeManagerNotificationPrefs(managerId, notifications)
}
