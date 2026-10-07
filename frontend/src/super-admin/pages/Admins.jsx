import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import api from '../../api'
import { writeActingAdmin } from '../../auth/actingAdminStorage'
import { dispatchActingAdminChanged } from '../../auth/actingAdminEvents'
import { clearAllScopedCaches } from '../../shared/clearScopedCaches'
import {
  Button,
  Card,
  Input,
  LoadingState,
  Modal,
  Switch,
  Table,
  TableRow,
  PageHeader,
  Select,
} from '../../shared/components'

const fetchAdminCounts = async (adminId) => {
  try {
    const [usersRes, devicesRes] = await Promise.all([
      api.get('/api/users', { params: { admin_id: adminId } }),
      api.get('/api/fleet/devices', { params: { admin_id: adminId } }),
    ])
    return {
      user_count: (usersRes.data || []).length,
      device_count: (devicesRes.data || []).length,
    }
  } catch {
    return { user_count: null, device_count: null }
  }
}

const Admins = () => {
  const navigate = useNavigate()
  const [admins, setAdmins] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [fullName, setFullName] = useState('')
  const [phone, setPhone] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [togglingId, setTogglingId] = useState(null)
  const [editTarget, setEditTarget] = useState(null)
  const [editFullName, setEditFullName] = useState('')
  const [editPhone, setEditPhone] = useState('')
  const [editPassword, setEditPassword] = useState('')
  const [editSaving, setEditSaving] = useState(false)
  const [reassignTarget, setReassignTarget] = useState(null)
  const [reassignToId, setReassignToId] = useState('')
  const [reassignSaving, setReassignSaving] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await api.get('/api/super-admin/admins')
      const rows = res.data || []
      const withCounts = await Promise.all(rows.map(async (row) => {
        const counts = await fetchAdminCounts(row.id)
        return { ...row, ...counts }
      }))
      setAdmins(withCounts)
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to load admins')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const handleCreate = async (event) => {
    event.preventDefault()
    setSubmitting(true)
    setError(null)
    try {
      await api.post('/api/super-admin/admins', {
        username: username.trim(),
        password,
        full_name: fullName.trim() || null,
        phone: phone.trim() || null,
      })
      setUsername('')
      setPassword('')
      setFullName('')
      setPhone('')
      await load()
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to create admin')
    } finally {
      setSubmitting(false)
    }
  }

  const handleToggleActive = async (admin, nextActive) => {
    if (!nextActive) {
      const userCount = admin.user_count ?? '—'
      const deviceCount = admin.device_count ?? '—'
      const ok = window.confirm(
        `Disable "${admin.username}"?\n\nUsers: ${userCount}\nDevices: ${deviceCount}\n\nThey will lose login access until re-enabled.`,
      )
      if (!ok) return
    }
    setTogglingId(admin.id)
    setError(null)
    const prev = admins
    setAdmins((rows) => rows.map((row) => (
      row.id === admin.id ? { ...row, is_active: nextActive } : row
    )))
    try {
      await api.patch(`/api/super-admin/admins/${admin.id}`, { is_active: nextActive })
      await load()
    } catch (err) {
      setAdmins(prev)
      setError(err.response?.data?.detail || 'Failed to update admin')
    } finally {
      setTogglingId(null)
    }
  }

  const openEdit = (admin) => {
    setEditTarget(admin)
    setEditFullName(admin.full_name || '')
    setEditPhone(admin.phone || '')
    setEditPassword('')
    setError(null)
  }

  const handleEditSave = async () => {
    if (!editTarget) return
    setEditSaving(true)
    setError(null)
    try {
      const body = {
        full_name: editFullName.trim() || null,
        phone: editPhone.trim() || null,
      }
      if (editPassword.trim()) body.password = editPassword.trim()
      await api.patch(`/api/super-admin/admins/${editTarget.id}`, body)
      setEditTarget(null)
      await load()
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to update admin')
    } finally {
      setEditSaving(false)
    }
  }

  const openReassign = (admin) => {
    setReassignTarget(admin)
    setReassignToId('')
    setError(null)
  }

  const handleReassign = async () => {
    if (!reassignTarget) return
    setReassignSaving(true)
    setError(null)
    try {
      const target = reassignToId === '' ? null : Number(reassignToId)
      await api.post(`/api/super-admin/admins/${reassignTarget.id}/reassign-fleet`, {
        target_admin_id: target,
      })
      setReassignTarget(null)
      await load()
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to reassign fleet')
    } finally {
      setReassignSaving(false)
    }
  }

  const handleOpenFleet = (admin) => {
    const label = admin.full_name || admin.username
    clearAllScopedCaches()
    writeActingAdmin(admin.id, label)
    dispatchActingAdminChanged()
    navigate('/super-admin/dashboard', { replace: true })
  }

  if (loading && admins.length === 0) {
    return <LoadingState label="Loading fleet admins…" />
  }

  const otherAdmins = admins.filter((row) => row.id !== reassignTarget?.id && row.is_active)

  return (
    <div className="ft-page-stack">
      <PageHeader title="Fleet admins" subtitle="Create accounts for fleet owners and disable access when needed." />

      {error && (
        <div className="ft-admin-settings-error">{error}</div>
      )}

      <div className="ft-admin-settings-grid">
        <Card title="Create admin">
          <form onSubmit={handleCreate} className="ft-fuel-price-form">
            <Input label="Username" value={username} onChange={(e) => setUsername(e.target.value)} required />
            <Input label="Password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
            <Input label="Full name" value={fullName} onChange={(e) => setFullName(e.target.value)} />
            <Input label="Phone" value={phone} onChange={(e) => setPhone(e.target.value)} />
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <Button type="submit" loading={submitting} disabled={!username.trim() || !password}>
                Create admin
              </Button>
            </div>
          </form>
        </Card>

        <Card title="All fleet admins" className="ft-fuel-price-history">
          <Table
            columns={[
              { key: 'user', label: 'Username' },
              { key: 'name', label: 'Name' },
              { key: 'phone', label: 'Phone' },
              { key: 'users', label: 'Users' },
              { key: 'devices', label: 'Devices' },
              { key: 'active', label: 'Active' },
              { key: 'actions', label: 'Actions' },
            ]}
          >
            {admins.map((admin) => (
              <TableRow key={admin.id}>
                <td>{admin.username}</td>
                <td>{admin.full_name || '—'}</td>
                <td>{admin.phone || '—'}</td>
                <td>{admin.user_count ?? '—'}</td>
                <td>{admin.device_count ?? '—'}</td>
                <td>
                  <Switch
                    checked={Boolean(admin.is_active)}
                    disabled={togglingId === admin.id}
                    onChange={(e) => handleToggleActive(admin, e.target.checked)}
                  />
                </td>
                <td>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                    <Button type="button" variant="secondary" size="sm" onClick={() => openEdit(admin)}>
                      Edit
                    </Button>
                    <Button type="button" variant="secondary" size="sm" onClick={() => openReassign(admin)}>
                      Reassign fleet
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      disabled={!admin.is_active}
                      onClick={() => handleOpenFleet(admin)}
                    >
                      Open fleet
                    </Button>
                  </div>
                </td>
              </TableRow>
            ))}
          </Table>
        </Card>
      </div>

      <Modal
        open={Boolean(editTarget)}
        onClose={() => !editSaving && setEditTarget(null)}
        title={editTarget ? `Edit ${editTarget.username}` : 'Edit admin'}
        footer={(
          <>
            <Button variant="secondary" onClick={() => setEditTarget(null)} disabled={editSaving}>Cancel</Button>
            <Button onClick={handleEditSave} loading={editSaving}>Save</Button>
          </>
        )}
      >
        <div className="ft-fuel-price-form">
          <Input label="Full name" value={editFullName} onChange={(e) => setEditFullName(e.target.value)} />
          <Input label="Phone" value={editPhone} onChange={(e) => setEditPhone(e.target.value)} />
          <Input
            label="New password"
            type="password"
            value={editPassword}
            onChange={(e) => setEditPassword(e.target.value)}
            placeholder="Leave blank to keep current"
          />
        </div>
      </Modal>

      <Modal
        open={Boolean(reassignTarget)}
        onClose={() => !reassignSaving && setReassignTarget(null)}
        title={reassignTarget ? `Reassign fleet — ${reassignTarget.username}` : 'Reassign fleet'}
        footer={(
          <>
            <Button variant="secondary" onClick={() => setReassignTarget(null)} disabled={reassignSaving}>Cancel</Button>
            <Button onClick={handleReassign} loading={reassignSaving}>Reassign</Button>
          </>
        )}
      >
        <p className="ft-muted" style={{ marginTop: 0 }}>
          Move all users and devices from this admin to another, or leave unassigned.
        </p>
        <Select
          label="Target fleet admin"
          value={reassignToId}
          onChange={(e) => setReassignToId(e.target.value)}
        >
          <option value="">Unassigned (no admin)</option>
          {otherAdmins.map((admin) => (
            <option key={admin.id} value={admin.id}>
              {admin.full_name || admin.username}
              {' '}
              (
              {admin.username}
              )
            </option>
          ))}
        </Select>
      </Modal>
    </div>
  )
}

export default Admins
