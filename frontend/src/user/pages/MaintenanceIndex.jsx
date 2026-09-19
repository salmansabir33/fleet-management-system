import { lazy, Suspense, useMemo } from 'react'
import { Navigate, useNavigate, useOutletContext } from 'react-router-dom'
import {
  Wrench, Cog, Disc, Zap,
  Filter, Droplets, Wind,
} from 'lucide-react'
import { useTheme } from '../../theme'
import {
  LoadingState,
  EmptyState,
  MaintenanceBadge,
} from '../../shared/components'
import { fmtNumber } from '../components/MaintenanceRecordForm'
import { useMaintenanceVehicleId } from '../hooks/useMaintenanceVehicleId'
import AdminMaintenanceTimeline from '../../admin/components/AdminMaintenanceTimeline'
import '../../admin/styles/admin-maintenance-detail.css'

const DonutChart = lazy(() =>
  import('../../shared/components/DonutChart').then((mod) => ({ default: mod.DonutChart })),
)
const Sparkline = lazy(() =>
  import('../../shared/components/Sparkline').then((mod) => ({ default: mod.Sparkline })),
)
const MaintenanceSignalHistoryChart = lazy(() =>
  import('../components/MaintenanceSignalHistoryChart'),
)

const COMPONENT_ICONS = {
  engine: Cog,
  engine_oil: Droplets,
  air_filter: Filter,
  ac_filter: Wind,
  fuel_filter: Filter,
  tires: Disc,
  tyres: Disc,
  brakes: Disc,
  brake_pads: Disc,
  brake_fluid: Droplets,
  coolant: Droplets,
  gearbox: Cog,
  battery: Zap,
  spark_plugs: Zap,
  wiper_blades: Wind,
  wheel_alignment: Cog,
  default: Wrench,
}

const componentIcon = (key) => COMPONENT_ICONS[(key || '').toLowerCase()] || COMPONENT_ICONS.default

const formatRs = (n) => (n == null ? '—' : `Rs ${fmtNumber(n)}`)

