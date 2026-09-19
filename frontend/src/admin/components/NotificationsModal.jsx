import { useEffect, useState } from 'react'
import { Bell } from 'lucide-react'
import api from '../../api'
import { Modal, Button, Checkbox } from '../../shared/components'
import { useTheme } from '../../theme'
import { ALERT_TYPE_LABELS } from '../utils/notificationDisplayPrefs'

const NotificationsModal = ({ manager, onClose, onSaved }) => {
  const { tokens } = useTheme()
  const [types, setTypes] = useState([])
  const [checked, setChecked] = useState({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        const res = await api.get('/api/settings/alert-types')
        if (cancelled) return
        const offered = (res.data || []).filter((row) => row.offered_to_managers !== false)
        setTypes(offered)
      } catch (err) {
        console.error('Failed to load alert types:', err)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    const stored = manager.notification_prefs || {}
    const next = {}
    for (const row of types) {
      next[row.alert_type] = stored[row.alert_type] !== false
    }
    setChecked(next)
  }, [manager.id, manager.notification_prefs, types])

  const toggle = (alertType) => {
    setChecked((prev) => ({ ...prev, [alertType]: !prev[alertType] }))
  }

  const handleSave = async () => {
    setSaving(true)
    setError(null)
    try {
      await api.patch(`/api/managers/${manager.id}/notification-prefs`, {
        notification_prefs: Object.fromEntries(types.map((row) => [
          row.alert_type,
          checked[row.alert_type] !== false,
        ])),
      })
      onSaved()
      onClose()
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to save notifications')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Notifications"
      size="md"
      footer={(
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button onClick={handleSave} loading={saving} disabled={loading}>
            <Bell size={15} />
            Save Notifications
          </Button>
        </>
      )}
    >
      <p style={{ margin: '0 0 14px', fontSize: 13, color: tokens.textSecondary }}>
        {manager.full_name || manager.username} — which alert types this manager hears for their assigned vehicles. All offered types start on.
      </p>

      {error && (
        <div style={{
          background: `${tokens.semantic.danger}18`,
          color: tokens.semantic.danger,
          padding: '8px 12px',
          borderRadius: 8,
          fontSize: 13,
          marginBottom: 12,
        }}
        >
          {error}
        </div>
      )}

      {loading ? (
        <div style={{ padding: 24, textAlign: 'center', color: tokens.textSecondary, fontSize: 13 }}>
          Loading...
        </div>
      ) : types.length === 0 ? (
        <p style={{ margin: 0, fontSize: 13, color: tokens.textSecondary }}>
          No notification types are offered in Settings.
        </p>
      ) : (
        <div style={{
          overflowY: 'auto',
          display: 'flex',
          flexDirection: 'column',
          gap: 2,
          border: `1px solid ${tokens.border}`,
          borderRadius: 10,
          padding: 6,
        }}
        >
          {types.map((row) => (
            <div
              key={row.alert_type}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: '9px 10px',
                borderRadius: 8,
              }}
            >
              <Checkbox
                label={ALERT_TYPE_LABELS[row.alert_type] || row.alert_type}
                checked={checked[row.alert_type] !== false}
                onChange={() => toggle(row.alert_type)}
              />
            </div>
          ))}
        </div>
      )}
    </Modal>
  )
}

export default NotificationsModal
