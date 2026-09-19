import { useEffect, useState } from 'react'
import { Users } from 'lucide-react'
import api from '../../api'
import { Modal, Input, Button, Checkbox } from '../../shared/components'
import { useTheme } from '../../theme'

// "Assign Users" flow — multi-select from users with no manager yet
// (GET /api/users?unassigned=true) and assigns all of them to whichever
// manager's detail panel is currently open (POST
// /api/managers/{id}/assign-users). A user already on another manager
// isn't offered here by design (see manager_service.get_unassigned_users)
// — re-assign from that manager's own panel instead.
const AssignUsersModal = ({ manager, onClose, onAssigned }) => {
  const { tokens } = useTheme()
  const [users, setUsers] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [selectedIds, setSelectedIds] = useState([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      setLoading(true)
      try {
        const res = await api.get('/api/users', { params: { unassigned: true } })
        if (!cancelled) setUsers(res.data)
      } catch (err) {
        if (!cancelled) setError('Failed to load users')
        console.error('Failed to load unassigned users:', err)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [])

  const filtered = users.filter((u) => {
    const q = search.trim().toLowerCase()
    if (!q) return true
    return u.username.toLowerCase().includes(q) || (u.full_name || '').toLowerCase().includes(q)
  })

  const toggle = (id) => {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
  }

  const handleAssign = async () => {
    if (selectedIds.length === 0) return
    setSaving(true)
    setError(null)
    try {
      await api.post(`/api/managers/${manager.id}/assign-users`, { user_ids: selectedIds })
      onAssigned()
      onClose()
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to assign users')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Assign Users"
      size="md"
      footer={(
        <>
          <span style={{
            marginRight: 'auto',
            fontSize: 12,
            color: tokens.textSecondary,
            fontWeight: 600,
            alignSelf: 'center',
          }}
          >
            {selectedIds.length > 0 ? `${selectedIds.length} selected` : ''}
          </span>
          <Button variant="secondary" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button onClick={handleAssign} loading={saving} disabled={selectedIds.length === 0}>
            <Users size={15} />
            Assign
          </Button>
        </>
      )}
    >
      <p style={{ margin: '0 0 14px', fontSize: 13, color: tokens.textSecondary }}>
        Assign to {manager.full_name || manager.username}. Only users with no manager yet are shown.
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
        ) : filtered.length === 0 ? (
          <div style={{ padding: 24, textAlign: 'center', color: tokens.textSecondary, fontSize: 13 }}>
            {users.length === 0 ? 'No unassigned users available.' : 'No users match.'}
          </div>
        ) : (
          filtered.map((u) => {
            const isSelected = selectedIds.includes(u.id)
            return (
              <div
                key={u.id}
                role="button"
                tabIndex={0}
                onClick={() => toggle(u.id)}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') toggle(u.id) }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  padding: '10px 12px',
                  borderBottom: `1px solid ${tokens.border}`,
                  cursor: 'pointer',
                  background: isSelected ? `${tokens.primary}14` : 'transparent',
                }}
              >
                <Checkbox
                  checked={isSelected}
                  onChange={() => toggle(u.id)}
                  onClick={(e) => e.stopPropagation()}
                />
                <div style={{
                  width: 30,
                  height: 30,
                  borderRadius: '50%',
                  background: tokens.text,
                  color: tokens.surface,
                  fontSize: 10,
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
              </div>
            )
          })
        )}
      </div>
    </Modal>
  )
}

export default AssignUsersModal
