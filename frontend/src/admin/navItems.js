import {
  LayoutDashboard, Car, Bell, Users, Route as RouteIcon,
  MapPin, UserCog, Settings, Contact, History,
  PlayCircle, Map, Wrench,
} from 'lucide-react'

export const ADMIN_MAIN_NAV = [
  { to: '/admin/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/admin/vehicles', label: 'Vehicles', icon: Car },
  { to: '/admin/notifications', label: 'Notifications', icon: Bell },
  { to: '/admin/users', label: 'Users', icon: Users },
  { to: '/admin/drivers', label: 'Drivers', icon: Contact },
  { to: '/admin/trips', label: 'Trips', icon: History },
  { to: '/admin/playback', label: 'Live Playback', icon: PlayCircle },
  { to: '/admin/routes', label: 'Routes', icon: RouteIcon },
  { to: '/admin/geofences', label: 'Geofences', icon: MapPin },
  { to: '/admin/maintenance', label: 'Maintenance', kind: 'maintenance' },
  { to: '/admin/managers', label: 'Managers', icon: UserCog },
  { to: '/admin/settings', label: 'Settings', icon: Settings },
]

export const ADMIN_MOBILE_PRIMARY_NAV = [
  { to: '/admin/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/admin/vehicles', label: 'Vehicles', icon: Car },
  { to: '/admin/trips', label: 'Trips', icon: History },
  { to: '/admin/drivers', label: 'Drivers', icon: Contact },
  { to: '/admin/map', label: 'Map', icon: Map },
]

export const ADMIN_MOBILE_MORE_NAV = [
  { to: '/admin/notifications', label: 'Notifications', icon: Bell },
  { to: '/admin/users', label: 'Users', icon: Users },
  { to: '/admin/playback', label: 'Live Playback', icon: PlayCircle },
  { to: '/admin/routes', label: 'Routes', icon: RouteIcon },
  { to: '/admin/geofences', label: 'Geofences', icon: MapPin },
  { to: '/admin/maintenance', label: 'Maintenance', icon: Wrench },
  { to: '/admin/managers', label: 'Managers', icon: UserCog },
  { to: '/admin/settings', label: 'Settings', icon: Settings },
]

const ADMIN_MOBILE_NAV = [...ADMIN_MOBILE_PRIMARY_NAV, ...ADMIN_MOBILE_MORE_NAV]

/** Resolve a mobile-nav label by exact `to` path (source of truth for headings). */
export function adminNavLabel(to) {
  return ADMIN_MOBILE_NAV.find((item) => item.to === to)?.label
    ?? ADMIN_MAIN_NAV.find((item) => item.to === to)?.label
}
