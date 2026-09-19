import { useEffect, useState } from 'react'
import { UserCog } from 'lucide-react'
import api from '../../api'
import { Modal, Input, Button } from '../../shared/components'
import { useTheme } from '../../theme'

// "+ Add New Manager" flow — lists users who aren't already a manager
// (GET /api/users?exclude_managers=true), pick one, POST /api/managers
// promotes them. Deliberately no create-user form here; if the person
// you want isn't in the list yet, they need to be added as a User
// first (see AllUsers.jsx).
const AddManagerModal = ({ onClose, onPromoted }) => {
  const { tokens } = useTheme()
  const [users, setUsers] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [selectedId, setSelectedId] = useState(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      setLoading(true)
      try {
        const res = await api.get('/api/users', { params: { exclude_managers: true } })
        if (!cancelled) setUsers(res.data)
      } catch (err) {
        if (!cancelled) setError('Failed to load users')
        console.error('Failed to load candidate users:', err)
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

  const handlePromote = async () => {
    if (!selectedId) return
    setSaving(true)
    setError(null)
    try {
      await api.post('/api/managers', { user_id: selectedId })
      onPromoted()
      onClose()
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to promote user')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Add New Manager"
      size="md"
      footer={(
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button onClick={handlePromote} loading={saving} disabled={!selectedId}>
            <UserCog size={15} />
            Promote to Manager
          </Button>
        </>
      )}
    >
      <p style={{ margin: '0 0 14px', fontSize: 13, color: tokens.textSecondary }}>
        Pick an existing user to promote to manager.
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
            {users.length === 0 ? 'No users available to promote yet.' : 'No users match.'}
          </div>
        ) : (
          filtered.map((u) => {
            const isSelected = selectedId === u.id
            return (
              <div
                key={u.id}
                role="button"
                tabIndex={0}
                onClick={() => setSelectedId(u.id)}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') setSelectedId(u.id) }}
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
                <input
                  type="radio"
                  checked={isSelected}
                  onChange={() => setSelectedId(u.id)}
                  style={{ flexShrink: 0, accentColor: tokens.primary }}
                />
              </div>
            )
          })
        )}
      </div>
    </Modal>
  )
}

export default AddManagerModal