const fmtVisitLabel = (iso) => {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return String(iso).slice(5)
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

const ChartFallback = ({ height = 148 }) => (
  <div style={{ height, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
    <LoadingState label="Loading chart…" />
  </div>
)

const MaintenanceIndex = () => {
  const { deviceId, paths, isUserShell } = useMaintenanceVehicleId()
  const {
    status: sharedStatus,
    statusLoading,
    records: sharedRecords,
    recordsLoading,
  } = useOutletContext() || {}
  const { tokens } = useTheme()
  const navigate = useNavigate()

  const status = sharedStatus
  const records = sharedRecords || []

  const loading = (statusLoading && !status) || (recordsLoading && !status && records.length === 0)

  const maintCounts = useMemo(() => {
    const counts = { ok: 0, due_soon: 0, overdue: 0, no_baseline: 0 }
    for (const item of status?.items || []) {
      if (item.status in counts) counts[item.status] += 1
    }
    return counts
  }, [status])

  const statusSegments = useMemo(() => ([
    { key: 'ok', label: 'OK', value: maintCounts.ok, color: tokens.semantic.success },
    { key: 'due_soon', label: 'Due soon', value: maintCounts.due_soon, color: tokens.semantic.warning },
    { key: 'overdue', label: 'Overdue', value: maintCounts.overdue, color: tokens.semantic.danger },
    { key: 'no_baseline', label: 'No data', value: maintCounts.no_baseline, color: tokens.textMuted },
  ]), [maintCounts, tokens])

  const signalData = useMemo(() => (
    [...records]
      .filter((r) => r.record_date && (r.odometer_km != null || r.engine_hours != null))
      .reverse()
      .map((r) => ({
        label: fmtVisitLabel(r.record_date),
        odometer: r.odometer_km != null ? Math.round(Number(r.odometer_km) * 10) / 10 : null,
        hours: r.engine_hours != null ? Math.round(Number(r.engine_hours) * 10) / 10 : null,
      }))
  ), [records])

  const costTotal = useMemo(
    () => records.reduce((sum, r) => sum + (r.total_cost || 0), 0),
    [records],
  )

  const costSegments = useMemo(() => {
    const byLabel = new Map()
    for (const rec of records) {
      for (const line of rec.lines || []) {
        const price = Number(line.price) || 0
        if (price <= 0) continue
        const label = line.label || 'Other'
        byLabel.set(label, (byLabel.get(label) || 0) + price)
      }
    }
    const ranked = [...byLabel.entries()].sort((a, b) => b[1] - a[1])
    const palette = [tokens.primary, tokens.semantic.warning, tokens.semantic.info]
    if (ranked.length === 0) {
      if (costTotal > 0) {
        return [{
          key: 'cost',
          label: `Cost (${formatRs(costTotal)})`,
          value: costTotal,
          color: tokens.semantic.warning,
        }]
      }
      return statusSegments.map((seg) => ({
        ...seg,
        label: `${seg.label} (${seg.value})`,
      }))
    }
    const top = ranked.slice(0, 2)
    const rest = ranked.slice(2).reduce((sum, [, v]) => sum + v, 0)
    const segs = top.map(([label, value], i) => ({
      key: `cost-${i}`,
      label: `${label} (${formatRs(value)})`,
      value,
      color: palette[i],
    }))
    if (rest > 0) {
      segs.push({
        key: 'other',
        label: `Other (${formatRs(rest)})`,
        value: rest,
        color: palette[2],
      })
    }
    return segs
  }, [records, costTotal, statusSegments, tokens])

  const partsOkCount = maintCounts.ok
  const partsTotal = (status?.items || []).length

  const avgProgressPct = useMemo(() => {
    const vals = (status?.items || [])
      .map((item) => (item.progress_pct != null ? Number(item.progress_pct) : null))
      .filter((v) => v != null)
    if (!vals.length) return 0
    const mean = vals.reduce((sum, v) => sum + v, 0) / vals.length
    return Math.round(Math.min(1, Math.max(0, mean)) * 100)
  }, [status])

  const healthSpark = useMemo(
    () => (status?.items || []).map((item) => (
      item.status === 'ok' ? 1 : item.status === 'due_soon' ? 0.55 : 0.15
    )),
    [status],
  )

  const progressSpark = useMemo(
    () => (status?.items || []).map((item) => (
      item.progress_pct != null ? Math.round(Number(item.progress_pct) * 100) : 0
    )),
    [status],
  )

  if (!deviceId) {
    if (isUserShell) {
      return (
        <EmptyState
          title="No vehicle assigned"
          description="This user does not have a vehicle yet."
        />
      )
    }
    return <Navigate to={paths.picker} replace />
  }
  if (loading || !status) return <LoadingState label="Loading maintenance…" />

  const items = status.items || []
  const highlightedKey = (
    items.find((item) => item.status === 'overdue')
    || items.find((item) => item.status === 'due_soon')
    || items[0]
  )?.item_id || items[0]?.key
  const openComponent = () => navigate(status.has_baseline ? paths.entry : paths.baseline)
  const donutTotal = costSegments.reduce((sum, s) => sum + (Number(s.value) || 0), 0)

  return (
    <div className="md-layout">
      <div className="md-main">
        <AdminMaintenanceTimeline items={items} records={records} />

        <div className="md-card">
          <h3 className="md-card-title">Components</h3>
          {items.length === 0 ? (
            <div className="md-empty">No maintenance components for this vehicle.</div>
          ) : (
            <div className="md-comp-grid">
              {items.map((item) => {
                const Icon = componentIcon(item.key)
                const active = (item.item_id || item.key) === highlightedKey
                return (
                  <button
                    key={item.item_id || item.key}
                    type="button"
                    className={`md-comp${active ? ' md-comp--active' : ''}`}
                    onClick={openComponent}
                  >
                    <span className="md-comp-icon">
                      <Icon size={18} />
                    </span>
                    <span className="md-comp-body">
                      <span className="md-comp-name">{item.label}</span>
                    </span>
                    <MaintenanceBadge status={item.status} />
                  </button>
                )
              })}
            </div>
          )}
        </div>
      </div>

      <div className="md-side">
        <div className="md-card">
          <h3 className="md-card-title">Cost detail</h3>
          <Suspense fallback={<ChartFallback />}>
            <DonutChart
              segments={costSegments}
              size={148}
              thickness={20}
              centerValue={donutTotal > 0 ? formatRs(donutTotal) : items.length}
              centerLabel={donutTotal > 0 ? 'Total' : 'Items'}
              emptyLabel="No cost yet"
              legendPosition="bottom"
              showPercentInLegend={false}
            />
          </Suspense>
        </div>

        <div className="md-card md-card--fill">
          <h3 className="md-card-title">Signal history</h3>
          <p className="md-chart-subtitle">
            Odometer and engine hours recorded at each service visit
          </p>
          {signalData.length === 0 ? (
            <div className="md-empty">No visit readings yet.</div>
          ) : (
            <div className="md-chart-body">
              <Suspense fallback={<ChartFallback height="100%" />}>
                <MaintenanceSignalHistoryChart data={signalData} />
              </Suspense>
            </div>
          )}

          <div className="md-signal-sparks">
            <div className="md-signal-spark">
              <div className="md-signal-spark-text">
                <span className="md-signal-spark-label" style={{ color: tokens.semantic.success }}>
                  Parts OK
                </span>
                <span className="md-signal-spark-value">{partsOkCount} of {partsTotal}</span>
                <span className="md-signal-spark-hint">Components in good shape</span>
              </div>
              <Suspense fallback={<div style={{ width: 88, height: 32 }} />}>
                <Sparkline
                  points={healthSpark}
                  color={tokens.semantic.success}
                  width={88}
                  height={32}
                />
              </Suspense>
            </div>
            <div className="md-signal-spark">
              <div className="md-signal-spark-text">
                <span className="md-signal-spark-label" style={{ color: tokens.semantic.warning }}>
                  Interval used
                </span>
                <span className="md-signal-spark-value">{avgProgressPct}%</span>
                <span className="md-signal-spark-hint">Wear through service interval</span>
              </div>
              <Suspense fallback={<div style={{ width: 88, height: 32 }} />}>
                <Sparkline
                  points={progressSpark}
                  color={tokens.semantic.warning}
                  width={88}
                  height={32}
                />
              </Suspense>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default MaintenanceIndex
