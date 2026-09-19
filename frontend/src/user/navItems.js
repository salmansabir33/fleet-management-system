import {
  LayoutDashboard, Car, Route as RouteIcon, Bell, Wrench,
  PlayCircle, Settings, Map,
} from 'lucide-react'

export const USER_NAV_ITEMS = [
  { to: '/user/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/user/my-vehicle', label: 'My Vehicle', icon: Car, requires: 'live_tracking' },
  { to: '/user/playback', label: 'Live Playback', icon: PlayCircle, requires: 'trip_history' },
  { to: '/user/trip-routes', label: 'Trips', icon: RouteIcon, requires: 'trip_history' },
  { to: '/user/alerts', label: 'Alerts', icon: Bell, requires: 'alerts_notifications' },
]

export const USER_PAGE_TITLE_ITEMS = [
  ...USER_NAV_ITEMS,
  { to: '/user/vehicles', label: 'My Vehicles' },
  { to: '/user/maintenance', label: 'Maintenance' },
  { to: '/user/settings', label: 'Settings' },
]

export const USER_MOBILE_PRIMARY_NAV = [
  { to: '/user/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/user/my-vehicle', label: 'My Vehicle', icon: Car, requires: 'live_tracking' },
  { to: '/user/trip-routes', label: 'Trip Routes', icon: RouteIcon, requires: 'trip_history' },
  { to: '/user/map', label: 'Map', icon: Map, requires: 'live_tracking' },
]

export const USER_MOBILE_MORE_NAV = [
  { to: '/user/playback', label: 'Live Playback', icon: PlayCircle, requires: 'trip_history' },
  { to: '/user/alerts', label: 'Alerts', icon: Bell, requires: 'alerts_notifications' },
  { to: '/user/maintenance', label: 'Maintenance', icon: Wrench, requires: 'maintenance' },
  { to: '/user/settings', label: 'Settings', icon: Settings },
]

const USER_MOBILE_NAV = [...USER_MOBILE_PRIMARY_NAV, ...USER_MOBILE_MORE_NAV]

/** Resolve a mobile-nav label by exact `to` path (source of truth for headings). */
export function userNavLabel(to) {
  return USER_MOBILE_NAV.find((item) => item.to === to)?.label
    ?? USER_PAGE_TITLE_ITEMS.find((item) => item.to === to)?.label
}
