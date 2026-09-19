import { useEffect, useMemo, useState } from 'react'
import { Navigate, useOutletContext } from 'react-router-dom'
import { Wrench, Gauge, Clock } from 'lucide-react'
import { useTheme } from '../../theme'
import {
  Card,
  StatCard,
  Button,
  Tabs,
  LoadingState,
  EmptyState,
  MaintenanceBadge,
} from '../../shared/components'
import { RecordForm, BaselineOdometerFields, fmtNumber } from '../components/MaintenanceRecordForm'
import { useMaintenanceVehicleId } from '../hooks/useMaintenanceVehicleId'
import MaintenanceGantt from '../components/MaintenanceGantt'

const BASELINE_TABS = [
  { id: 'schedule', label: 'Schedule' },
  { id: 'calendar', label: 'Calendar' },
]

const MaintenanceBaseline = () => {
  const { deviceId, paths, isUserShell } = useMaintenanceVehicleId()
  const {
    refreshToken,
    refreshMaintenance,
    status: sharedStatus,
    statusLoading,
  } = useOutletContext() || {}
  const { tokens } = useTheme()
  const [showBaselineForm, setShowBaselineForm] = useState(false)
  const [viewTab, setViewTab] = useState('schedule')

  const status = sharedStatus
  const loading = statusLoading && !status

  useEffect(() => {
    setShowBaselineForm(false)
  }, [deviceId, refreshToken])

  const handleSubmitted = () => {
    refreshMaintenance?.()
  }

  const scheduleItems = useMemo(() => status?.items || [], [status])

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
  if (loading && !status) return <LoadingState label="Loading maintenance…" />
  if (!status) return <EmptyState title="Could not load maintenance data." />
  if (status.has_baseline) return <Navigate to={paths.report} replace />

  const recordFormInput = {
    odometer_km: status.odometer_km ?? '',
    engine_hours: status.engine_hours ?? '',
  }

  return (
    <div className="ft-page-stack">
      {!showBaselineForm && (
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <Button onClick={() => setShowBaselineForm(true)}>
            <Wrench size={15} />
            Add Baseline Maintenance
          </Button>
        </div>
      )}

      {!showBaselineForm ? (
        <Card
          title="Maintenance Schedule"
          right={(
            <Tabs
              items={BASELINE_TABS}
              value={viewTab}
              onChange={setViewTab}
            />
          )}
        >
          <p style={{
            fontSize: 13,
            color: tokens.textMuted,
            marginTop: 0,
            marginBottom: 16,
            lineHeight: 1.5,
          }}
          >
            Before we can track maintenance for this vehicle, tell us what&apos;s in it right now —
            today&apos;s odometer/engine hours, and what&apos;s currently in the vehicle and when it was
            last done.
          </p>

          {viewTab === 'calendar' ? (
            <MaintenanceGantt items={scheduleItems} />
          ) : scheduleItems.length === 0 ? (
            <EmptyState
              title="No scheduled items yet"
              description="Add baseline maintenance to see the schedule timeline."
              style={{ padding: '16px 0' }}
            />
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {scheduleItems.map((item) => {
                const pct = Math.min(100, Math.max(0, item.progress_pct || 0))
                const barColor = item.status === 'overdue'
                  ? tokens.maintenanceState.overdue
                  : item.status === 'due_soon'
                    ? tokens.maintenanceState.dueSoon
                    : tokens.maintenanceState.ok
                return (
                  <div key={item.item_id || item.key}>
                    <div style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      marginBottom: 6,
                      gap: 12,
                    }}
                    >
                      <span style={{ fontSize: 13, fontWeight: 700, color: tokens.text }}>
                        {item.label}
                      </span>
                      <MaintenanceBadge status={item.status} />
                    </div>
                    <div style={{
                      height: 28,
                      borderRadius: tokens.radius.sm,
                      background: tokens.background,
                      border: `1px solid ${tokens.border}`,
                      overflow: 'hidden',
                      position: 'relative',
                    }}
                    >
                      <div style={{
                        width: `${pct}%`,
                        height: '100%',
                        background: `color-mix(in srgb, ${barColor} 35%, transparent)`,
                        borderRight: pct > 0 ? `2px solid ${barColor}` : 'none',
                        transition: `width ${tokens.motion.normal} ${tokens.motion.easing}`,
                      }}
                      />
                      <span style={{
                        position: 'absolute',
                        left: 10,
                        top: '50%',
                        transform: 'translateY(-50%)',
                        fontSize: 11,
                        fontWeight: 600,
                        color: tokens.textSecondary,
                      }}
                      >
                        {item.interval_value != null
                          ? `Every ${fmtNumber(item.interval_value)} ${item.dimension === 'engine_hours' ? 'hrs' : 'km'}`
                          : 'Interval not set'}
                      </span>
                    </div>
                  </div>
                )
              })}
            </div>
          )}

          <div style={{ marginTop: 16 }}>
            <Button onClick={() => setShowBaselineForm(true)}>
              <Wrench size={15} />
              Add Baseline Maintenance
            </Button>
          </div>
        </Card>
      ) : (
        <>
          <div className="md-current-readings">
            <StatCard size="sm" icon={Clock} label="Date" value={status.today || '—'} tone="brand" />
            <StatCard
              size="sm"
              icon={Gauge}
              label="Odometer"
              value={status.odometer_km != null ? `${fmtNumber(status.odometer_km)} km` : '—'}
              tone="info"
            />
            <StatCard
              size="sm"
              icon={Wrench}
              label="Engine Hours"
              value={status.engine_hours != null ? `${fmtNumber(status.engine_hours)} hrs` : '—'}
              tone="warning"
            />
          </div>

          <Card title="Add Baseline Maintenance">
            <BaselineOdometerFields
              value={recordFormInput}
              odometerFromGps={status.odometer_km}
            >
              {(form) => (
                <RecordForm
                  deviceId={deviceId}
                  items={status.items}
                  isBaseline
                  recordDate={form}
                  onSubmitted={handleSubmitted}
                />
              )}
            </BaselineOdometerFields>
          </Card>
        </>
      )}
    </div>
  )
}

export default MaintenanceBaseline
