import { useEffect, useMemo, useRef, useState } from 'react'
import { Bell } from 'lucide-react'
import api from '../../api'
import { useTheme } from '../../theme'
import { hexToRgba } from '../../shared/utils'
import {
  Switch,
  LoadingState,
  EmptyState,
} from '../../shared/components'
import { ALERT_TYPE_LABELS } from '../../admin/utils/notificationDisplayPrefs'
import {
  readManagerNotificationPrefs,
  writeManagerNotificationPrefs,
} from '../utils/managerPreferences'
import '../../admin/styles/admin-settings.css'

const ManagerNotificationSettings = ({ managerId }) => {
  const { tokens } = useTheme()
  const [types, setTypes] = useState([])
  const [prefs, setPrefs] = useState({})
  const [loading, setLoading] = useState(true)
  const [savingKey, setSavingKey] = useState(null)
  const [error, setError] = useState(null)
  const [saved, setSaved] = useState(false)
  const savedTimer = useRef(null)

  useEffect(() => () => {
    if (savedTimer.current) window.clearTimeout(savedTimer.current)
  }, [])

  useEffect(() => {
    if (!managerId) {
      setLoading(false)
      return undefined
    }
    let cancelled = false
    const load = async () => {
      setLoading(true)
      setError(null)
      try {
        const [typesRes, prefsRes] = await Promise.all([
          api.get('/api/settings/alert-types'),
          api.get(`/api/managers/${managerId}/notification-prefs`),
        ])
        if (cancelled) return
        const offered = (typesRes.data || []).filter((row) => row.offered_to_managers !== false)
        const fromApi = prefsRes.data?.notification_prefs || {}
        const local = readManagerNotificationPrefs(managerId)
        const next = { ...local, ...fromApi }
        setTypes(offered)
        setPrefs(next)
        writeManagerNotificationPrefs(managerId, next)
      } catch (err) {
        if (cancelled) return
        console.error('Failed to load notification preferences:', err)
        setTypes(Object.keys(ALERT_TYPE_LABELS).map((alert_type) => ({ alert_type })))
        setPrefs(readManagerNotificationPrefs(managerId))
        setError(err.response?.data?.detail || 'Could not load saved preferences. Showing this browser only.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [managerId])

  const offeredKeys = useMemo(
    () => types.map((row) => row.alert_type),
    [types],
  )
  const anyOn = offeredKeys.some((key) => prefs[key] !== false)
  const allOn = offeredKeys.length > 0 && offeredKeys.every((key) => prefs[key] !== false)

  const persist = async (next, key = 'all') => {
    const previous = prefs
    setPrefs(next)
    setError(null)
    setSaved(false)
    setSavingKey(key)
    writeManagerNotificationPrefs(managerId, next)
    try {
      const payload = Object.fromEntries(offeredKeys.map((alertType) => [
        alertType,
        next[alertType] !== false,
      ]))
      const res = await api.patch(`/api/managers/${managerId}/notification-prefs`, {
        notification_prefs: payload,
      })
      const savedPrefs = res.data?.notification_prefs
      if (savedPrefs && typeof savedPrefs === 'object') {
        setPrefs(savedPrefs)
        writeManagerNotificationPrefs(managerId, savedPrefs)
      }
      setSaved(true)
      if (savedTimer.current) window.clearTimeout(savedTimer.current)
      savedTimer.current = window.setTimeout(() => setSaved(false), 2500)
    } catch (err) {
      console.error('Failed to save notification preferences:', err)
      setPrefs(previous)
      writeManagerNotificationPrefs(managerId, previous)
      setError(err.response?.data?.detail || 'Failed to save notification preferences')
    } finally {
      setSavingKey(null)
    }
  }

  const handleToggle = (alertType, enabled) => {
    persist({ ...prefs, [alertType]: enabled }, alertType)
  }

  const handleMasterToggle = (enabled) => {
    persist(
      Object.fromEntries(offeredKeys.map((alertType) => [alertType, enabled])),
      'all',
    )
  }

  if (loading) {
    return <LoadingState label="Loading notification preferences…" />
  }

  return (
    <div>
      <p className="ft-admin-settings-card-hint">
        Turn manager portal notifications on or off. These switches control the
        bell in the top bar. Changes are saved automatically.
      </p>

      {error && (
        <div
          className="ft-admin-settings-error"
          style={{
            background: hexToRgba(tokens.semantic.danger, 0.12),
            color: tokens.semantic.danger,
          }}
        >
          {error}
        </div>
      )}

      {types.length === 0 ? (
        <EmptyState title="No notification types are available for your account." />
      ) : (
        <div className="ft-settings-switch-list" style={{ maxHeight: 'none' }}>
          <div className="ft-settings-switch-row">
            <div className="ft-settings-switch-copy">
              <div className="ft-settings-switch-label" style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                <Bell size={14} color={tokens.primary} />
                All portal notifications
              </div>
              <div className="ft-settings-switch-desc">
                {allOn
                  ? 'Every available alert type is on.'
                  : anyOn
                    ? 'Some alert types are off.'
                    : 'The notification bell will stay quiet.'}
              </div>
            </div>
            <div className="ft-settings-switch-control">
              <span className={`ft-settings-switch-state${anyOn ? ' is-on' : ''}`}>
                {anyOn ? 'On' : 'Off'}
              </span>
              <Switch
                checked={anyOn}
                disabled={savingKey != null}
                onChange={(event) => handleMasterToggle(event.target.checked)}
                aria-label="Toggle all manager portal notifications"
              />
            </div>
          </div>

          {types.map((row) => {
            const enabled = prefs[row.alert_type] !== false
            const label = ALERT_TYPE_LABELS[row.alert_type] || row.alert_type
            return (
              <div key={row.alert_type} className="ft-settings-switch-row">
                <div className="ft-settings-switch-copy">
                  <div className="ft-settings-switch-label">{label}</div>
                  <div className="ft-settings-switch-desc">{row.alert_type}</div>
                </div>
                <div className="ft-settings-switch-control">
                  <span className={`ft-settings-switch-state${enabled ? ' is-on' : ''}`}>
                    {enabled ? 'On' : 'Off'}
                  </span>
                  <Switch
                    checked={enabled}
                    disabled={savingKey != null}
                    onChange={(event) => handleToggle(row.alert_type, event.target.checked)}
                    aria-label={`Turn ${label} notifications ${enabled ? 'off' : 'on'}`}
                  />
                </div>
              </div>
            )
          })}
        </div>
      )}

      {saved && !error && (
        <p style={{ fontSize: 12, color: tokens.semantic.success, fontWeight: 600, margin: '12px 0 0' }}>
          Notification preferences saved
        </p>
      )}
    </div>
  )
}

export default ManagerNotificationSettings
