import {
  LayoutDashboard, Car, Bell, Users, Route as RouteIcon,
  MapPin, UserCog, Settings, Contact, History,
  PlayCircle, Map, Wrench,
} from 'lucide-react'
import { withBase } from '../shared/hooks/useBasePath'

const MAIN_DEFS = [
  { path: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { path: '/vehicles', label: 'Vehicles', icon: Car },
  { path: '/notifications', label: 'Notifications', icon: Bell },
  { path: '/users', label: 'Users', icon: Users },
  { path: '/drivers', label: 'Drivers', icon: Contact },
  { path: '/trips', label: 'Trips', icon: History },
  { path: '/playback', label: 'Live Playback', icon: PlayCircle },
  { path: '/routes', label: 'Routes', icon: RouteIcon },
  { path: '/geofences', label: 'Geofences', icon: MapPin },
  { path: '/maintenance', label: 'Maintenance', kind: 'maintenance' },
  { path: '/managers', label: 'Managers', icon: UserCog },
  { path: '/settings', label: 'Settings', icon: Settings },
]

const MOBILE_PRIMARY_DEFS = [
  { path: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { path: '/vehicles', label: 'Vehicles', icon: Car },
  { path: '/trips', label: 'Trips', icon: History },
  { path: '/drivers', label: 'Drivers', icon: Contact },
  { path: '/map', label: 'Map', icon: Map },
]

const MOBILE_MORE_DEFS = [
  { path: '/notifications', label: 'Notifications', icon: Bell },
  { path: '/users', label: 'Users', icon: Users },
  { path: '/playback', label: 'Live Playback', icon: PlayCircle },
  { path: '/routes', label: 'Routes', icon: RouteIcon },
  { path: '/geofences', label: 'Geofences', icon: MapPin },
  { path: '/maintenance', label: 'Maintenance', icon: Wrench },
  { path: '/managers', label: 'Managers', icon: UserCog },
  { path: '/settings', label: 'Settings', icon: Settings },
]

const mapDefs = (basePath, defs) => defs.map((item) => ({
  ...item,
  to: withBase(basePath, item.path),
}))

export function buildAdminNav(basePath) {
  const MAIN_NAV = mapDefs(basePath, MAIN_DEFS)
  const MOBILE_PRIMARY_NAV = mapDefs(basePath, MOBILE_PRIMARY_DEFS)
  const MOBILE_MORE_NAV = mapDefs(basePath, MOBILE_MORE_DEFS)
  return { MAIN_NAV, MOBILE_PRIMARY_NAV, MOBILE_MORE_NAV }
}

const adminNav = buildAdminNav('/admin')

export const ADMIN_MAIN_NAV = adminNav.MAIN_NAV
export const ADMIN_MOBILE_PRIMARY_NAV = adminNav.MOBILE_PRIMARY_NAV
export const ADMIN_MOBILE_MORE_NAV = adminNav.MOBILE_MORE_NAV

const ADMIN_MOBILE_NAV = [...ADMIN_MOBILE_PRIMARY_NAV, ...ADMIN_MOBILE_MORE_NAV]
const ALL_NAV = [...ADMIN_MOBILE_NAV, ...ADMIN_MAIN_NAV]

const navPathSuffix = (to) => {
  if (!to) return ''
  const idx = to.indexOf('/', 1)
  return idx >= 0 ? to.slice(idx) : to
}

/** Resolve a nav label by path suffix (works for /admin and /super-admin). */
export function adminNavLabel(to) {
  const suffix = navPathSuffix(to)
  const hit = ALL_NAV.find((item) => item.to === to || navPathSuffix(item.to) === suffix)
  return hit?.label
}
