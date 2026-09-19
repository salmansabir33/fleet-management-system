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

const PermissionsSettings = () => {
  const { tokens } = useTheme()
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [togglingId, setTogglingId] = useState(null)

  const load = async () => {
    try {
      const res = await api.get('/api/settings/permissions', { params: { include_inactive: true } })
      setRows(res.data || [])
      setError(null)
    } catch (err) {
      console.error('Failed to load permission catalog:', err)
      setError(err.response?.data?.detail || 'Failed to load permissions')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  const handleToggle = async (row, nextActive) => {
    setTogglingId(row.id)
    setError(null)
    const previous = rows
    setRows((list) => list.map((item) => (
      item.id === row.id ? { ...item, is_active: nextActive } : item
    )))
    try {
      if (nextActive) {
        await api.patch(`/api/settings/permissions/${row.id}`, { is_active: true })
      } else {
        await api.delete(`/api/settings/permissions/${row.id}`)
      }
    } catch (err) {
      setRows(previous)
      setError(err.response?.data?.detail || 'Failed to update permission')
    } finally {
      setTogglingId(null)
    }
  }

  if (loading) {
    return <Card><LoadingState label="Loading permissions…" /></Card>
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

      <Card title="Manager permission options">
        <p className="ft-admin-settings-card-hint">
          These switches choose which options appear when you assign permissions to a manager.
          Turning one off hides it from that modal and removes it from every manager immediately.
        </p>
        {rows.length === 0 ? (
          <EmptyState title="No permission keys yet." />
        ) : (
          <div className="ft-settings-switch-list">
            {rows.map((row) => (
              <div key={row.id} className="ft-settings-switch-row">
                <div className="ft-settings-switch-copy">
                  <div className="ft-settings-switch-label">{row.label}</div>
                  <div className="ft-settings-switch-desc">{row.description || row.key}</div>
                </div>
                <Switch
                  checked={!!row.is_active}
                  disabled={togglingId === row.id}
                  onChange={(e) => handleToggle(row, e.target.checked)}
                  aria-label={`Offer ${row.label} to managers`}
                />
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  )
}

export default PermissionsSettings
