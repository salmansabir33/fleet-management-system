export const SA_ADMIN_FILTER_KEY = 'ft.saAdminFilter'
export const SA_ADMIN_FILTER_EVENT = 'ft-sa-admin-filter-changed'

try {
  if (localStorage.getItem(SA_ADMIN_FILTER_KEY) == null) {
    const fromSession = sessionStorage.getItem(SA_ADMIN_FILTER_KEY)
    if (fromSession != null) {
      localStorage.setItem(SA_ADMIN_FILTER_KEY, fromSession)
      sessionStorage.removeItem(SA_ADMIN_FILTER_KEY)
    }
  }
} catch {
  // ignore
}

export function readSaAdminFilter() {
  try {
    const raw = localStorage.getItem(SA_ADMIN_FILTER_KEY)
    if (raw == null || raw === '') return null
    const n = Number(raw)
    return Number.isFinite(n) ? n : null
  } catch {
    return null
  }
}

export function writeSaAdminFilter(adminId) {
  try {
    if (adminId == null || adminId === '') {
      localStorage.removeItem(SA_ADMIN_FILTER_KEY)
    } else {
      localStorage.setItem(SA_ADMIN_FILTER_KEY, String(adminId))
    }
    sessionStorage.removeItem(SA_ADMIN_FILTER_KEY)
  } catch {
    // ignore
  }
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(SA_ADMIN_FILTER_EVENT))
  }
}

export function saAdminFilterParams(role, actingAdminId) {
  if (role !== 'super_admin' || actingAdminId != null) return {}
  const filterId = readSaAdminFilter()
  if (filterId == null) return {}
  return { admin_id: filterId }
}
