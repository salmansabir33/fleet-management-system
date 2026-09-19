import { useMemo } from 'react'
import {
  Card,
  SectionHeader,
  Switch,
  LoadingState,
} from '../../shared/components'
import { MobilePageHeading } from '../../shared/shell'
import { MANAGER_NAV_LABELS } from '../navItems'
import { usePanelScope } from '../hooks/usePanelScope'
import { useManagerScope } from '../context/ManagerScopeContext'
import ManagerNotificationSettings from '../components/ManagerNotificationSettings'
import '../../admin/styles/admin-settings.css'

const PERMISSION_ROWS = [
  { key: 'live_tracking', label: 'Live Tracking' },
  { key: 'vehicle_management', label: 'Vehicle Management' },
  { key: 'user_management', label: 'User Management' },
  { key: 'driver_management', label: 'Driver Management' },
  { key: 'trip_history', label: 'Trip History' },
  { key: 'route_management', label: 'Route Management' },
  { key: 'reports_analytics', label: 'Reports & Analytics' },
  { key: 'geofence', label: 'Geofences' },
  { key: 'alerts_notifications', label: 'Alerts & Notifications' },
  { key: 'maintenance', label: 'Maintenance' },
  { key: 'fuel_prices', label: 'Fuel Prices' },
]

const ManagerSettings = () => {
  const { managerId } = usePanelScope()
  const {
    permissions,
    loading: scopeLoading,
  } = useManagerScope()

  const permissionRows = useMemo(
    () => PERMISSION_ROWS.map((row) => ({
      ...row,
      granted: Boolean(permissions?.[row.key]),
    })),
    [permissions],
  )

  return (
    <div className="ft-page-stack">
      <MobilePageHeading>{MANAGER_NAV_LABELS.settings}</MobilePageHeading>
      <div className="ft-admin-settings-grid">
        <Card>
          <SectionHeader
            title="Notification Preferences"
            subtitle="Turn manager portal alerts on or off"
          />
          <ManagerNotificationSettings managerId={managerId} />
        </Card>

        <Card>
          <SectionHeader
            title="Assigned Group Permissions"
            subtitle="What this manager account can access"
          />
          <p className="ft-admin-settings-card-hint">
            These are assigned by your administrator. You can see what is on or off,
            but only an admin can change them.
          </p>
          {scopeLoading ? (
            <LoadingState label="Loading permissions…" />
          ) : (
            <div className="ft-settings-switch-list" style={{ maxHeight: 'none' }}>
              {permissionRows.map((row) => (
                <div key={row.key} className="ft-settings-switch-row">
                  <div className="ft-settings-switch-copy">
                    <div className="ft-settings-switch-label">{row.label}</div>
                  </div>
                  <div className="ft-settings-switch-control">
                    <span className={`ft-settings-switch-state${row.granted ? ' is-on' : ''}`}>
                      {row.granted ? 'On' : 'Off'}
                    </span>
                    <Switch
                      checked={row.granted}
                      disabled
                      aria-label={`${row.label} is ${row.granted ? 'granted' : 'not granted'}`}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
    </div>
  )
}

export default ManagerSettings
