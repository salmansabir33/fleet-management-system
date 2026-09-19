import { useSearchParams } from 'react-router-dom'
import { PageHeader, Tabs } from '../../shared/components'
import PermissionsSettings from './settings/PermissionsSettings'
import NotificationSettings from './settings/NotificationSettings'
import FuelPriceSettings from './settings/FuelPriceSettings'
import '../styles/admin-notifications.css'
import '../styles/admin-settings.css'

const TABS = [
  { id: 'permissions', label: 'Permissions' },
  { id: 'notifications', label: 'Notifications' },
  { id: 'fuel-prices', label: 'Fuel Prices' },
]

const SUBTITLES = {
  permissions: 'Choose which permission and notification options you can assign to a manager.',
  notifications: 'Choose which alerts managers and this admin browser can see.',
  'fuel-prices': 'Set petrol and diesel prices by date. Trip fuel cost uses the rate in effect for each vehicle’s fuel type.',
}

const normalizeTab = (raw) => {
  if (raw === 'notifications' || raw === 'alert-types') return 'notifications'
  if (raw === 'fuel-prices' || raw === 'fuel_prices' || raw === 'fuel') return 'fuel-prices'
  return 'permissions'
}

const Settings = () => {
  const [searchParams, setSearchParams] = useSearchParams()
  const tab = normalizeTab(searchParams.get('tab'))

  const setTab = (id) => {
    const next = new URLSearchParams(searchParams)
    if (id === 'permissions') next.delete('tab')
    else next.set('tab', id)
    setSearchParams(next, { replace: true })
  }

  return (
    <div className="ft-page-stack ft-admin-settings-page">
      <PageHeader
        title="Settings"
        subtitle={SUBTITLES[tab] || SUBTITLES.permissions}
      />

      <div className="ft-admin-settings-tabs">
        <Tabs items={TABS} value={tab} onChange={setTab} />
      </div>

      {tab === 'permissions' && <PermissionsSettings />}
      {tab === 'notifications' && <NotificationSettings />}
      {tab === 'fuel-prices' && <FuelPriceSettings />}
    </div>
  )
}

export default Settings
