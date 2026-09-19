// Thin path helper for manager-scoped API calls. Keeps pages from
// hardcoding `/api/manager/${managerId}/...` everywhere — same idea as
// SelectedDeviceContext scoping device fetches, just for URL prefixing.
export const managerApiBase = (managerId) => `/api/manager/${managerId}`

export const managerPath = (managerId, suffix = '') => {
  const base = managerApiBase(managerId)
  if (!suffix) return base
  return suffix.startsWith('/') ? `${base}${suffix}` : `${base}/${suffix}`
}
