export const ACTING_ADMIN_CHANGED_EVENT = 'ft-acting-admin-changed'

export function dispatchActingAdminChanged() {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent(ACTING_ADMIN_CHANGED_EVENT))
}
