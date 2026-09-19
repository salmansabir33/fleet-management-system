import { startTransition, useEffect, useMemo, useState } from 'react'
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
import { userNavLabel } from '../navItems'
import DateRangeFilter from '../components/DateRangeFilter'
import { useSelectedDevice } from '../context/SelectedDeviceContext'
import { useCurrentUser } from '../context/CurrentUserContext'
import { defaultDateFilterValue, dateFilterToParams } from '../utils/dateFilter'
import {
  ALERT_TYPE_LABELS,
  isAlertTypeDisplayed,
} from '../../admin/utils/notificationDisplayPrefs'

const SEVERITY_ICONS = { critical: ShieldAlert, warning: AlertTriangle, info: InfoIcon }
const ALERTS_POLL_MS = 15000
const ALERTS_CACHE_MAX = 16

const alertsCache = new Map()
let alertTypesCache = null
let alertTypesInflight = null

const alertsCacheKey = (deviceId, severity, resolved, dateFilter) => {
  let datePart = ''
  if (resolved) {
    datePart = dateFilter.mode === 'range'
      ? `${dateFilter.rangeStart}|${dateFilter.rangeEnd}`
      : String(dateFilter.date || '')
  }
  return `${deviceId}|${severity}|${resolved ? '1' : '0'}|${datePart}`
}

const getCachedAlerts = (key) => alertsCache.get(key)

const setCachedAlerts = (key, value) => {
  if (alertsCache.has(key)) alertsCache.delete(key)
  alertsCache.set(key, value)
  while (alertsCache.size > ALERTS_CACHE_MAX) {
    const oldest = alertsCache.keys().next().value
    alertsCache.delete(oldest)
  }
}

const patchCachedAlerts = (updater) => {
  for (const [key, list] of alertsCache.entries()) {
    if (!Array.isArray(list)) continue
    const next = updater(list)
    if (next !== list) alertsCache.set(key, next)
  }
}

const loadEnabledAlertTypes = () => {
  if (alertTypesCache) return Promise.resolve(alertTypesCache)
  if (alertTypesInflight) return alertTypesInflight
  alertTypesInflight = api.get('/api/settings/alert-types')
    .then((res) => {
      const enabled = {}
      for (const row of res.data || []) {
        enabled[row.alert_type] = row.is_enabled !== false
      }
      alertTypesCache = enabled
      return enabled
    })
    .catch(() => {
      if (!alertTypesCache) alertTypesCache = {}
      return alertTypesCache
    })
    .finally(() => {
      alertTypesInflight = null
    })
  return alertTypesInflight
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

const alertTitle = (alertType) => (
  ALERT_TYPE_LABELS[alertType]
  || String(alertType || '').replace(/[._:]/g, ' ')
)

const Alerts = () => {
  const { deviceId } = useSelectedDevice()
  const { tokens } = useTheme()
  const { notificationPrefs } = useCurrentUser()
  const [searchParams, setSearchParams] = useSearchParams()
  const [alerts, setAlerts] = useState([])
  const [enabledTypes, setEnabledTypes] = useState(() => alertTypesCache)
  const [loading, setLoading] = useState(true)
  const [dateFilter, setDateFilter] = useState(defaultDateFilterValue)
  const [expandedId, setExpandedId] = useState(null)

  const severityFilter = searchParams.get('severity') || 'all'
  const showResolved = searchParams.get('resolved') === 'true'

  useEffect(() => {
    let cancelled = false
    loadEnabledAlertTypes().then((enabled) => {
      if (!cancelled) setEnabledTypes(enabled)
    })
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    if (!deviceId) {
      setAlerts([])
      setLoading(false)
      return undefined
    }

    const cacheKey = alertsCacheKey(deviceId, severityFilter, showResolved, dateFilter)
    const cached = getCachedAlerts(cacheKey)
    if (cached) {
      setAlerts(cached)
      setLoading(false)
    } else {
      setLoading(true)
    }

    let cancelled = false
    let isInitial = true
    let controller = null

    const load = async () => {
      if (isInitial && !cached) setLoading(true)
      controller?.abort()
      controller = new AbortController()
      const { signal } = controller
      try {
        const params = {
          limit: 200,
          device_id: deviceId,
          resolved: showResolved,
          ...(showResolved ? dateFilterToParams(dateFilter, 'date') : {}),
        }
        if (severityFilter !== 'all') params.severity = severityFilter
        const res = await api.get('/api/alerts', { params, signal })
        if (cancelled || signal.aborted) return
        const next = res.data || []
        setCachedAlerts(cacheKey, next)
        startTransition(() => setAlerts(next))
      } catch (err) {
        if (
          cancelled
          || signal.aborted
          || err?.code === 'ERR_CANCELED'
          || err?.name === 'CanceledError'
          || err?.name === 'AbortError'
        ) {
          return
        }
        console.error('Failed to load alerts:', err)
      } finally {
        if (!cancelled && !signal.aborted) {
          setLoading(false)
          isInitial = false
        }
      }
    }

    load()
    const interval = setInterval(load, ALERTS_POLL_MS)
    return () => {
      cancelled = true
      controller?.abort()
      clearInterval(interval)
    }
  }, [deviceId, severityFilter, showResolved, dateFilter])

  const visibleAlerts = useMemo(
    () => alerts.filter((alert) => {
      if (enabledTypes && enabledTypes[alert.alert_type] === false) return false
      return isAlertTypeDisplayed(alert.alert_type, notificationPrefs)
    }),
    [alerts, enabledTypes, notificationPrefs],
  )

  const resolveAlert = async (id) => {
    try {
      await api.patch(`/api/alerts/${id}/resolve`)
      setAlerts((prev) => prev.filter((a) => a.id !== id))
      patchCachedAlerts((list) => {
        const next = list.filter((a) => a.id !== id)
        return next.length === list.length ? list : next
      })
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

  if (!deviceId) {
    return (
      <EmptyState
        title="No vehicle assigned"
        description="This user does not have a vehicle yet."
      />
    )
  }

  return (
    <div className="ft-page-stack">
      <MobilePageHeading>{userNavLabel('/user/alerts')}</MobilePageHeading>
      {showResolved && (
        <DateRangeFilter value={dateFilter} onChange={setDateFilter} />
      )}

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
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginLeft: 'auto' }}>
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
      ) : visibleAlerts.length === 0 ? (
        <Card>
          <EmptyState
            title={showResolved ? 'No resolved alerts' : 'No active alerts'}
            description={showResolved ? undefined : 'Fleet is quiet for this vehicle.'}
          />
        </Card>
      ) : (
        <div className="ft-alert-list">
          {visibleAlerts.map((a) => {
            const Icon = SEVERITY_ICONS[a.severity] || InfoIcon
            const expanded = expandedId === a.id
            return (
              <AlertRow
                key={a.id}
                severity={a.severity}
                icon={Icon}
                title={alertTitle(a.alert_type)}
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

export default Alerts
