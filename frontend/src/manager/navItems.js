import {
  LayoutDashboard, Route as RouteIcon, Settings, Bell,
  Users, Car, Wrench, PlayCircle, MapPin, History, Contact, Map,
} from 'lucide-react'

/** Static labels shared by desktop + mobile manager nav (single source of truth). */
export const MANAGER_NAV_LABELS = {
  dashboard: 'Dashboard',
  users: 'Users',
  vehicles: 'Vehicles',
  routes: 'Routes',
  geofences: 'Geofences',
  trips: 'Trips',
  maintenance: 'Maintenance',
  alerts: 'Alerts',
  playback: 'Live Playback',
  settings: 'Settings',
  drivers: 'Drivers',
  map: 'Map',
}

export function buildManagerDesktopNav(base) {
  return [
    { to: `${base}/dashboard`, label: MANAGER_NAV_LABELS.dashboard, icon: LayoutDashboard },
    { to: `${base}/picker`, label: MANAGER_NAV_LABELS.users, icon: Users, requires: 'live_tracking' },
    { to: `${base}/vehicles`, label: MANAGER_NAV_LABELS.vehicles, icon: Car, requires: 'live_tracking' },
    {
      to: `${base}/routes`,
      label: MANAGER_NAV_LABELS.routes,
      icon: RouteIcon,
      requires: 'route_management',
    },
    {
      to: `${base}/geofences`,
      label: MANAGER_NAV_LABELS.geofences,
      icon: MapPin,
      requires: 'geofence',
    },
    {
      to: `${base}/trips`,
      label: MANAGER_NAV_LABELS.trips,
      icon: History,
      requires: 'trip_history',
    },
    {
      to: `${base}/maintenance`,
      label: MANAGER_NAV_LABELS.maintenance,
      icon: Wrench,
      requires: 'maintenance',
    },
    {
      to: `${base}/alerts`,
      label: MANAGER_NAV_LABELS.alerts,
      icon: Bell,
      requires: 'alerts_notifications',
    },
    {
      to: `${base}/playback`,
      label: MANAGER_NAV_LABELS.playback,
      icon: PlayCircle,
      requires: 'live_tracking',
    },
    { to: `${base}/settings`, label: MANAGER_NAV_LABELS.settings, icon: Settings },
  ]
}

export function buildManagerMobilePrimaryNav(base) {
  return [
    { to: `${base}/dashboard`, label: MANAGER_NAV_LABELS.dashboard, icon: LayoutDashboard },
    { to: `${base}/vehicles`, label: MANAGER_NAV_LABELS.vehicles, icon: Car, requires: 'live_tracking' },
    { to: `${base}/trips`, label: MANAGER_NAV_LABELS.trips, icon: History, requires: 'trip_history' },
    { to: `${base}/drivers`, label: MANAGER_NAV_LABELS.drivers, icon: Contact, requires: 'driver_management' },
    { to: `${base}/map`, label: MANAGER_NAV_LABELS.map, icon: Map, requires: 'live_tracking' },
  ]
}

export function buildManagerMobileMoreNav(base) {
  return [
    { to: `${base}/picker`, label: MANAGER_NAV_LABELS.users, icon: Users, requires: 'live_tracking' },
    { to: `${base}/routes`, label: MANAGER_NAV_LABELS.routes, icon: RouteIcon, requires: 'route_management' },
    { to: `${base}/geofences`, label: MANAGER_NAV_LABELS.geofences, icon: MapPin, requires: 'geofence' },
    { to: `${base}/maintenance`, label: MANAGER_NAV_LABELS.maintenance, icon: Wrench, requires: 'maintenance' },
    { to: `${base}/alerts`, label: MANAGER_NAV_LABELS.alerts, icon: Bell, requires: 'alerts_notifications' },
    { to: `${base}/playback`, label: MANAGER_NAV_LABELS.playback, icon: PlayCircle, requires: 'live_tracking' },
    { to: `${base}/settings`, label: MANAGER_NAV_LABELS.settings, icon: Settings },
  ]
}
