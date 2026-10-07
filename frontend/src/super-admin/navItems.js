import { Shield, UserX, LogIn } from 'lucide-react'
import { buildAdminNav } from '../admin/navItems'
import { withBase } from '../shared/hooks/useBasePath'

const BASE = '/super-admin'

const adminNav = buildAdminNav(BASE)

const SUPER_EXTRA = [
  { to: withBase(BASE, '/admins'), label: 'Fleet admins', icon: Shield },
  { to: withBase(BASE, '/unassigned'), label: 'Unassigned', icon: UserX },
  { to: withBase(BASE, '/enter-fleet'), label: 'Enter fleet', icon: LogIn },
]

const insertAfterManagers = (items, extras) => {
  const idx = items.findIndex((item) => item.to?.endsWith('/managers'))
  if (idx < 0) return [...items, ...extras]
  return [...items.slice(0, idx + 1), ...extras, ...items.slice(idx + 1)]
}

export const SUPER_ADMIN_MAIN_NAV = insertAfterManagers(adminNav.MAIN_NAV, SUPER_EXTRA)

export const SUPER_ADMIN_MOBILE_PRIMARY_NAV = adminNav.MOBILE_PRIMARY_NAV

export const SUPER_ADMIN_MOBILE_MORE_NAV = [
  ...adminNav.MOBILE_MORE_NAV.slice(0, adminNav.MOBILE_MORE_NAV.findIndex(
    (item) => item.to.endsWith('/managers'),
  ) + 1),
  ...SUPER_EXTRA,
  ...adminNav.MOBILE_MORE_NAV.slice(
    adminNav.MOBILE_MORE_NAV.findIndex((item) => item.to.endsWith('/managers')) + 1,
  ),
]
