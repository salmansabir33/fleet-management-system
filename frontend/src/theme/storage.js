// Base localStorage key. Portal-scoped preference uses
// `fleettracker.theme.{portal}` so User / Admin / Manager stay independent.
export const THEME_STORAGE_KEY = 'fleettracker.theme'

export const detectPortal = (pathname) => {
  if (!pathname) return null
  if (pathname.startsWith('/admin')) return 'admin'
  if (pathname.startsWith('/manager')) return 'manager'
  if (pathname.startsWith('/user')) return 'user'
  return null
}

export const storageKeyFor = (portal) => (
  portal ? `${THEME_STORAGE_KEY}.${portal}` : THEME_STORAGE_KEY
)
