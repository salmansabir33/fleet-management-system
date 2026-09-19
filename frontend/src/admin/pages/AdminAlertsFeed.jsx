import { useEffect, useState } from 'react'
import {
  ShieldAlert, AlertTriangle, Info as InfoIcon, Check,
} from 'lucide-react'
import api from '../../api'
import { useTheme } from '../../theme'
import { hexToRgba } from '../../shared/utils'
import {
  AlertRow,
  Badge,
  Button,
  Card,
  Checkbox,
  EmptyState,
  LoadingState,
  Table,
  TableRow,
} from '../../shared/components'
import { ALERT_TYPE_LABELS } from '../utils/notificationDisplayPrefs'

const MOBILE_MQ = '(max-width: 820px)'
const SEVERITY_ICONS = { critical: ShieldAlert, warning: AlertTriangle, info: InfoIcon }

const formatAlertTimestamp = (iso) => {
  const d = new Date(iso)
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  const time = d.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  })
  return `${month}-${day}, ${time}`
}

function useIsMobile() {
  const [isMobile, setIsMobile] = useState(() => (
    typeof window !== 'undefined' ? window.matchMedia(MOBILE_MQ).matches : false
  ))

  useEffect(() => {
    const mq = window.matchMedia(MOBILE_MQ)
    const sync = () => setIsMobile(mq.matches)
    sync()
    mq.addEventListener('change', sync)
    return () => mq.removeEventListener('change', sync)
  }, [])

  return isMobile
}

function AlertTypeBadge({ alertType, severity }) {
  const { tokens } = useTheme()
  const color = tokens.alertSeverity[severity] || tokens.textMuted
  const label = ALERT_TYPE_LABELS[alertType] || alertType.replace(/_/g, ' ')
  return (
    <Badge color={color} background={hexToRgba(color, 0.14)} pill>
      {label}
    </Badge>
  )
}

function alertTitle(alert) {
  return ALERT_TYPE_LABELS[alert.alert_type] || alert.alert_type.replace(/_/g, ' ')
}

function vehicleLabel(alert) {
  return [alert.device_name, alert.device_plate].filter(Boolean).join(' · ')
}

function ResolveControl({ alert, resolvingId, onResolve }) {
  const { tokens } = useTheme()
  if (alert.is_resolved) {
    return <span style={{ fontSize: 12, color: tokens.textDisabled }}>Resolved</span>
  }
  return (
    <Button
      variant="secondary"
      size="sm"
      loading={resolvingId === alert.id}
      onClick={(event) => {
        event.stopPropagation()
        onResolve(alert.id)
      }}
    >
      <Check size={13} />
      {resolvingId === alert.id ? 'Resolving…' : 'Resolve'}
    </Button>
  )
}

const AdminAlertsFeed = () => {
  const { tokens } = useTheme()
  const isMobile = useIsMobile()
  const [alerts, setAlerts] = useState([])
  const [loading, setLoading] = useState(true)
  const [showResolved, setShowResolved] = useState(false)
  const [resolvingId, setResolvingId] = useState(null)

  useEffect(() => {
    let cancelled = false
    let isInitial = true

    const load = async () => {
      if (isInitial) setLoading(true)
      try {
        const res = await api.get('/api/alerts', {
          params: { limit: 200, resolved: showResolved },
        })
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
    const interval = setInterval(load, 15000)
    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [showResolved])

  const resolveAlert = async (id) => {
    setResolvingId(id)
    try {
      await api.patch(`/api/alerts/${id}/resolve`)
      setAlerts((prev) => prev.filter((a) => a.id !== id))
    } catch (err) {
      alert(err.response?.data?.detail || 'Failed to resolve alert')
    } finally {
      setResolvingId(null)
    }
  }

  const renderAlerts = () => {
    if (loading) return <LoadingState label="Loading alerts…" />
    if (alerts.length === 0) {
      return (
        <EmptyState
          title={showResolved ? 'No resolved alerts' : 'No active alerts'}
          description={showResolved ? undefined : 'The fleet is quiet right now.'}
        />
      )
    }

    if (isMobile) {
      return (
        <div className="ft-admin-alerts-mobile-panel">
          <div className="ft-admin-alerts-mobile-list">
            {alerts.map((alert) => {
              const Icon = SEVERITY_ICONS[alert.severity] || InfoIcon
              const vehicle = vehicleLabel(alert)
              return (
                <AlertRow
                  key={alert.id}
                  className="ft-admin-alert-row"
                  severity={alert.severity}
                  icon={Icon}
                  title={alertTitle(alert)}
                  subtitle={alert.message}
                  badge={vehicle ? (
                    <span className="ft-admin-alert-row__vehicle">{vehicle}</span>
                  ) : null}
                  expanded
                  style={{ opacity: alert.is_resolved ? 0.72 : 1 }}
                >
                  <div className="ft-admin-alert-row__footer">
                    <span className="ft-admin-alert-row__time">
                      {formatAlertTimestamp(alert.triggered_at)}
                    </span>
                    <ResolveControl
                      alert={alert}
                      resolvingId={resolvingId}
                      onResolve={resolveAlert}
                    />
                  </div>
                </AlertRow>
              )
            })}
          </div>
        </div>
      )
    }

    return (
      <div className="ft-admin-alerts-table__panel ft-admin-scroll-panel">
        <Table
          className="ft-table--comfortable"
          columns={[
            { key: 'alert', label: 'Vehicle alert' },
            { key: 'severity', label: 'Severity' },
            { key: 'timestamp', label: 'Timestamp' },
            { key: 'actions', label: '', align: 'right' },
          ]}
        >
          {alerts.map((alert) => {
            const Icon = SEVERITY_ICONS[alert.severity] || InfoIcon
            const color = tokens.alertSeverity[alert.severity] || tokens.alertSeverity.info
            const vehicle = vehicleLabel(alert)

            return (
              <TableRow key={alert.id} style={{ opacity: alert.is_resolved ? 0.72 : 1 }}>
                <td>
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                    <div
                      style={{
                        width: 32,
                        height: 32,
                        borderRadius: '50%',
                        background: hexToRgba(color, 0.14),
                        color,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        flexShrink: 0,
                      }}
                    >
                      <Icon size={16} />
                    </div>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: tokens.text }}>
                        {alertTitle(alert)}
                      </div>
                      <div style={{ fontSize: 12, color: tokens.textMuted, marginTop: 2, lineHeight: 1.35 }}>
                        {alert.message}
                      </div>
                      {vehicle && (
                        <div style={{ fontSize: 11, color: tokens.textDisabled, marginTop: 4 }}>
                          {vehicle}
                        </div>
                      )}
                    </div>
                  </div>
                </td>
                <td>
                  <AlertTypeBadge alertType={alert.alert_type} severity={alert.severity} />
                </td>
                <td style={{ color: tokens.textMuted, whiteSpace: 'nowrap' }}>
                  {formatAlertTimestamp(alert.triggered_at)}
                </td>
                <td>
                  <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                    <ResolveControl
                      alert={alert}
                      resolvingId={resolvingId}
                      onResolve={resolveAlert}
                    />
                  </div>
                </td>
              </TableRow>
            )
          })}
        </Table>
      </div>
    )
  }

  return (
    <Card
      className="ft-admin-alerts-feed-card"
      title="Fleet alerts"
      right={(
        <Checkbox
          label="Show resolved"
          checked={showResolved}
          onChange={(e) => setShowResolved(e.target.checked)}
        />
      )}
    >
      {renderAlerts()}
    </Card>
  )
}

export default AdminAlertsFeed
