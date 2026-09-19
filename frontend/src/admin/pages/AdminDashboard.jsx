import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Activity,
  AlertTriangle,
  Calendar,
  Car,
  Contact,
  Gauge,
  Navigation,
  Route,
  Wallet,
  Wrench,
} from 'lucide-react'
import api from '../../api'
import { useTheme } from '../../theme'
import {
  PageHeader,
  KpiStatCard,
} from '../../shared/components'
import { Select } from '../../shared/components/Form'
import { deriveVehicleStatus } from '../../user/utils/vehicleStatus'
import { useMediaQuery } from '../../user/hooks/useMediaQuery'
import { usePanelScope } from '../../manager/hooks/usePanelScope'
import AdminTrendChart, {
  FLEET_DISTANCE_SERIES,
  FLEET_FUEL_COST_SERIES,
} from '../components/AdminTrendChart'
import AdminDashboardMap from '../components/AdminDashboardMap'
import {
  TREND_PERIODS,
  isInDashboardPeriod,
  periodKpiLabels,
} from '../utils/dashboardPeriod'
import '../styles/admin-dashboard.css'

const fmtNum = (value, digits = 0) => {
  if (value == null || Number.isNaN(Number(value))) return '—'
  return Number(value).toLocaleString(undefined, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })
}

const fmtPkr = (value, digits = 0) => {
  if (value == null || Number.isNaN(Number(value))) return '—'
  return `PKR ${fmtNum(value, digits)}`
}

