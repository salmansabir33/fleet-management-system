import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  ShieldAlert, AlertTriangle, Info as InfoIcon,
} from 'lucide-react'
import { useTheme } from '../../../theme'
import {
  Card,
  Tabs,
  AlertRow,
  Badge,
  EmptyState,
  Skeleton,
} from '../../../shared/components'
import { usePanelScope } from '../../hooks/usePanelScope'
import { timeAgo } from '../../utils/dashboardFormatters'
import { ALERT_TYPE_LABELS } from '../../../admin/utils/notificationDisplayPrefs'

const SEVERITY_ICONS = {
  critical: ShieldAlert,
  warning: AlertTriangle,
  info: InfoIcon,
}

const SEVERITY_TABS = [
  { id: 'all', label: 'All' },
  { id: 'critical', label: 'Critical' },
  { id: 'warning', label: 'Warning' },
  { id: 'info', label: 'Info' },
]

const alertLabel = (alert) => (
  alert.message
  || ALERT_TYPE_LABELS[alert.alert_type]
  || alert.alert_type
  || 'Alert'
)

const DashboardAlertsCard = ({ alerts, alertSummary, canAlerts, loading = false }) => {
  const { tokens } = useTheme()
  const { basePath } = usePanelScope()
  const [tab, setTab] = useState('all')

  const todayAlerts = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10)
    return alerts.filter((a) => a.triggered_at?.startsWith(today))
  }, [alerts])

  const filtered = useMemo(() => {
    if (tab === 'all') return todayAlerts
    return todayAlerts.filter((a) => (a.severity || '').toLowerCase() === tab)
  }, [todayAlerts, tab])

  const tabItems = SEVERITY_TABS.map((item) => {
    const count = item.id === 'all'
      ? (alertSummary?.total ?? todayAlerts.length)
      : (alertSummary?.[item.id] ?? todayAlerts.filter((a) => a.severity === item.id).length)
    return {
      ...item,
      label: (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          {item.label}
          <Badge color={tokens.textSecondary} background={tokens.background}>
            {count}
          </Badge>
        </span>
      ),
    }
  })

  return (
    <Card
      badge={8}
      title="Alerts (Today)"
      right={(
        <Link
          to={`${basePath}/settings`}
          style={{ fontSize: 12, fontWeight: 600, color: tokens.primary, textDecoration: 'none' }}
        >
          View all alerts
        </Link>
      )}
    >
      <Tabs items={tabItems} value={tab} onChange={setTab} style={{ marginBottom: 12 }} />

      {!canAlerts ? (
        <EmptyState title="Not permitted" description="Alerts & notifications access is required." />
      ) : loading ? (
        <div aria-hidden style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {Array.from({ length: 5 }, (_, i) => (
            <Skeleton key={i} height={44} />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState title="No alerts today" description="No alerts match this severity filter." />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 320, overflowY: 'auto' }}>
          {filtered.slice(0, 8).map((alert, idx) => (
            <AlertRow
              key={alert.id ?? `${alert.alert_type}-${alert.triggered_at}-${idx}`}
              severity={alert.severity || 'info'}
              icon={SEVERITY_ICONS[alert.severity] || InfoIcon}
              title={alertLabel(alert)}
              subtitle={alert.vehicle_name || alert.device_name || undefined}
              timestamp={timeAgo(alert.triggered_at)}
            />
          ))}
        </div>
      )}
    </Card>
  )
}

export default DashboardAlertsCard
