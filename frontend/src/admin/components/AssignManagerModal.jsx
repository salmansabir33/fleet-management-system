import { useEffect, useState } from 'react'
import api from '../../api'
import { Modal, Select, Button } from '../../shared/components'

/**
 * Super Admin: move user into a fleet (if needed) and assign to a manager.
 */
const AssignManagerModal = ({ user, onClose, onAssigned }) => {
  const [admins, setAdmins] = useState([])
  const [managers, setManagers] = useState([])
  const [adminId, setAdminId] = useState(user?.admin_id != null ? String(user.admin_id) : '')
  const [managerId, setManagerId] = useState('')
  const [loadingManagers, setLoadingManagers] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    let cancelled = false
    api.get('/api/super-admin/admins')
      .then((res) => {
        if (!cancelled) {
          const active = (res.data || []).filter((row) => row.is_active)
          setAdmins(active)
          if (!adminId && active.length > 0) {
            setAdminId(String(active[0].id))
          }
        }
      })
      .catch(() => {
        if (!cancelled) setError('Failed to load admins')
      })
    return () => { cancelled = true }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps -- seed once

  useEffect(() => {
    if (!adminId) {
      setManagers([])
      setManagerId('')
      return undefined
    }
    let cancelled = false
    setLoadingManagers(true)
    api.get('/api/managers', { params: { admin_id: Number(adminId) } })
      .then((res) => {
        if (!cancelled) {
          setManagers(res.data || [])
          setManagerId('')
        }
      })
      .catch(() => {
        if (!cancelled) {
          setManagers([])
          setError('Failed to load managers for this admin')
        }
      })
      .finally(() => {
        if (!cancelled) setLoadingManagers(false)
      })
    return () => { cancelled = true }
  }, [adminId])

  const handleAssign = async () => {
    if (!user?.id || !adminId || !managerId) return
    setSaving(true)
    setError(null)
    try {
      await api.post(`/api/super-admin/users/${user.id}/assign-manager`, {
        admin_id: Number(adminId),
        manager_id: Number(managerId),
      })
      onAssigned?.()
      onClose()
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to assign manager')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={`Assign ${user?.full_name || user?.username || 'user'} to manager`}
      footer={(
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button onClick={handleAssign} loading={saving} disabled={!adminId || !managerId}>
            Assign
          </Button>
        </>
      )}
    >
      {error && <div className="ft-admin-settings-error" style={{ marginBottom: 12 }}>{error}</div>}
      <div className="ft-fuel-price-form" style={{ maxWidth: 360, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <Select
          label="Fleet admin"
          value={adminId}
          onChange={(e) => setAdminId(e.target.value)}
        >
          <option value="">Select admin…</option>
          {admins.map((admin) => (
            <option key={admin.id} value={admin.id}>
              {admin.full_name || admin.username}
            </option>
          ))}
        </Select>
        <Select
          label="Manager"
          value={managerId}
          onChange={(e) => setManagerId(e.target.value)}
          disabled={!adminId || loadingManagers}
        >
          <option value="">
            {loadingManagers ? 'Loading…' : 'Select manager…'}
          </option>
          {managers.map((m) => (
            <option key={m.id} value={m.id}>
              {m.full_name || m.username || `Manager #${m.id}`}
            </option>
          ))}
        </Select>
        {!loadingManagers && adminId && managers.length === 0 && (
          <p className="ft-muted" style={{ margin: 0, fontSize: 13 }}>
            No managers under this admin yet.
          </p>
        )}
      </div>
    </Modal>
  )
}

export default AssignManagerModal
