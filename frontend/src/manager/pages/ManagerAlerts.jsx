import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  ShieldAlert, AlertTriangle, Info as InfoIcon, Check, Clock, ChevronDown,
} from 'lucide-react'
import api from '../../api'
import { useTheme } from '../../theme'
import {
  Card,
  SeverityBadge,
  Button,
  FilterBar,
  Checkbox,
  EmptyState,
  LoadingState,
  AlertRow,
} from '../../shared/components'
import { MobilePageHeading } from '../../shared/shell'
import { MANAGER_NAV_LABELS } from '../navItems'
import DateRangeFilter from '../../user/components/DateRangeFilter'
import { defaultDateFilterValue, dateFilterToParams } from '../../user/utils/dateFilter'
import { usePanelScope } from '../hooks/usePanelScope'

const SEVERITY_ICONS = { critical: ShieldAlert, warning: AlertTriangle, info: InfoIcon }

const ALERT_TYPE_LABELS = {
  harsh_brake: 'Harsh braking',
  harsh_accel: 'Harsh acceleration',
  overspeed: 'Speeding',
  geofence_exit: 'Left geofence',
  silence: 'Device offline',
  driver_unassigned: 'Driver not assigned',
  trip_driver_pending_confirmation: 'Confirm trip driver',
  trip_route_pending_confirmation: 'Confirm trip route',
}

const timeAgo = (iso) => {
  const diffMs = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diffMs / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins} min ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs} hr ago`
  return `${Math.floor(hrs / 24)} d ago`
}

const ManagerAlerts = () => {
  const { tokens } = useTheme()
  const { apiFor, can } = usePanelScope()
  const [searchParams, setSearchParams] = useSearchParams()
  const [alerts, setAlerts] = useState([])
  const [loading, setLoading] = useState(true)
  const [dateFilter, setDateFilter] = useState(defaultDateFilterValue)
  const [expandedId, setExpandedId] = useState(null)

  const severityFilter = searchParams.get('severity') || 'all'
  const showResolved = searchParams.get('resolved') === 'true'

  useEffect(() => {
    if (!can('alerts_notifications')) {
      setLoading(false)
      return
    }
    let cancelled = false
    let isInitial = true
    const load = async () => {
      if (isInitial) setLoading(true)
      try {
        const params = {
          limit: 200,
          resolved: showResolved,
          ...dateFilterToParams(dateFilter, 'date'),
        }
        if (severityFilter !== 'all') params.severity = severityFilter
        const res = await api.get(apiFor('/alerts', '/api/alerts'), { params })
        if (!cancelled) setAlerts(res.data || [])
      } catch (err) {
        console.error('Failed to load alerts:', err)
      } finally {
        if (!cancelled) {
          setLoading(false)
          isInitial = false
        }
      }
    }
    load()
    const interval = setInterval(load, 10000)
    return () => { cancelled = true; clearInterval(interval) }
  }, [apiFor, can, severityFilter, showResolved, dateFilter])

  const resolveAlert = async (id) => {
    try {
      await api.patch(`/api/alerts/${id}/resolve`)
      setAlerts((prev) => prev.filter((a) => a.id !== id))
    } catch (err) {
      alert(err.response?.data?.detail || 'Failed to resolve alert')
    }
  }

  const setSeverity = (sev) => {
    const next = new URLSearchParams(searchParams)
    if (sev === 'all') next.delete('severity')
    else next.set('severity', sev)
    setSearchParams(next)
  }

  if (!can('alerts_notifications')) {
    return <EmptyState title="You don't have permission to view alerts." />
  }

  return (
    <div className="ft-page-stack">
      <MobilePageHeading>{MANAGER_NAV_LABELS.alerts}</MobilePageHeading>
      <DateRangeFilter value={dateFilter} onChange={setDateFilter} />

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center' }}>
        <FilterBar
          options={[
            { key: 'all', label: 'All' },
            { key: 'critical', label: 'Critical' },
            { key: 'warning', label: 'Warning' },
            { key: 'info', label: 'Info' },
          ]}
          value={severityFilter}
          onChange={setSeverity}
        />
        <div style={{ marginLeft: 'auto' }}>
          <Checkbox
            label="Show resolved"
            checked={showResolved}
            onChange={(e) => {
              const next = new URLSearchParams(searchParams)
              if (e.target.checked) next.set('resolved', 'true')
              else next.delete('resolved')
              setSearchParams(next)
            }}
          />
        </div>
      </div>

      {loading && alerts.length === 0 ? (
        <Card><LoadingState label="Loading alerts…" /></Card>
      ) : alerts.length === 0 ? (
        <Card>
          <EmptyState
            title={showResolved ? 'No resolved alerts' : 'No active alerts'}
            description={showResolved ? undefined : 'Workspace is quiet right now.'}
          />
        </Card>
      ) : (
        <div className="ft-alert-list">
          {alerts.map((a) => {
            const Icon = SEVERITY_ICONS[a.severity] || InfoIcon
            const expanded = expandedId === a.id
            return (
              <AlertRow
                key={a.id}
                severity={a.severity}
                icon={Icon}
                title={ALERT_TYPE_LABELS[a.alert_type] || a.alert_type}
                subtitle={a.message}
                timestamp={timeAgo(a.triggered_at)}
                badge={<SeverityBadge severity={a.severity} />}
                expanded={expanded}
                onClick={() => setExpandedId(expanded ? null : a.id)}
                trailing={(
                  <ChevronDown
                    size={18}
                    color={tokens.textMuted}
                    style={{
                      transform: expanded ? 'rotate(180deg)' : 'none',
                      transition: `transform ${tokens.motion.fast} ${tokens.motion.easing}`,
                    }}
                  />
                )}
              >
                <div style={{
                  display: 'flex',
                  gap: 12,
                  fontSize: 12,
                  color: tokens.textDisabled,
                  alignItems: 'center',
                  flexWrap: 'wrap',
                  paddingLeft: 44,
                }}
                >
                  <span>{a.device_name}{a.device_plate ? ` · ${a.device_plate}` : ''}</span>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                    <Clock size={12} />
                    {timeAgo(a.triggered_at)}
                  </span>
                  {!a.is_resolved && (
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={(e) => { e.stopPropagation(); resolveAlert(a.id) }}
                    >
                      <Check size={14} />
                      Resolve
                    </Button>
                  )}
                </div>
              </AlertRow>
            )
          })}
        </div>
      )}
    </div>
  )
}

export default ManagerAlerts
