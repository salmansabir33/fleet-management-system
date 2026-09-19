import { useEffect, useState } from 'react'
import { UserCheck, UserX } from 'lucide-react'
import api from '../../api'
import { Modal, Input, Button } from '../../shared/components'
import { useTheme } from '../../theme'
import { usePanelScope } from '../../manager/hooks/usePanelScope'

// Opened from the "Owner" field on AdminVehicleDetail.jsx — search-and-pick
// a user (GET /api/users?q=) to own this vehicle, or clear the owner
// entirely. Saves via PATCH /api/fleet/devices/{id} with {user_id}.
// Same backdrop + centered card pattern as AddManagerModal.jsx.
const OwnerPickerModal = ({ deviceId, currentOwnerId, onClose, onSaved }) => {
  const { tokens } = useTheme()
  const { apiFor } = usePanelScope()
  const [search, setSearch] = useState('')
  const [users, setUsers] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    const handle = setTimeout(async () => {
      try {
        const res = await api.get(apiFor('/users', '/api/users'), { params: search ? { q: search } : {} })
        if (!cancelled) setUsers(res.data)
      } catch (err) {
        if (!cancelled) setError('Failed to load users')
        console.error('Failed to load users:', err)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }, 250)
    return () => { cancelled = true; clearTimeout(handle) }
  }, [search, apiFor])

  const assignOwner = async (userId) => {
    setSaving(true)
    setError(null)
    try {
      await api.patch(apiFor(`/vehicles/${deviceId}`, `/api/fleet/devices/${deviceId}`), { user_id: userId })
      onSaved()
      onClose()
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to update owner')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Assign Owner"
      size="md"
      footer={currentOwnerId != null ? (
        <Button variant="danger" onClick={() => assignOwner(null)} loading={saving}>
          <UserX size={14} />
          Remove owner
        </Button>
      ) : undefined}
    >
      <p style={{ margin: '0 0 14px', fontSize: 13, color: tokens.textSecondary }}>
        Pick the user who owns this vehicle.
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

      <Input
        type="text"
        placeholder="Search users..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        autoFocus
      />
      <div style={{ height: 12 }} />

      <div style={{
        overflowY: 'auto',
        minHeight: 120,
        maxHeight: 320,
        border: `1px solid ${tokens.border}`,
        borderRadius: 10,
      }}
      >
        {loading ? (
          <div style={{ padding: 24, textAlign: 'center', color: tokens.textSecondary, fontSize: 13 }}>
            Loading users...
          </div>
        ) : users.length === 0 ? (
          <div style={{ padding: 24, textAlign: 'center', color: tokens.textSecondary, fontSize: 13 }}>
            No users match.
          </div>
        ) : (
          users.map((u) => {
            const isCurrent = currentOwnerId === u.id
            // Each user can own at most one vehicle — a user who
            // already owns a different vehicle is shown but
            // disabled, rather than only surfacing the 400 after
            // a failed click.
            const ownsOtherVehicle = !isCurrent && (u.vehicles?.length || 0) > 0
            return (
              <div
                key={u.id}
                role="button"
                tabIndex={ownsOtherVehicle ? -1 : 0}
                onClick={() => !saving && !ownsOtherVehicle && assignOwner(u.id)}
                onKeyDown={(e) => {
                  if ((e.key === 'Enter' || e.key === ' ') && !saving && !ownsOtherVehicle) {
                    assignOwner(u.id)
                  }
                }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  padding: '10px 12px',
                  borderBottom: `1px solid ${tokens.border}`,
                  cursor: ownsOtherVehicle ? 'not-allowed' : 'pointer',
                  background: isCurrent ? `${tokens.primary}14` : 'transparent',
                  opacity: ownsOtherVehicle ? 0.5 : 1,
                }}
              >
                <div style={{
                  width: 32,
                  height: 32,
                  borderRadius: '50%',
                  background: tokens.text,
                  color: tokens.surface,
                  fontSize: 11,
                  fontWeight: 700,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                }}
                >
                  {u.username.slice(0, 2).toUpperCase()}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: tokens.text }}>
                    {u.full_name || u.username}
                  </div>
                  <div style={{ fontSize: 11, color: tokens.textSecondary, marginTop: 2 }}>
                    @{u.username}{u.phone_number ? ` · ${u.phone_number}` : ''}
                  </div>
                </div>
                {isCurrent && <UserCheck size={16} color={tokens.primary} />}
                {ownsOtherVehicle && (
                  <span style={{
                    fontSize: 10,
                    fontWeight: 700,
                    color: tokens.textSecondary,
                    background: tokens.background,
                    padding: '3px 8px',
                    borderRadius: 999,
                    flexShrink: 0,
                    whiteSpace: 'nowrap',
                  }}
                  >
                    Owns a vehicle
                  </span>
                )}
              </div>
            )
          })
        )}
      </div>
    </Modal>
  )
}

export default OwnerPickerModal
