const ACTING_ADMIN_ID_KEY = 'ft.actingAdminId'
const ACTING_ADMIN_LABEL_KEY = 'ft.actingAdminLabel'

const migrateFromSession = (key) => {
  try {
    if (localStorage.getItem(key) != null) return
    const fromSession = sessionStorage.getItem(key)
    if (fromSession == null) return
    localStorage.setItem(key, fromSession)
    sessionStorage.removeItem(key)
  } catch {
    // ignore
  }
}

migrateFromSession(ACTING_ADMIN_ID_KEY)
migrateFromSession(ACTING_ADMIN_LABEL_KEY)

export const readActingAdminId = () => {
  try {
    const raw = localStorage.getItem(ACTING_ADMIN_ID_KEY)
    if (raw == null || raw === '') return null
    const n = Number(raw)
    return Number.isFinite(n) ? n : null
  } catch {
    return null
  }
}

export const readActingAdminLabel = () => {
  try {
    return localStorage.getItem(ACTING_ADMIN_LABEL_KEY) || null
  } catch {
    return null
  }
}

export const writeActingAdmin = (adminId, label) => {
  try {
    if (adminId == null) {
      localStorage.removeItem(ACTING_ADMIN_ID_KEY)
      localStorage.removeItem(ACTING_ADMIN_LABEL_KEY)
      sessionStorage.removeItem(ACTING_ADMIN_ID_KEY)
      sessionStorage.removeItem(ACTING_ADMIN_LABEL_KEY)
      return
    }
    localStorage.setItem(ACTING_ADMIN_ID_KEY, String(adminId))
    if (label) localStorage.setItem(ACTING_ADMIN_LABEL_KEY, label)
    sessionStorage.removeItem(ACTING_ADMIN_ID_KEY)
    sessionStorage.removeItem(ACTING_ADMIN_LABEL_KEY)
  } catch {
    // ignore
  }
}

export const clearActingAdmin = () => writeActingAdmin(null, null)
