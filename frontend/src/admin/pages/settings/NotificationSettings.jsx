import { useEffect, useState } from 'react'
import api from '../../../api'
import { useTheme } from '../../../theme'
import { hexToRgba } from '../../../shared/utils'
import {
  Card,
  Switch,
  LoadingState,
  EmptyState,
} from '../../../shared/components'
import {
  ALERT_TYPE_LABELS,
  mergePrefsWithKnownTypes,
  setNotificationDisplayPref,
  writeNotificationDisplayPrefs,
  ADMIN_NOTIFICATION_PREFS_EVENT,
} from '../../utils/notificationDisplayPrefs'

const NotificationSettings = () => {
  const { tokens } = useTheme()
  const [alertTypes, setAlertTypes] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [savingKey, setSavingKey] = useState(null)
  const [bellPrefs, setBellPrefs] = useState({})

  const load = async () => {
    try {
      const res = await api.get('/api/settings/alert-types')
      const rows = res.data || []
      setAlertTypes(rows)
      const known = rows.map((r) => r.alert_type)
      const merged = mergePrefsWithKnownTypes(known)
      setBellPrefs(merged)
      writeNotificationDisplayPrefs(merged)
      setError(null)
    } catch (err) {
      console.error('Failed to load alert type settings:', err)
      setError(err.response?.data?.detail || 'Failed to load notification settings')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  useEffect(() => {
    const sync = () => {
      setBellPrefs(mergePrefsWithKnownTypes(alertTypes.map((r) => r.alert_type)))
    }
    window.addEventListener(ADMIN_NOTIFICATION_PREFS_EVENT, sync)
    window.addEventListener('storage', sync)
    return () => {
      window.removeEventListener(ADMIN_NOTIFICATION_PREFS_EVENT, sync)
      window.removeEventListener('storage', sync)
    }
  }, [alertTypes])

  const patchAlertType = async (alertType, body, optimistic) => {
    setSavingKey(alertType)
    setError(null)
    const previous = alertTypes
    setAlertTypes((rows) => rows.map((r) => (
      r.alert_type === alertType ? { ...r, ...optimistic } : r
    )))
    try {
      const res = await api.patch(
        `/api/settings/alert-types/${encodeURIComponent(alertType)}`,
        body,
      )
      setAlertTypes((rows) => rows.map((r) => (
        r.alert_type === alertType ? { ...r, ...res.data } : r
      )))
    } catch (err) {
      setAlertTypes(previous)
      setError(err.response?.data?.detail || 'Failed to update alert type')
    } finally {
      setSavingKey(null)
    }
  }

  const handleAdminBellToggle = (alertType, enabled) => {
    setNotificationDisplayPref(alertType, enabled)
    setBellPrefs((prev) => ({ ...prev, [alertType]: enabled }))
  }

  if (loading) {
    return <Card><LoadingState label="Loading alert types…" /></Card>
  }

  return (
    <div>
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

      <Card title="Manager notification options">
        <p className="ft-admin-settings-card-hint">
          Available chooses which alert types appear when you assign notifications to a manager.
          Turning Available off hides the type and removes it from every manager immediately.
          Detection still turns fleet-wide generation on or off.
        </p>
        {alertTypes.length === 0 ? (
          <EmptyState title="No alert types configured." />
        ) : (
          <div className="ft-settings-switch-list">
            {alertTypes.map((row) => (
              <div key={row.alert_type} className="ft-settings-switch-row">
                <div className="ft-settings-switch-copy">
                  <div className="ft-settings-switch-label">
                    {ALERT_TYPE_LABELS[row.alert_type] || row.alert_type}
                  </div>
                  <div className="ft-settings-switch-desc">{row.alert_type}</div>
                </div>
                <div className="ft-settings-role-switches">
                  <div className="ft-settings-role-switch">
                    <span>Available</span>
                    <Switch
                      checked={row.offered_to_managers !== false}
                      disabled={savingKey === row.alert_type}
                      onChange={(e) => patchAlertType(
                        row.alert_type,
                        { offered_to_managers: e.target.checked },
                        { offered_to_managers: e.target.checked },
                      )}
                      aria-label={`Offer ${row.alert_type} to managers`}
                    />
                  </div>
                  <div className="ft-settings-role-switch">
                    <span>Detection</span>
                    <Switch
                      checked={row.is_enabled}
                      disabled={savingKey === row.alert_type}
                      onChange={(e) => patchAlertType(
                        row.alert_type,
                        { is_enabled: e.target.checked },
                        { is_enabled: e.target.checked },
                      )}
                      aria-label={`Toggle detection for ${row.alert_type}`}
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card title="This browser (admin topbar)" className="ft-settings-footer-card">
        <p className="ft-admin-settings-card-hint">
          Filters the admin notification bell on this browser only. Not a person and not stored in the database.
        </p>
        {alertTypes.length === 0 ? (
          <EmptyState title="No alert types configured." />
        ) : (
          <div className="ft-settings-switch-list" style={{ maxHeight: 280 }}>
            {alertTypes.map((row) => (
              <div key={row.alert_type} className="ft-settings-switch-row">
                <div className="ft-settings-switch-copy">
                  <div className="ft-settings-switch-label">
                    {ALERT_TYPE_LABELS[row.alert_type] || row.alert_type}
                  </div>
                </div>
                <Switch
                  checked={bellPrefs[row.alert_type] !== false}
                  onChange={(e) => handleAdminBellToggle(row.alert_type, e.target.checked)}
                  aria-label={`This-browser bell for ${row.alert_type}`}
                />
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  )
}

export default NotificationSettings
