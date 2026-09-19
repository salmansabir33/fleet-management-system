import { useEffect, useMemo, useRef, useState } from 'react'
import { Fuel, Route as RouteIcon } from 'lucide-react'
import api from '../../api'
import {
  Card,
  KpiStatCard,
  LineChartCard,
  EmptyState,
  StatusBadge,
} from '../../shared/components'
import { MobilePageHeading } from '../../shared/shell'
import { userNavLabel } from '../navItems'
import { useSelectedDevice } from '../context/SelectedDeviceContext'
import VehicleHeroArt from '../components/VehicleHeroArt'
import { deriveVehicleStatus } from '../utils/vehicleStatus'
import { vehiclePhotoSrc } from '../utils/vehiclePhoto'
import {
  fmtNum,
  formatSeconds,
} from '../utils/dashboardHelpers'

const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const LIVE_POLL_MS = 10000
const REPORT_POLL_MS = 30000
const TREND_POLL_MS = 60000

const localDateKey = (date) => {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

const Dashboard = () => {
  const { deviceId } = useSelectedDevice()
  const [report, setReport] = useState(null)
  const [trendPoints, setTrendPoints] = useState([])
  const [liveItem, setLiveItem] = useState(null)
  const [loading, setLoading] = useState(true)
  const reportTick = useRef(0)
  const trendTick = useRef(0)

  useEffect(() => {
    if (!deviceId) return undefined
    let cancelled = false
    reportTick.current = 0
    trendTick.current = 0

    const loadLive = async () => {
      const liveRes = await api.get('/api/live', {
        params: { db_id: deviceId, compact: true },
      })
      if (cancelled) return
      const match = (liveRes.data.live || []).find((v) => String(v.db_id) === String(deviceId))
      setLiveItem(match || null)
    }

    const loadReport = async () => {
      const reportRes = await api.get(`/api/vehicle-report/${deviceId}`, {
        params: { summary: true },
      })
      if (cancelled) return
      setReport(reportRes.data)
    }

    const loadTrend = async () => {
      const trendRes = await api.get(`/api/vehicle-report/${deviceId}/trend`, {
        params: { days: 7 },
      })
      if (cancelled) return
      setTrendPoints(trendRes.data?.points || [])
    }

    const loadInitial = async () => {
      try {
        await Promise.all([loadReport(), loadLive(), loadTrend()])
      } catch (err) {
        console.error('Failed to load dashboard:', err)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    loadInitial()

    // Live status updates often; report/trend less often (same UI fields).
    const interval = setInterval(async () => {
      reportTick.current += LIVE_POLL_MS
      trendTick.current += LIVE_POLL_MS
      try {
        const jobs = [loadLive()]
        if (reportTick.current >= REPORT_POLL_MS) {
          reportTick.current = 0
          jobs.push(loadReport())
        }
        if (trendTick.current >= TREND_POLL_MS) {
          trendTick.current = 0
          jobs.push(loadTrend())
        }
        await Promise.all(jobs)
      } catch (err) {
        console.error('Failed to refresh dashboard:', err)
      }
    }, LIVE_POLL_MS)

    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [deviceId])

  const status = liveItem ? deriveVehicleStatus(liveItem) : 'offline'
  const metrics = report?.report
  const device = report?.device
  const vehicleSrc = vehiclePhotoSrc(liveItem) || vehiclePhotoSrc(device)

  const fuelTodayLiters = useMemo(() => {
    if (metrics?.db_total_fuel_liters == null) return null
    return Number(metrics.db_total_fuel_liters)
  }, [metrics])

  const yesterdayDistance = useMemo(() => {
    const yesterday = new Date()
    yesterday.setHours(0, 0, 0, 0)
    yesterday.setDate(yesterday.getDate() - 1)
    const key = localDateKey(yesterday)
    const point = trendPoints.find((p) => p?.date === key)
    return point != null ? Number(point.distance_km) || 0 : 0
  }, [trendPoints])

  const distanceProgress = useMemo(() => {
    const today = metrics?.db_total_distance ?? 0
    const yesterday = yesterdayDistance
    const max = Math.max(today, yesterday * 1.25, 100)
    return { current: today, max, label: max > 0 ? `${Math.round((today / max) * 100)}% of weekly target` : undefined }
  }, [metrics, yesterdayDistance])

  // Rolling 7 days ending today (today always on the far right).
  const weeklyChartData = useMemo(() => {
    const byDate = new Map()
    for (const point of trendPoints) {
      if (!point?.date) continue
      byDate.set(point.date, Number(point.distance_km) || 0)
    }

    const now = new Date()
    now.setHours(0, 0, 0, 0)
    const todayKey = localDateKey(now)
    if (metrics?.db_total_distance != null) {
      byDate.set(todayKey, Number(metrics.db_total_distance) || 0)
    }

    const rows = []
    for (let offset = 6; offset >= 0; offset -= 1) {
      const day = new Date(now)
      day.setDate(now.getDate() - offset)
      const key = localDateKey(day)
      rows.push({
        label: WEEKDAY_LABELS[day.getDay()],
        value: byDate.get(key) ?? 0,
      })
    }
    return rows
  }, [trendPoints, metrics])

  const sparkline = useMemo(
    () => weeklyChartData.map((d) => d.value),
    [weeklyChartData],
  )

  const activityRows = useMemo(() => [
    {
      label: 'Current status',
      value: <StatusBadge status={status} />,
    },
    {
      label: 'Driving time',
      value: formatSeconds(metrics?.driving_time_seconds),
    },
    {
      label: 'Idle time',
      value: formatSeconds(metrics?.idle_time_seconds),
    },
    {
      label: 'Max speed',
      value: metrics?.max_speed_kmh != null ? `${fmtNum(metrics.max_speed_kmh, 0)} km/h` : '—',
    },
    {
      label: 'Fuel cost',
      value: metrics?.db_total_fuel_cost_pkr != null
        ? `PKR ${fmtNum(metrics.db_total_fuel_cost_pkr, 0)}`
        : '—',
    },
    {
      label: 'Stops',
      value: metrics?.stop_count != null ? String(metrics.stop_count) : '—',
    },
  ], [status, metrics])

  if (!deviceId) {
    return (
      <EmptyState
        title="No vehicle assigned"
        description="This user does not have a vehicle yet."
      />
    )
  }
  const initialLoad = loading && !report
  if (!initialLoad && !report) return <EmptyState title="No vehicle data available." />

  return (
    <div className="ft-page-stack">
      <MobilePageHeading>{userNavLabel('/user/dashboard')}</MobilePageHeading>
      <div className="ft-kpi-row">
        <KpiStatCard
          media={(
            <VehicleHeroArt
              size="thumb"
              vehicleType={device?.vehicle_type}
              src={vehicleSrc}
            />
          )}
          label="Vehicle Name"
          value={device?.name || '—'}
          tone="success"
          loading={initialLoad}
        />
        <KpiStatCard
          icon={Fuel}
          label="Fuel Consumption"
          value={fuelTodayLiters != null ? `${fmtNum(fuelTodayLiters, 1)} L` : '—'}
          tone="success"
          loading={initialLoad}
          sparkline={sparkline}
        />
        <KpiStatCard
          icon={RouteIcon}
          label="Today's Distance"
          value={metrics?.db_total_distance != null ? `${fmtNum(metrics.db_total_distance, 0)} km` : '—'}
          tone="brand"
          loading={initialLoad}
          progress={distanceProgress}
          sparkline={sparkline}
        />
      </div>

      <div className="ft-chart-row">
        <LineChartCard
          title="Distance — Last 7 Days"
          data={weeklyChartData}
          xKey="label"
          yKey="value"
          yFormatter={(v) => `${v} km`}
          loading={initialLoad}
          height={240}
          showDots={false}
        />
        <Card title="Today's Activity" loading={initialLoad} skeletonLines={6}>
          <div className="ft-activity-list">
            {activityRows.map((row) => (
              <div key={row.label} className="ft-activity-row">
                <span className="ft-activity-label">{row.label}</span>
                <span className="ft-activity-value">{row.value}</span>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  )
}

export default Dashboard
