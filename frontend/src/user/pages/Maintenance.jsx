import { lazy, Suspense, useMemo } from 'react'
import { Navigate, useOutletContext } from 'react-router-dom'
import { Wrench, Gauge, Clock, AlertTriangle, DollarSign } from 'lucide-react'
import { useTheme } from '../../theme'
import {
  Card,
  StatCard,
  LoadingState,
  EmptyState,
} from '../../shared/components'
import { RecordForm, BaselineOdometerFields, fmtNumber } from '../components/MaintenanceRecordForm'
import { useMaintenanceVehicleId } from '../hooks/useMaintenanceVehicleId'

const LineChartCard = lazy(() =>
  import('../../shared/components/LineChartCard').then((mod) => ({ default: mod.LineChartCard })),
)

const Maintenance = () => {
  const { deviceId, paths, isUserShell } = useMaintenanceVehicleId()
  const {
    refreshMaintenance,
    status: sharedStatus,
    statusLoading,
    records: sharedRecords,
    recordsLoading,
  } = useOutletContext() || {}
  const { tokens } = useTheme()

  const status = sharedStatus
  const recentRecords = useMemo(
    () => (sharedRecords || []).slice(0, 3),
    [sharedRecords],
  )

  const handleSubmitted = () => {
    refreshMaintenance?.()
  }

  const maintCounts = useMemo(() => {
    const counts = { due_soon: 0, overdue: 0 }
    for (const item of status?.items || []) {
      if (item.status in counts) counts[item.status] += 1
    }
    return counts
  }, [status])

  const costChartData = useMemo(() => {
    return recentRecords.map((r) => ({
      label: r.record_date?.slice(5) || '—',
      value: r.total_cost || 0,
    }))
  }, [recentRecords])

  const costTotal = useMemo(
    () => recentRecords.reduce((sum, r) => sum + (r.total_cost || 0), 0),
    [recentRecords],
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
  if ((statusLoading && !status) || (recordsLoading && !status)) {
    return <LoadingState label="Loading maintenance…" />
  }
  if (!status) return <EmptyState title="Could not load maintenance data." />
  if (!status.has_baseline) return <Navigate to={paths.baseline} replace />

  const recordFormInput = {
    odometer_km: status.odometer_km ?? '',
    engine_hours: status.engine_hours ?? '',
  }

  return (
    <div className="ft-page-stack">
      <div className="md-summary-stats">
        <StatCard
          size="sm"
          icon={Wrench}
          label="Upcoming Maintenance"
          value={String(maintCounts.due_soon)}
          tone="warning"
        />
        <StatCard
          size="sm"
          icon={AlertTriangle}
          label="Overdue Maintenance"
          value={String(maintCounts.overdue)}
          tone="danger"
        />
        <StatCard
          size="sm"
          icon={DollarSign}
          label="Recent Visit Cost"
          value={costTotal > 0 ? `Rs ${fmtNumber(costTotal)}` : '—'}
          tone="brand"
          iconColor="purple"
        />
      </div>

      <div className="ft-cols-2" style={{
        display: 'grid',
        gridTemplateColumns: '1fr 1fr',
        gap: 16,
      }}
      >
        <Suspense
          fallback={(
            <Card title="Recent Maintenance Cost">
              <LoadingState label="Loading chart…" />
            </Card>
          )}
        >
          <LineChartCard
            title="Recent Maintenance Cost"
            data={costChartData}
            xKey="label"
            yKey="value"
            yFormatter={(v) => `Rs ${v}`}
            height={200}
          />
        </Suspense>
        <Card title="Current Readings">
          <div className="md-current-readings">
            <StatCard
              size="sm"
              icon={Clock}
              label="Date"
              value={status.today || new Date().toISOString().slice(0, 10)}
              tone="brand"
              style={{ boxShadow: 'none', border: `1px solid ${tokens.border}` }}
            />
            <StatCard
              size="sm"
              icon={Gauge}
              label="Odometer"
              value={status.odometer_km != null ? `${fmtNumber(status.odometer_km)} km` : '—'}
              tone="info"
              style={{ boxShadow: 'none', border: `1px solid ${tokens.border}` }}
            />
            <StatCard
              size="sm"
              icon={Wrench}
              label="Engine Hours"
              value={status.engine_hours != null ? `${fmtNumber(status.engine_hours)} hrs` : '—'}
              tone="warning"
              style={{ boxShadow: 'none', border: `1px solid ${tokens.border}` }}
            />
          </div>
        </Card>
      </div>

      <Card title="Add Maintenance Record">
        <BaselineOdometerFields value={recordFormInput} odometerFromGps={status.odometer_km}>
          {(form) => (
            <RecordForm
              deviceId={deviceId}
              items={status.items}
              isBaseline={false}
              recordDate={form}
              onSubmitted={handleSubmitted}
            />
          )}
        </BaselineOdometerFields>
      </Card>

      <Card title="Recent records">
        {recentRecords.length === 0 ? (
          <EmptyState title="No maintenance records yet." style={{ padding: '12px 0' }} />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {recentRecords.map((r) => (
              <div
                key={r.id}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  fontSize: 13,
                  padding: '10px 4px',
                  borderBottom: `1px solid ${tokens.border}`,
                }}
              >
                <span style={{ color: tokens.text, fontWeight: 600 }}>
                  {r.record_date}{r.is_baseline ? ' · Baseline' : ''}
                </span>
                <span style={{ color: tokens.textMuted }}>
                  {r.total_cost != null ? `Rs ${fmtNumber(r.total_cost)}` : '—'}
                </span>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  )
}

export default Maintenance
