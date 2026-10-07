const ACTING_ADMIN_ID_KEY = 'ft.actingAdminId'
const ACTING_ADMIN_LABEL_KEY = 'ft.actingAdminLabel'

export const readActingAdminId = () => {
  try {
    const raw = sessionStorage.getItem(ACTING_ADMIN_ID_KEY)
    if (raw == null || raw === '') return null
    const n = Number(raw)
    return Number.isFinite(n) ? n : null
  } catch {
    return null
  }
}

export const readActingAdminLabel = () => {
  try {
    return sessionStorage.getItem(ACTING_ADMIN_LABEL_KEY) || null
  } catch {
    return null
  }
}

export const writeActingAdmin = (adminId, label) => {
  try {
    if (adminId == null) {
      sessionStorage.removeItem(ACTING_ADMIN_ID_KEY)
      sessionStorage.removeItem(ACTING_ADMIN_LABEL_KEY)
      return
    }
    sessionStorage.setItem(ACTING_ADMIN_ID_KEY, String(adminId))
    if (label) sessionStorage.setItem(ACTING_ADMIN_LABEL_KEY, label)
  } catch {
    // ignore
  }
}

export const clearActingAdmin = () => writeActingAdmin(null, null)
