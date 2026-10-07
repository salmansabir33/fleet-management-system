import { useSearchParams } from 'react-router-dom'
import { PageHeader, Tabs } from '../../shared/components'
import { useAuth } from '../../auth/AuthContext'
import { readActingAdminId } from '../../auth/actingAdminStorage'
import PermissionsSettings from './settings/PermissionsSettings'
import NotificationSettings from './settings/NotificationSettings'
import FuelPriceSettings from './settings/FuelPriceSettings'
import '../styles/admin-notifications.css'
import '../styles/admin-settings.css'

const ADMIN_TABS = [
  { id: 'permissions', label: 'Permissions' },
  { id: 'notifications', label: 'Notifications' },
  { id: 'fuel-prices', label: 'Fuel Prices' },
]

const SUPER_ADMIN_TABS = [
  { id: 'notifications', label: 'Notifications' },
  { id: 'fuel-prices', label: 'Fuel Prices' },
]

const SUBTITLES = {
  permissions: 'Choose which permission options you can assign to managers in this fleet.',
  notifications: 'Choose which alerts managers and this admin browser can see.',
  'fuel-prices': 'Set petrol and diesel prices by date. Trip fuel cost uses the rate in effect for each vehicle’s fuel type.',
}

const SUPER_ADMIN_SUBTITLES = {
  notifications: 'Choose which alerts appear in the super admin notification bell on this browser.',
  'fuel-prices': 'Set petrol and diesel prices by date. Trip fuel cost uses the rate in effect for each vehicle’s fuel type.',
}

const normalizeTab = (raw, { showPermissions }) => {
  if (raw === 'notifications' || raw === 'alert-types') return 'notifications'
  if (raw === 'fuel-prices' || raw === 'fuel_prices' || raw === 'fuel') return 'fuel-prices'
  if (raw === 'permissions' && showPermissions) return 'permissions'
  return showPermissions ? 'permissions' : 'notifications'
}

const Settings = () => {
  const { role } = useAuth()
  const actingAdminId = readActingAdminId()
  const isSuperAdmin = role === 'super_admin'
  const actingAsFleet = isSuperAdmin && actingAdminId != null
  // Fleet admin (or SA acting as a fleet) edits per-fleet manager offerings.
  const isFleetSettings = role === 'admin' || actingAsFleet
  const showPermissions = isFleetSettings
  const personalOnly = isSuperAdmin && !actingAsFleet
  const catalogReadOnly = !isFleetSettings
  const fuelGlobalMode = isSuperAdmin && actingAdminId == null
  const [searchParams, setSearchParams] = useSearchParams()
  const tab = normalizeTab(searchParams.get('tab'), { showPermissions })
  const tabs = personalOnly ? SUPER_ADMIN_TABS : ADMIN_TABS
  const subtitles = personalOnly ? SUPER_ADMIN_SUBTITLES : SUBTITLES
  const defaultTab = showPermissions ? 'permissions' : 'notifications'

  const setTab = (id) => {
    const next = new URLSearchParams(searchParams)
    if (id === defaultTab) next.delete('tab')
    else next.set('tab', id)
    setSearchParams(next, { replace: true })
  }

  return (
    <div className="ft-page-stack ft-admin-settings-page">
      <PageHeader
        title="Settings"
        subtitle={subtitles[tab] || subtitles[defaultTab]}
      />

      <div className="ft-admin-settings-tabs">
        <Tabs items={tabs} value={tab} onChange={setTab} />
      </div>

      {showPermissions && tab === 'permissions' && (
        <PermissionsSettings readOnly={catalogReadOnly} />
      )}
      {tab === 'notifications' && (
        <NotificationSettings
          readOnly={catalogReadOnly}
          personalOnly={personalOnly}
          detectionReadOnly
        />
      )}
      {tab === 'fuel-prices' && (
        <FuelPriceSettings
          fleetScoped={role === 'admin' || actingAdminId != null}
          globalMode={fuelGlobalMode}
        />
      )}
    </div>
  )
}

export default Settings
