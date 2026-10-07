export const SA_ADMIN_FILTER_KEY = 'ft.saAdminFilter'
export const SA_ADMIN_FILTER_EVENT = 'ft-sa-admin-filter-changed'

export function readSaAdminFilter() {
  try {
    const raw = sessionStorage.getItem(SA_ADMIN_FILTER_KEY)
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
      sessionStorage.removeItem(SA_ADMIN_FILTER_KEY)
    } else {
      sessionStorage.setItem(SA_ADMIN_FILTER_KEY, String(adminId))
    }
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
