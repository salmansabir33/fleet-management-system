import { useNavigate } from 'react-router-dom'
import { Car, Activity, CirclePause, WifiOff } from 'lucide-react'
import { useTheme } from '../../../theme'
import {
  Card,
  StatCard,
  Switch,
  Dropdown,
  DropdownItem,
  Button,
} from '../../../shared/components'
import { TOP_VEHICLE_PERIODS } from '../../../admin/utils/dashboardPeriod'
import { usePanelScope } from '../../hooks/usePanelScope'
import { fmtNum } from '../../utils/dashboardFormatters'
import LiveBadge from '../../../admin/components/LiveBadge'

const DashboardOverviewCard = ({
  statusCounts,
  totalVehicles,
  summary,
  driverCount,
  canLive,
  canReports,
  tripDate,
  onTripDateChange,
  autoRefresh,
  onAutoRefreshChange,
  lastUpdated,
  loading = false,
}) => {
  const { tokens } = useTheme()
  const navigate = useNavigate()
  const { basePath } = usePanelScope()
  const periodLabel = TOP_VEHICLE_PERIODS.find((p) => p.key === tripDate)?.label || 'Today'

  const tripsTodayDistance = canReports ? summary?.trips_total_distance_km : null
  const fuelCostToday = canReports ? summary?.trips_total_fuel_cost_pkr : null
  const activeDrivers = canReports && summary
    ? `${summary.drivers_on_trip ?? 0}/${summary.drivers_total ?? 0}`
    : (driverCount != null ? `—/${driverCount}` : '—')

  return (
    <Card
      badge={2}
      title="Dashboard Overview"
      right={(
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          {canLive && <LiveBadge />}
          <Dropdown
            trigger={(
              <Button variant="secondary" size="sm">
                {periodLabel}
              </Button>
            )}
            align="right"
          >
            {TOP_VEHICLE_PERIODS.map((period) => (
              <DropdownItem key={period.key} onClick={() => onTripDateChange(period.key)}>
                {period.label}
              </DropdownItem>
            ))}
          </Dropdown>
          <label
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8,
              fontSize: 12,
              color: tokens.textMuted,
              cursor: 'pointer',
            }}
          >
            <Switch checked={autoRefresh} onChange={(e) => onAutoRefreshChange(e.target.checked)} />
            Auto refresh
          </label>
        </div>
      )}
    >
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
          gap: 12,
          marginBottom: 16,
        }}
      >
        <StatCard
          icon={Car}
          label="Total Vehicles"
          value={canLive ? totalVehicles : '—'}
          tone="brand"
          iconColor="blue"
          loading={loading}
          onClick={() => navigate(`${basePath}/vehicles`)}
        />
        <StatCard
          icon={Activity}
          label="Online"
          value={canLive ? (statusCounts.online || 0) : '—'}
          tone="success"
          iconColor="green"
          loading={loading}
        />
        <StatCard
          icon={CirclePause}
          label="Idle"
          value={canLive ? (statusCounts.idle || 0) : '—'}
          tone="warning"
          iconColor="orange"
          loading={loading}
        />
        <StatCard
          icon={WifiOff}
          label="Offline"
          value={canLive ? (statusCounts.offline || 0) : '—'}
          tone="danger"
          iconColor="red"
          loading={loading}
        />
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
          gap: 12,
          padding: '12px 14px',
          borderRadius: tokens.radius.md,
          background: tokens.background,
          fontSize: 13,
        }}
      >
        <div>
          <div style={{ fontSize: 11, fontWeight: 600, color: tokens.textMuted, textTransform: 'uppercase' }}>
            Distance ({periodLabel})
          </div>
          <div style={{ fontWeight: 700, color: tokens.text, marginTop: 4 }}>
            {canReports && tripsTodayDistance != null ? `${fmtNum(tripsTodayDistance, 1)} km` : '—'}
          </div>
        </div>
        <div>
          <div style={{ fontSize: 11, fontWeight: 600, color: tokens.textMuted, textTransform: 'uppercase' }}>
            Fuel Cost ({periodLabel})
          </div>
          <div style={{ fontWeight: 700, color: tokens.text, marginTop: 4 }}>
            {canReports && fuelCostToday != null ? `PKR ${fmtNum(fuelCostToday)}` : '—'}
          </div>
        </div>
        <div>
          <div style={{ fontSize: 11, fontWeight: 600, color: tokens.textMuted, textTransform: 'uppercase' }}>
            Active Drivers
          </div>
          <div style={{ fontWeight: 700, color: tokens.text, marginTop: 4 }}>
            {activeDrivers}
          </div>
        </div>
      </div>

      {lastUpdated && (
        <p style={{ fontSize: 11, color: tokens.textMuted, margin: '10px 0 0' }}>
          Last updated {lastUpdated.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </p>
      )}
    </Card>
  )
}

export default DashboardOverviewCard
