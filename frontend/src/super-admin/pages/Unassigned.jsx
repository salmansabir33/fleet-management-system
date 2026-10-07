import { lazy, Suspense, useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { AlertTriangle } from 'lucide-react'
import api from '../../api'
import { useBasePath } from '../../shared/hooks/useBasePath'
import {
  Button,
  Card,
  LoadingState,
  PageHeader,
  Select,
  Table,
  TableRow,
} from '../../shared/components'
import AssignManagerModal from '../../admin/components/AssignManagerModal'

const EditVehicleUserModal = lazy(() => import('../../admin/components/EditVehicleUserModal'))

const Unassigned = () => {
  const basePath = useBasePath()
  const [items, setItems] = useState([])
  const [admins, setAdmins] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const [assignTarget, setAssignTarget] = useState(null)
  const [assignAdminId, setAssignAdminId] = useState('')
  const [assigning, setAssigning] = useState(false)

  const [managerTarget, setManagerTarget] = useState(null)
  const [editDevice, setEditDevice] = useState(null)
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [deleting, setDeleting] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [unassignedRes, adminsRes] = await Promise.all([
        api.get('/api/super-admin/unassigned'),
        api.get('/api/super-admin/admins'),
      ])
      setItems(unassignedRes.data?.items || [])
      setAdmins((adminsRes.data || []).filter((row) => row.is_active))
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to load unassigned assets')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const startAssign = (row) => {
    // Ownerless quarantine devices must get a user via Edit/claim first
    if (row.user_id == null && row.device_id != null) {
      setEditDevice({
        db_id: row.device_id,
        device: { name: row.vehicle_name },
        owner: null,
      })
      setError(null)
      return
    }
    setAssignTarget(row)
    setAssignAdminId(admins.length > 0 ? String(admins[0].id) : '')
    setError(null)
  }

  const handleAssign = async () => {
    if (!assignTarget?.user_id || !assignAdminId) return
    setAssigning(true)
    setError(null)
    try {
      await api.post(`/api/super-admin/users/${assignTarget.user_id}/move`, {
        admin_id: Number(assignAdminId),
      })
      setAssignTarget(null)
      await load()
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to assign to admin')
    } finally {
      setAssigning(false)
    }
  }

  const handleDelete = async () => {
    if (!deleteTarget?.device_id && !deleteTarget?.user_id) return
    setDeleting(true)
    setError(null)
    try {
      if (deleteTarget.user_id != null) {
        await api.delete(`/api/users/${deleteTarget.user_id}`)
      } else if (deleteTarget.device_id != null) {
        await api.delete(`/api/super-admin/devices/${deleteTarget.device_id}`)
      }
      setDeleteTarget(null)
      await load()
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to delete')
    } finally {
      setDeleting(false)
    }
  }

  if (loading) return <LoadingState label="Loading unassigned…" />

  return (
    <div className="ft-page-stack">
      <PageHeader
        title="Unassigned"
        subtitle="User and vehicle pairs with no fleet admin. Assign them to a fleet or open details."
      />

      {error && <div className="ft-admin-settings-error">{error}</div>}

      <Card title={items.length ? `${items.length} unassigned` : 'Unassigned'}>
        {items.length === 0 ? (
          <p className="ft-muted">Nothing unassigned. New users and vehicles are created together; if they have no fleet admin they appear here.</p>
        ) : (
          <Table columns={[
            { key: 'user', label: 'User' },
            { key: 'username', label: 'Username' },
            { key: 'phone', label: 'Phone' },
            { key: 'vehicle', label: 'Vehicle' },
            { key: 'actions', label: '' },
          ]}
          >
            {items.map((row) => {
              const key = row.user_id != null
                ? `u-${row.user_id}`
                : `d-${row.device_id}`
              const needsUser = row.user_id == null
              return (
                <TableRow key={key}>
                  <td>
                    {needsUser ? (
                      <span className="av-user-required" title="User required">
                        <AlertTriangle size={14} aria-hidden />
                        User required
                      </span>
                    ) : (
                      row.full_name || '—'
                    )}
                  </td>
                  <td>{row.username || '—'}</td>
                  <td>{row.phone_number || '—'}</td>
                  <td>{row.vehicle_name || '—'}</td>
                  <td>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
                      {row.user_id != null && (
                        <Link to={`${basePath}/users/${row.user_id}`}>Open</Link>
                      )}
                      {row.device_id != null && (
                        <Button
                          type="button"
                          size="sm"
                          variant="secondary"
                          onClick={() => setEditDevice({
                            db_id: row.device_id,
                            device: { name: row.vehicle_name },
                            owner: row.user_id ? { id: row.user_id } : null,
                          })}
                        >
                          Edit
                        </Button>
                      )}
                      <Button type="button" size="sm" variant="secondary" onClick={() => startAssign(row)}>
                        Assign to admin
                      </Button>
                      {row.user_id != null && (
                        <Button
                          type="button"
                          size="sm"
                          variant="secondary"
                          onClick={() => setManagerTarget({
                            id: row.user_id,
                            username: row.username,
                            full_name: row.full_name,
                            admin_id: null,
                          })}
                        >
                          Assign to manager
                        </Button>
                      )}
                      <Button type="button" size="sm" variant="danger" onClick={() => setDeleteTarget(row)}>
                        Delete
                      </Button>
                    </div>
                  </td>
                </TableRow>
              )
            })}
          </Table>
        )}
      </Card>

      {assignTarget && (
        <Card title="Assign to fleet admin">
          <div className="ft-fuel-price-form" style={{ maxWidth: 360 }}>
            <Select
              label="Fleet admin"
              value={assignAdminId}
              onChange={(e) => setAssignAdminId(e.target.value)}
            >
              {admins.map((admin) => (
                <option key={admin.id} value={admin.id}>
                  {admin.full_name || admin.username}
                </option>
              ))}
            </Select>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <Button variant="secondary" onClick={() => setAssignTarget(null)} disabled={assigning}>
                Cancel
              </Button>
              <Button onClick={handleAssign} loading={assigning} disabled={!assignAdminId}>
                Assign
              </Button>
            </div>
          </div>
        </Card>
      )}

      {deleteTarget && (
        <Card title="Delete?">
          <p>
            Delete
            {' '}
            <strong>
              {deleteTarget.full_name || deleteTarget.username || deleteTarget.vehicle_name || 'this entry'}
            </strong>
            {deleteTarget.user_id != null
              ? ' (user and their vehicle, if any)'
              : ' (device)'}
            ? This cannot be undone.
          </p>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <Button variant="secondary" onClick={() => setDeleteTarget(null)} disabled={deleting}>
              Cancel
            </Button>
            <Button variant="danger" onClick={handleDelete} loading={deleting}>
              Delete
            </Button>
          </div>
        </Card>
      )}

      {managerTarget && (
        <AssignManagerModal
          user={managerTarget}
          onClose={() => setManagerTarget(null)}
          onAssigned={load}
        />
      )}

      {editDevice && (
        <Suspense fallback={null}>
          <EditVehicleUserModal
            vehicleRow={editDevice}
            onClose={() => setEditDevice(null)}
            onSaved={load}
          />
        </Suspense>
      )}
    </div>
  )
}

export default Unassigned