const fmtPkrCompact = (value) => {
  if (value == null || Number.isNaN(Number(value))) return '—'
  const n = Number(value)
  if (n >= 1_000_000) return `PKR ${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `PKR ${(n / 1_000).toFixed(1)}k`
  return fmtPkr(n, 0)
}

const fmtKm = (value) => {
  if (value == null || Number.isNaN(Number(value))) return '—'
  return `${fmtNum(value, 1)} km`
}

function summarizeAlerts(list, periodKey) {
  const counts = { critical: 0, warning: 0, info: 0, total: 0 }
  for (const a of list || []) {
    if (!isInDashboardPeriod(a.triggered_at, periodKey)) continue
    counts.total += 1
    if (a.severity === 'critical') counts.critical += 1
    else if (a.severity === 'warning') counts.warning += 1
    else if (a.severity === 'info') counts.info += 1
  }
  return counts
}

const AdminDashboard = () => {
  const { isManager, apiFor, can, basePath } = usePanelScope()
  const { tokens } = useTheme()
  const navigate = useNavigate()
  const isDesktop = useMediaQuery('(min-width: 821px)')

  const [live, setLive] = useState([])
  const [adminSummary, setAdminSummary] = useState(null)
  const [alertSummary, setAlertSummary] = useState(null)
  const [trendPoints, setTrendPoints] = useState([])
  const [loading, setLoading] = useState(true)
  const [summaryLoading, setSummaryLoading] = useState(true)
  const [alertsLoading, setAlertsLoading] = useState(true)
  const [trendLoading, setTrendLoading] = useState(true)
  const [dashboardPeriod, setDashboardPeriod] = useState('month')

  const canLive = can('live_tracking')
  const canReports = can('reports_analytics')
  const canViewTrips = can('trip_history')
  const canMaintenance = can('maintenance')
  const canDrivers = can('driver_management')
  const canAlerts = can('alerts_notifications')

  const kpiLabels = useMemo(
    () => periodKpiLabels(dashboardPeriod),
    [dashboardPeriod],
  )

  useEffect(() => {
    let cancelled = false

    const loadLive = async () => {
      try {
        if (isManager) {
          const dashRes = await api.get(apiFor('/dashboard', '/api/live'), {
            params: { compact: true, period: dashboardPeriod },
          })
          if (cancelled) return
          setLive(Array.isArray(dashRes.data.live) ? dashRes.data.live : [])
          if (dashRes.data.summary != null) {
            setAdminSummary(dashRes.data.summary)
            setSummaryLoading(false)
          }
        } else {
          const liveRes = await api.get('/api/live', { params: { compact: true } })
          if (cancelled) return
          setLive(liveRes.data.live || [])
        }
      } catch (err) {
        console.error('Failed to load dashboard live feed:', err)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    loadLive()
    const interval = setInterval(loadLive, 10000)
    return () => { cancelled = true; clearInterval(interval) }
  }, [isManager, apiFor, dashboardPeriod])

  useEffect(() => {
    if (isManager) return undefined
    if (!canReports && !canMaintenance && !canDrivers) {
      setSummaryLoading(false)
      return undefined
    }

    let cancelled = false
    setSummaryLoading(true)

    const loadSummary = async () => {
      try {
        const summaryRes = await api.get('/api/admin/dashboard/summary', {
          params: { period: dashboardPeriod },
        })
        if (cancelled) return
        setAdminSummary(summaryRes.data)
      } catch (err) {
        console.error('Failed to load dashboard summary:', err)
      } finally {
        if (!cancelled) setSummaryLoading(false)
      }
    }

    loadSummary()
    return () => { cancelled = true }
  }, [isManager, canReports, canMaintenance, canDrivers, dashboardPeriod])

  useEffect(() => {
    if (!canAlerts) {
      setAlertSummary(null)
      setAlertsLoading(false)
      return undefined
    }

    let cancelled = false
    setAlertsLoading(true)

    const loadAlerts = async () => {
      try {
        if (isManager) {
          const res = await api.get(apiFor('/alerts', '/api/alerts'), {
            params: { limit: 200 },
          })
          if (!cancelled) setAlertSummary(summarizeAlerts(res.data, dashboardPeriod))
        } else {
          const res = await api.get('/api/alerts/summary', {
            params: { period: dashboardPeriod },
          })
          if (!cancelled) setAlertSummary(res.data)
        }
      } catch (err) {
        console.error('Failed to load alerts summary:', err)
        if (!cancelled) setAlertSummary(null)
      } finally {
        if (!cancelled) setAlertsLoading(false)
      }
    }

    loadAlerts()
    return () => { cancelled = true }
  }, [apiFor, canAlerts, isManager, dashboardPeriod])

  useEffect(() => {
    if (!canViewTrips) {
      setTrendPoints([])
      setTrendLoading(false)
      return undefined
    }

    let cancelled = false
    setTrendLoading(true)

    const loadTrend = async () => {
      try {
        const res = await api.get(
          apiFor('/dashboard/trends', '/api/admin/dashboard/trends'),
          { params: { period: dashboardPeriod } },
        )
        if (!cancelled) {
          setTrendPoints(Array.isArray(res.data?.points) ? res.data.points : [])
        }
      } catch (err) {
        console.error('Failed to load fleet trends:', err)
        if (!cancelled) setTrendPoints([])
      } finally {
        if (!cancelled) setTrendLoading(false)
      }
    }

    loadTrend()
    return () => { cancelled = true }
  }, [apiFor, canViewTrips, dashboardPeriod])

  const statusCounts = useMemo(() => {
    const counts = { moving: 0, idle: 0, stopped: 0, offline: 0 }
    for (const item of live) {
      const status = deriveVehicleStatus(item)
      counts[status] = (counts[status] || 0) + 1
    }
    return counts
  }, [live])

  const vehiclesPath = `${basePath}/vehicles`
  const driversPath = `${basePath}/drivers`
  const tripsPath = `${basePath}/trips`
  const maintenancePath = `${basePath}/maintenance`
  const alertsPath = isManager ? `${basePath}/alerts` : `${basePath}/notifications`

  const totalVehicles = canLive ? live.length : null
  const runningCount = canLive ? (statusCounts.moving || 0) : null
  const idleCount = canLive ? (statusCounts.idle || 0) : null
  const offlineCount = canLive ? (statusCounts.offline || 0) : null

  const tripsToday = adminSummary?.trips_today ?? null
  const todayDistance = adminSummary?.trips_total_distance_km ?? null
  const todayFuelCost = adminSummary?.trips_total_fuel_cost_pkr ?? null
  const maintenanceDue = adminSummary?.vehicles_due_maintenance ?? 0
  const maintenanceOverdue = adminSummary?.vehicles_overdue_maintenance ?? 0
  const maintenanceYtd = adminSummary?.maintenance_records_ytd ?? null

  const alertsTotal = alertSummary?.total ?? null
  const alertsCritical = alertSummary?.critical ?? 0

  const showOps = canReports || canDrivers || canMaintenance
  const showDesktopMap = canLive && isDesktop
  const chartFill = showDesktopMap

  const periodFilter = (
    <div className="ft-admin-period-filter">
      <span className="ft-admin-period-filter__icon" aria-hidden>
        <Calendar size={15} strokeWidth={2.25} />
      </span>
      <Select
        value={dashboardPeriod}
        onChange={(e) => setDashboardPeriod(e.target.value)}
        className="ft-admin-period-filter__select"
        aria-label="Dashboard period"
      >
        {TREND_PERIODS.map((p) => (
          <option key={p.key} value={p.key}>{p.label}</option>
        ))}
      </Select>
    </div>
  )

  const trends = !canViewTrips ? (
    <div className="ft-admin-widget ft-admin-trend-chart">
      <h3 className="ft-admin-widget__title">Fleet Trends</h3>
      <div
        className="ft-admin-trend-chart__empty"
        style={{ height: 160, color: tokens.textMuted }}
      >
        Not permitted
      </div>
    </div>
  ) : (
    <div className="ft-admin-fleet-trends">
      <AdminTrendChart
        title="Distance"
        data={trendPoints}
        period={dashboardPeriod}
        loading={trendLoading}
        height={chartFill ? 148 : 180}
        fill={chartFill}
        series={FLEET_DISTANCE_SERIES}
        emptyMessage="No distance data for this period"
        showPeriodSelect={false}
      />
      <AdminTrendChart
        title="Fuel Cost"
        data={trendPoints}
        period={dashboardPeriod}
        loading={trendLoading}
        height={chartFill ? 148 : 180}
        fill={chartFill}
        series={FLEET_FUEL_COST_SERIES}
        emptyMessage="No fuel cost data for this period"
        showPeriodSelect={false}
      />
    </div>
  )

  return (
    <div className="ft-page-stack ft-admin-dashboard">
      <PageHeader
        title={isManager ? 'Manager Dashboard' : 'Admin Dashboard'}
        actions={periodFilter}
      />

      <div className="ft-kpi-row ft-kpi-row--wrap">
        {canLive && (
          <KpiStatCard
            label="Total Vehicles"
            value={totalVehicles != null ? fmtNum(totalVehicles) : '—'}
            icon={Car}
            tone="brand"
            loading={loading}
            interactive
            onClick={() => navigate(vehiclesPath)}
          />
        )}
        {canLive && (
          <KpiStatCard
            label="Running"
            value={runningCount != null ? fmtNum(runningCount) : '—'}
            icon={Activity}
            tone="success"
            loading={loading}
            interactive
            onClick={() => navigate(vehiclesPath)}
          />
        )}
        {canLive && (
          <KpiStatCard
            label="Idle / Offline"
            value={
              idleCount == null
                ? '—'
                : `${fmtNum(idleCount)} / ${fmtNum(offlineCount)}`
            }
            icon={Gauge}
            tone="info"
            loading={loading}
            interactive
            onClick={() => navigate(vehiclesPath)}
          />
        )}
        {canMaintenance && (
          <KpiStatCard
            label="Maintenance Due"
            value={fmtNum(maintenanceDue)}
            icon={Wrench}
            tone={maintenanceDue > 0 || maintenanceOverdue > 0 ? 'danger' : 'brand'}
            iconColor={maintenanceDue > 0 || maintenanceOverdue > 0 ? 'red' : 'teal'}
            loading={summaryLoading}
            interactive
            onClick={() => navigate(maintenancePath)}
            trend={
              maintenanceOverdue > 0
                ? { direction: 'up', label: `${maintenanceOverdue} overdue` }
                : undefined
            }
          />
        )}
        {canReports && (
          <KpiStatCard
            label={kpiLabels.distance}
            value={fmtKm(todayDistance)}
            icon={Navigation}
            tone="brand"
            iconColor="teal"
            loading={summaryLoading}
            interactive={canViewTrips}
            onClick={canViewTrips ? () => navigate(tripsPath) : undefined}
          />
        )}
        {canReports && (
          <KpiStatCard
            label={kpiLabels.fuelCost}
            value={todayFuelCost == null ? '—' : fmtPkrCompact(todayFuelCost)}
            icon={Wallet}
            tone="warning"
            loading={summaryLoading}
            interactive={canViewTrips}
            onClick={canViewTrips ? () => navigate(tripsPath) : undefined}
          />
        )}
        {canAlerts && (
          <KpiStatCard
            label={kpiLabels.alerts}
            value={alertsTotal == null ? '—' : fmtNum(alertsTotal)}
            icon={AlertTriangle}
            tone={alertsCritical > 0 ? 'danger' : 'brand'}
            iconColor={alertsCritical > 0 ? 'red' : 'orange'}
            loading={alertsLoading}
            interactive
            onClick={() => navigate(alertsPath)}
            trend={
              alertsCritical > 0
                ? { direction: 'up', label: `${alertsCritical} critical` }
                : undefined
            }
          />
        )}
        {canReports && (
          <KpiStatCard
            label={kpiLabels.trips}
            value={tripsToday == null ? '—' : fmtNum(tripsToday)}
            icon={Route}
            tone="brand"
            loading={summaryLoading}
            interactive={canViewTrips}
            onClick={canViewTrips ? () => navigate(tripsPath) : undefined}
          />
        )}
      </div>

      {showDesktopMap ? (
        <div className="ft-admin-main-split">
          <AdminDashboardMap
            live={live}
            loading={loading}
            statusCounts={statusCounts}
            onOpenMap={() => navigate(`${basePath}/map`)}
            onVehicleDetails={(id) => navigate(`${vehiclesPath}/${id}`)}
          />
          {trends}
        </div>
      ) : trends}

      <div className="ft-admin-dashboard-stack">
        {showOps && (
          <div className="ft-admin-ops">
            <h3 className="ft-admin-widget__title">{kpiLabels.glance}</h3>
            <div className="ft-admin-ops__grid">
              {canDrivers && (
                <div className="ft-admin-ops__card">
                  <div className="ft-admin-ops__card-label">
                    <Contact size={14} aria-hidden />
                    Drivers
                  </div>
                  <div className="ft-admin-ops__metrics">
                    <div className="ft-admin-ops__metric">
                      <span className="ft-admin-ops__metric-label">On trip</span>
                      <span className="ft-admin-ops__metric-value">
                        {summaryLoading ? '—' : fmtNum(adminSummary?.drivers_on_trip)}
                      </span>
                    </div>
                    <div className="ft-admin-ops__metric">
                      <span className="ft-admin-ops__metric-label">Available</span>
                      <span className="ft-admin-ops__metric-value">
                        {summaryLoading ? '—' : fmtNum(adminSummary?.drivers_available)}
                      </span>
                    </div>
                    <div className="ft-admin-ops__metric">
                      <span className="ft-admin-ops__metric-label">On leave</span>
                      <span className="ft-admin-ops__metric-value">
                        {summaryLoading ? '—' : fmtNum(adminSummary?.drivers_on_leave)}
                      </span>
                    </div>
                  </div>
                  <button
                    type="button"
                    className="ft-admin-ops__link"
                    onClick={() => navigate(driversPath)}
                  >
                    View drivers
                  </button>
                </div>
              )}

              {canReports && (
                <div className="ft-admin-ops__card">
                  <div className="ft-admin-ops__card-label">
                    <Wallet size={14} aria-hidden />
                    {kpiLabels.costSection}
                  </div>
                  <div className="ft-admin-ops__metrics">
                    <div className="ft-admin-ops__metric">
                      <span className="ft-admin-ops__metric-label">Fuel</span>
                      <span className="ft-admin-ops__metric-value">
                        {summaryLoading
                          ? '—'
                          : fmtPkrCompact(adminSummary?.trips_total_fuel_cost_pkr)}
                      </span>
                    </div>
                    <div className="ft-admin-ops__metric">
                      <span className="ft-admin-ops__metric-label">Toll</span>
                      <span className="ft-admin-ops__metric-value">
                        {summaryLoading
                          ? '—'
                          : fmtPkrCompact(adminSummary?.trips_total_toll_cost_pkr)}
                      </span>
                    </div>
                    <div className="ft-admin-ops__metric">
                      <span className="ft-admin-ops__metric-label">Challan</span>
                      <span className="ft-admin-ops__metric-value">
                        {summaryLoading
                          ? '—'
                          : fmtPkrCompact(adminSummary?.trips_total_challan_cost_pkr)}
                      </span>
                    </div>
                  </div>
                  {canViewTrips && (
                    <button
                      type="button"
                      className="ft-admin-ops__link"
                      onClick={() => navigate(tripsPath)}
                    >
                      View trips
                    </button>
                  )}
                </div>
              )}

              {canMaintenance && (
                <div className="ft-admin-ops__card">
                  <div className="ft-admin-ops__card-label">
                    <Wrench size={14} aria-hidden />
                    Maintenance
                  </div>
                  <div className="ft-admin-ops__metrics">
                    <div className="ft-admin-ops__metric">
                      <span className="ft-admin-ops__metric-label">Due</span>
                      <span className="ft-admin-ops__metric-value">
                        {summaryLoading ? '—' : fmtNum(maintenanceDue)}
                      </span>
                    </div>
                    <div className="ft-admin-ops__metric">
                      <span className="ft-admin-ops__metric-label">Overdue</span>
                      <span className="ft-admin-ops__metric-value">
                        {summaryLoading ? '—' : fmtNum(maintenanceOverdue)}
                      </span>
                    </div>
                    <div className="ft-admin-ops__metric">
                      <span className="ft-admin-ops__metric-label">YTD visits</span>
                      <span className="ft-admin-ops__metric-value">
                        {summaryLoading ? '—' : fmtNum(maintenanceYtd)}
                      </span>
                    </div>
                  </div>
                  <button
                    type="button"
                    className="ft-admin-ops__link"
                    onClick={() => navigate(maintenancePath)}
                  >
                    View maintenance
                  </button>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export default AdminDashboard
