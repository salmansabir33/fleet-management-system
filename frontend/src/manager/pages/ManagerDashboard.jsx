import { lazy, Suspense, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { Card, DonutChart } from '../../shared/components'
import { Skeleton } from '../../shared/components/Feedback'
import { useManagerDashboardData } from '../hooks/useManagerDashboardData'
import { usePanelScope } from '../hooks/usePanelScope'
import { fmtNum } from '../utils/dashboardFormatters'
import { ManagerKpiCard } from '../components/dashboard/ManagerKpiCard'
import { MobilePageHeading } from '../../shared/shell'
import { MANAGER_NAV_LABELS } from '../navItems'
import '../styles/manager-dashboard.css'

const ManagerUsageChart = lazy(() =>
  import('../components/dashboard/ManagerUsageChart').then((mod) => ({
    default: mod.ManagerUsageChart,
  })),
)

const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

const DONUT_COLORS = {
  online: '#2563eb',
  offline: '#ef4444',
}

const BAR = {
  blue: '#4338ca',
  green: '#16a34a',
  red: '#dc2626',
  lightBlue: '#60a5fa',
}

const pad = (n) => String(n).padStart(2, '0')

const localDateKey = (value) => {
  const d = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(d.getTime())) return ''
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

const tripDateKey = (trip) => {
  if (trip?.trip_date) return String(trip.trip_date).slice(0, 10)
  return localDateKey(trip?.start_time)
}

const ratioPct = (current, max) => {
  if (!max || max <= 0) return 0
  return Math.max(0, Math.min(100, Math.round((current / max) * 100)))
}

const filledPct = (hasValue, fill = 72) => (hasValue ? fill : 0)

const ChartFallback = ({ height = 280 }) => (
  <Card
    className="ft-md-chart"
    title="Assigned Vehicles Usage"
    subtitle="This week · distance and fuel"
  >
    <Skeleton height={height} style={{ borderRadius: 8 }} />
  </Card>
)

const ManagerDashboard = () => {
  const navigate = useNavigate()
  const { can, basePath } = usePanelScope()
  const data = useManagerDashboardData(true)
  const { loading, tripsLoading } = data

  const totalFleet = data.vehicleRows.length
  const activeCount = data.statusCounts.online || 0
  const idleCount = data.statusCounts.idle || 0
  const canLive = data.permissions.canLive
  const canReports = data.permissions.canReports
  const canTrips = data.permissions.canTrips

  const todayKey = localDateKey(new Date())

  // Today's fuel / idle fuel come from the same weekly trip payload (no second /trips call).
  const todayTripTotals = useMemo(() => {
    let idleFuelLiters = 0
    let todayFuelLiters = 0
    for (const trip of data.weekTrips || []) {
      if (tripDateKey(trip) !== todayKey) continue
      idleFuelLiters += Number(trip.idle_fuel_liters) || 0
      todayFuelLiters += Number(trip.total_fuel_liters) || 0
    }
    return { idleFuelLiters, todayFuelLiters }
  }, [data.weekTrips, todayKey])

  const { idleFuelLiters, todayFuelLiters } = todayTripTotals

  const activeLabel = canLive && totalFleet > 0
    ? `${activeCount}/${totalFleet}`
    : (canLive ? `${activeCount}` : '—')

  const todayDistance = canReports && data.summary?.trips_total_distance_km != null
    ? `${fmtNum(data.summary.trips_total_distance_km, 0)} km`
    : '—'

  const idleLabel = !canLive
    ? '—'
    : (canTrips && idleFuelLiters > 0
      ? `${fmtNum(idleFuelLiters, 1)} L`
      : String(idleCount))

  const todayFuelLabel = canTrips
    ? `${fmtNum(todayFuelLiters, todayFuelLiters >= 10 ? 0 : 1)} L`
    : '—'

  const overdueLabel = canReports && data.summary?.vehicles_overdue_maintenance != null
    ? String(data.summary.vehicles_overdue_maintenance)
    : '—'

  const fleetSegments = useMemo(() => [
    {
      key: 'online',
      label: 'Online',
      value: data.statusCounts.online || 0,
      color: DONUT_COLORS.online,
    },
    {
      key: 'offline',
      label: 'Offline',
      value: data.statusCounts.offline || 0,
      color: DONUT_COLORS.offline,
    },
  ], [data.statusCounts])

  const weeklyChartData = useMemo(() => {
    const now = new Date()
    const start = new Date(now)
    start.setHours(0, 0, 0, 0)
    start.setDate(start.getDate() - start.getDay())

    const weekKeys = WEEKDAY_LABELS.map((_, i) => {
      const day = new Date(start)
      day.setDate(start.getDate() + i)
      return localDateKey(day)
    })
    const weekKeySet = new Set(weekKeys)

    const perDay = WEEKDAY_LABELS.map((label, i) => ({
      label,
      key: weekKeys[i],
      distance: 0,
      fuel: 0,
    }))
    const byKey = new Map(perDay.map((row) => [row.key, row]))

    for (const trip of data.weekTrips || []) {
      const key = tripDateKey(trip)
      if (!weekKeySet.has(key)) continue
      const row = byKey.get(key)
      if (!row) continue
      row.distance += Number(trip.distance_km) || 0
      row.fuel += Number(trip.total_fuel_liters) || 0
    }

    return perDay.map((row) => ({
      label: row.label,
      distance: Math.round(row.distance * 10) / 10,
      fuel: Math.round(row.fuel * 10) / 10,
    }))
  }, [data.weekTrips])

  const usageInsights = useMemo(() => {
    let weekDistance = 0
    let weekFuel = 0
    for (const row of weeklyChartData) {
      weekDistance += Number(row.distance) || 0
      weekFuel += Number(row.fuel) || 0
    }

    return [
      {
        key: 'distance',
        label: 'Week distance',
        value: `${fmtNum(weekDistance, 0)} km`,
        color: '#4f46e5',
      },
      {
        key: 'fuel',
        label: 'Week fuel',
        value: `${fmtNum(weekFuel, weekFuel >= 10 ? 0 : 1)} L`,
        color: '#059669',
      },
    ]
  }, [weeklyChartData])

  const go = (path) => () => navigate(`${basePath}${path}`)

  const fuelKpiLoading = canTrips ? tripsLoading : false

  const kpis = [
    {
      key: 'fleet',
      label: 'Total Vehicles',
      value: canLive ? totalFleet : '—',
      barColor: BAR.blue,
      progress: canLive ? filledPct(totalFleet > 0, 78) : 0,
      hint: 'Vehicles assigned to this manager',
      interactive: canLive,
      onClick: go('/vehicles'),
      loading,
    },
    {
      key: 'active',
      label: 'Active',
      value: activeLabel,
      barColor: BAR.green,
      progress: canLive ? ratioPct(activeCount, totalFleet) : 0,
      hint: 'Vehicles currently online (not offline)',
      loading,
    },
    {
      key: 'distance',
      label: "Today's Distance",
      value: todayDistance,
      barColor: BAR.blue,
      progress: canReports ? filledPct(Number(data.summary?.trips_total_distance_km) > 0, 70) : 0,
      hint: 'Distance covered by trips today',
      interactive: can('trip_history'),
      onClick: go('/trips'),
      loading,
    },
    {
      key: 'fuel',
      label: "Today's Fuel",
      value: canTrips ? todayFuelLabel : '—',
      barColor: BAR.lightBlue,
      progress: canTrips ? filledPct(todayFuelLiters > 0, 58) : 0,
      hint: 'Total fuel used on trips today',
      interactive: can('trip_history'),
      onClick: go('/trips'),
      loading: fuelKpiLoading,
    },
    {
      key: 'overdue',
      label: 'Maintenance Overdue',
      value: overdueLabel,
      barColor: BAR.blue,
      progress: canReports
        ? ratioPct(data.summary?.vehicles_overdue_maintenance || 0, totalFleet || 1)
        : 0,
      hint: 'Vehicles with overdue maintenance',
      interactive: can('maintenance'),
      onClick: go('/maintenance'),
      loading,
    },
    {
      key: 'idle',
      label: 'Idle',
      value: idleLabel,
      barColor: BAR.red,
      progress: canLive
        ? (idleFuelLiters > 0 ? filledPct(true, 62) : ratioPct(idleCount, totalFleet))
        : 0,
      hint: canTrips && idleFuelLiters > 0
        ? 'Idle fuel used on trips today'
        : 'Vehicles currently idling',
      // Idle may switch from count → fuel liters once week trips arrive.
      loading: canTrips ? (loading || tripsLoading) : loading,
    },
  ]

  return (
    <div className="ft-page-stack ft-manager-dashboard">
      <MobilePageHeading>{MANAGER_NAV_LABELS.dashboard}</MobilePageHeading>
      <div className="ft-md-top">
        <div className="ft-md-kpis">
          {kpis.map((kpi) => (
            <ManagerKpiCard
              key={kpi.key}
              label={kpi.label}
              value={kpi.value}
              barColor={kpi.barColor}
              progress={kpi.progress}
              hint={kpi.hint}
              loading={kpi.loading}
              interactive={kpi.interactive}
              onClick={kpi.onClick}
            />
          ))}
        </div>

        <Card
          className="ft-md-status"
          title="Fleet Status Breakdown"
          subtitle="Online · Offline"
          loading={loading}
          skeletonLines={5}
        >
          {!canLive ? (
            <p style={{ fontSize: 13, color: 'var(--ft-text-muted)', margin: 0 }}>
              Not permitted
            </p>
          ) : (
            <DonutChart
              segments={fleetSegments}
              size={120}
              thickness={20}
              showPercentInLegend
              showValueInLegend
            />
          )}
        </Card>
      </div>

      <Suspense fallback={<ChartFallback height={280} />}>
        <ManagerUsageChart
          data={weeklyChartData}
          insights={usageInsights}
          loading={tripsLoading}
          height={280}
        />
      </Suspense>
    </div>
  )
}

export default ManagerDashboard
