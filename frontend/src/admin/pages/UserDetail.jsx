import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  ArrowLeft, ShieldCheck, Pencil, Trash2, MoreHorizontal, MoreVertical, ChevronRight,
} from 'lucide-react'
import api from '../../api'
import { useAuth } from '../../auth/AuthContext'
import {
  LoadingState,
  EmptyState,
  Avatar,
  Switch,
  Dropdown,
  DropdownItem,
  ConfirmDialog,
  Modal,
  Select,
  Button,
} from '../../shared/components'
import EditUserModal from '../components/EditUserModal'
import { usePanelScope } from '../../manager/hooks/usePanelScope'
import { userPicSrc } from '../utils/userPic'
import '../styles/admin-user-detail.css'

const MOBILE_MQ = '(max-width: 820px)'

const buildDeleteUserMessage = (u) => {
  if (!u) return ''
  const name = u.full_name || u.username
  const vehicle = u.vehicles?.[0]
  let message = vehicle
    ? `Deleting ${name} will also delete their vehicle (${vehicle.name}). This cannot be undone.`
    : `Delete ${name}? This cannot be undone.`
  if (u.is_manager) {
    message += ' Because this user is a manager, their manager role will be removed and any users assigned to them will be unassigned.'
  }
  return message
}

const UserDetail = () => {
  const { userId } = useParams()
  const navigate = useNavigate()
  const { role } = useAuth()
  const isSuperAdmin = role === 'super_admin'
  const { basePath, isManager, can, apiFor } = usePanelScope()
  const usersListPath = isManager ? `${basePath}/picker` : `${basePath}/users`
  const [user, setUser] = useState(null)
  const [groupLabel, setGroupLabel] = useState('—')
  const [assignedVehicles, setAssignedVehicles] = useState([])
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [showEditModal, setShowEditModal] = useState(false)
  const [promoting, setPromoting] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleteError, setDeleteError] = useState(null)
  const [admins, setAdmins] = useState([])
  const [moveOpen, setMoveOpen] = useState(false)
  const [moveAdminId, setMoveAdminId] = useState('')
  const [moving, setMoving] = useState(false)
  const [moveError, setMoveError] = useState(null)
  const [isMobile, setIsMobile] = useState(() => (
    typeof window !== 'undefined' ? window.matchMedia(MOBILE_MQ).matches : false
  ))

  useEffect(() => {
    if (!isSuperAdmin) return undefined
    let cancelled = false
    const loadAdmins = async () => {
      try {
        const res = await api.get('/api/super-admin/admins')
        if (!cancelled) {
          const active = (res.data || []).filter((row) => row.is_active)
          setAdmins(active)
          if (active.length > 0) setMoveAdminId(String(active[0].id))
        }
      } catch {
        // Move actions stay hidden if list fails.
      }
    }
    loadAdmins()
    return () => { cancelled = true }
  }, [isSuperAdmin])

  useEffect(() => {
    const mq = window.matchMedia(MOBILE_MQ)
    const sync = () => setIsMobile(mq.matches)
    sync()
    mq.addEventListener('change', sync)
    return () => mq.removeEventListener('change', sync)
  }, [])

  const loadUser = async () => {
    const userRes = await api.get(apiFor(`/users/${userId}`, `/api/users/${userId}`))
    setUser(userRes.data)
    return userRes.data
  }

  const collectFleetVehicles = (nextUser, assignedUsers) => {
    const seen = new Set()
    const list = []
    const addAll = (vehicles) => {
      for (const v of vehicles || []) {
        if (v?.id == null || seen.has(v.id)) continue
        seen.add(v.id)
        list.push(v)
      }
    }
    addAll(nextUser?.vehicles)
    for (const assigned of assignedUsers || []) addAll(assigned.vehicles)
    return list
  }

  const loadAssignedVehicles = async (nextUser) => {
    if (!nextUser) {
      setAssignedVehicles([])
      return
    }
    if (!nextUser.is_manager || isManager) {
      setAssignedVehicles(collectFleetVehicles(nextUser, []))
      return
    }
    try {
      let managerId = nextUser.manager_id
      if (!managerId) {
        const listRes = await api.get('/api/managers')
        const match = (listRes.data || []).find((m) => m.user_id === nextUser.id)
        managerId = match?.id
      }
      if (!managerId) {
        setAssignedVehicles(collectFleetVehicles(nextUser, []))
        return
      }
      const res = await api.get(`/api/managers/${managerId}`)
      setAssignedVehicles(collectFleetVehicles(nextUser, res.data.assigned_users || []))
    } catch (err) {
      console.error('Failed to load manager vehicles:', err)
      setAssignedVehicles(collectFleetVehicles(nextUser, []))
    }
  }

  const resolveGroup = async (nextUser) => {
    if (!nextUser) {
      setGroupLabel('—')
      return
    }
    if (nextUser.is_manager) {
      setGroupLabel('Manager')
      return
    }
    if (!nextUser.manager_id || isManager) {
      setGroupLabel(nextUser.manager_id ? 'Assigned group' : 'Unassigned')
      return
    }
    try {
      const res = await api.get(`/api/managers/${nextUser.manager_id}`)
      setGroupLabel(res.data.full_name || res.data.username || 'Assigned group')
    } catch {
      setGroupLabel('Assigned group')
    }
  }

  useEffect(() => {
    if (!userId) return
    let cancelled = false
    setLoading(true)
    setNotFound(false)

    const load = async () => {
      try {
        const nextUser = await loadUser()
        if (cancelled) return
        await Promise.all([
          resolveGroup(nextUser),
          loadAssignedVehicles(nextUser),
        ])
      } catch (err) {
        console.error('Failed to load user:', err)
        if (err.response?.status === 404) setNotFound(true)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId])

  const handleMakeManager = async () => {
    if (!user || user.is_manager) return
    const name = user.full_name || user.username
    if (!window.confirm(`Promote ${name} to Manager?`)) return
    setPromoting(true)
    try {
      await api.post('/api/managers', { user_id: Number(userId) })
      const nextUser = await loadUser()
      await Promise.all([
        resolveGroup(nextUser),
        loadAssignedVehicles(nextUser),
      ])
    } catch (err) {
      console.error('Failed to promote user:', err)
      window.alert(err.response?.data?.detail || 'Failed to promote user')
    } finally {
      setPromoting(false)
    }
  }

  const handleManagerToggle = (event) => {
    if (event.target.checked && !user?.is_manager) {
      handleMakeManager()
    }
  }

  const handleMoveUser = async (adminId) => {
    setMoving(true)
    setMoveError(null)
    try {
      await api.post(`/api/super-admin/users/${userId}/move`, {
        admin_id: adminId == null ? null : Number(adminId),
      })
      setMoveOpen(false)
      const nextUser = await loadUser()
      await Promise.all([
        resolveGroup(nextUser),
        loadAssignedVehicles(nextUser),
      ])
    } catch (err) {
      setMoveError(err.response?.data?.detail || 'Failed to move user')
    } finally {
      setMoving(false)
    }
  }

  const handleDeleteUser = async () => {
    if (!user) return
    setDeleting(true)
    setDeleteError(null)
    try {
      await api.delete(apiFor(`/users/${userId}`, `/api/users/${userId}`))
      navigate(usersListPath)
    } catch (err) {
      setDeleteError(err.response?.data?.detail || 'Failed to delete user')
    } finally {
      setDeleting(false)
    }
  }

  if (notFound) {
    return (
      <div className="ud-page">
        <button
          type="button"
          className="ud-back"
          aria-label="Back to Users"
          onClick={() => navigate(usersListPath)}
        >
          <ArrowLeft size={15} />
          {!isMobile && 'Back to Users'}
        </button>
        <EmptyState title="User not found" />
      </div>
    )
  }
  if (loading && !user) return <LoadingState label="Loading user…" />
  if (!user) return <EmptyState title="No data for this user." />

  const displayName = user.full_name || user.username
  const vehicles = assignedVehicles
  const hasVehicle = (user.vehicles || []).length > 0 || vehicles.length > 0
  const assignedToGroup = Boolean(user.manager_id) || Boolean(user.is_manager)

  return (
    <div className="ud-page">
      <ConfirmDialog
        open={confirmDelete}
        title="Delete user?"
        message={[
          buildDeleteUserMessage(user),
          deleteError,
        ].filter(Boolean).join('\n\n')}
        confirmLabel="Delete user"
        cancelLabel="Cancel"
        variant="danger"
        loading={deleting}
        onConfirm={handleDeleteUser}
        onCancel={() => {
          if (deleting) return
          setConfirmDelete(false)
          setDeleteError(null)
        }}
      />

      {moveOpen && (
        <Modal open={moveOpen} title="Move to fleet admin" onClose={() => !moving && setMoveOpen(false)}>
          {moveError && <p className="ft-login-error">{moveError}</p>}
          <Select
            label="Fleet admin"
            value={moveAdminId}
            onChange={(e) => setMoveAdminId(e.target.value)}
          >
            {admins.map((admin) => (
              <option key={admin.id} value={admin.id}>
                {admin.full_name || admin.username}
              </option>
            ))}
          </Select>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
            <Button type="button" variant="secondary" onClick={() => setMoveOpen(false)} disabled={moving}>
              Cancel
            </Button>
            <Button type="button" loading={moving} onClick={() => handleMoveUser(moveAdminId)}>
              Move user
            </Button>
          </div>
        </Modal>
      )}

      {showEditModal && (
        <EditUserModal
          user={user}
          onClose={() => setShowEditModal(false)}
          onSaved={loadUser}
        />
      )}

      <div className="ud-header">
        <h1 className="ud-title">User Detail</h1>
        <button
          type="button"
          className="ud-back-btn"
          aria-label="Back to Users"
          onClick={() => navigate(usersListPath)}
        >
          <ArrowLeft size={15} />
          {!isMobile && 'Back'}
        </button>
      </div>

      <div className="ud-layout">
        <div className="ud-card">
          <div className="ud-profile-head">
            <Avatar name={displayName} size="2xl" src={userPicSrc(user.pic_url)} />
            <div className="ud-profile-meta">
              <h2 className="ud-profile-name">{displayName}</h2>
              <p className="ud-profile-email">{user.username}</p>
            </div>
            {(can('user_management') || isSuperAdmin) && (
              <div className="ud-profile-menu">
                <Dropdown
                  align="right"
                  trigger={(
                    <button type="button" className="ud-actions-btn" aria-label="User actions">
                      <MoreHorizontal size={16} />
                    </button>
                  )}
                >
                  {can('user_management') && (
                    <DropdownItem onClick={() => setShowEditModal(true)}>
                      <Pencil size={14} />
                      Edit
                    </DropdownItem>
                  )}
                  {!isManager && !user.is_manager && (
                    <DropdownItem onClick={handleMakeManager} disabled={promoting}>
                      <ShieldCheck size={14} />
                      {promoting ? 'Promoting…' : 'Make Manager'}
                    </DropdownItem>
                  )}
                  {isSuperAdmin && (
                    <>
                      <DropdownItem onClick={() => { setMoveError(null); setMoveOpen(true) }}>
                        Move to admin…
                      </DropdownItem>
                      <DropdownItem onClick={() => handleMoveUser(null)} disabled={moving}>
                        Unassign from fleet
                      </DropdownItem>
                    </>
                  )}
                  {can('user_management') && (
                    <DropdownItem danger onClick={() => {
                      setDeleteError(null)
                      setConfirmDelete(true)
                    }}>
                      <Trash2 size={14} />
                      Delete
                    </DropdownItem>
                  )}
                </Dropdown>
              </div>
            )}
          </div>

          <div className="ud-section">
            <h3 className="ud-section-label">Account info</h3>
            <div className="ud-row">
              <span className="ud-row-label">Phone</span>
              <span className="ud-row-value">{user.phone_number || '—'}</span>
            </div>
            <div className="ud-row">
              <span className="ud-row-label">Email</span>
              <span className="ud-row-value">{user.username}</span>
            </div>
          </div>

          <div className="ud-section">
            <h3 className="ud-section-label">Permissions</h3>
            <div className="ud-row ud-toggle-row">
              <span className="ud-row-label">Manager access</span>
              <Switch
                checked={Boolean(user.is_manager)}
                disabled={isManager || user.is_manager || promoting || !can('user_management')}
                onChange={handleManagerToggle}
              />
            </div>
            <div className="ud-row ud-toggle-row">
              <span className="ud-row-label">Assigned to group</span>
              <Switch checked={assignedToGroup} disabled />
            </div>
          </div>

          <div className="ud-section">
            <h3 className="ud-section-label">Access</h3>
            <div className="ud-row ud-toggle-row">
              <span className="ud-row-label">Vehicle assigned</span>
              <Switch checked={hasVehicle} disabled />
            </div>
            <div className="ud-row ud-toggle-row">
              <span className="ud-row-label">Manager permissions</span>
              <Switch checked={Boolean(user.is_manager)} disabled />
            </div>
          </div>
        </div>

        <div className="ud-right">
          <div className="ud-card">
            <h3 className="ud-card-title">Groups</h3>
            <div className="ud-row">
              <span className="ud-row-label">Groups</span>
              <span className="ud-row-value">{groupLabel}</span>
            </div>
            <div className="ud-row ud-toggle-row">
              <span className="ud-row-label">Permissions</span>
              <Switch checked={Boolean(user.is_manager)} disabled />
            </div>
          </div>

          <div className="ud-card ud-card--vehicles">
            <h3 className="ud-card-title">Assigned Vehicles</h3>
            {vehicles.length === 0 ? (
              <p className="ud-empty">No vehicle assigned</p>
            ) : (
              <div className="ud-vehicles-list">
                {vehicles.map((vehicle) => (
                    <div
                      key={vehicle.id}
                      className="ud-vehicle-item"
                      role="button"
                      tabIndex={0}
                      onClick={() => navigate(`${basePath}/vehicles/${vehicle.id}`)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault()
                          navigate(`${basePath}/vehicles/${vehicle.id}`)
                        }
                      }}
                    >
                      <span className="ud-vehicle-icon" aria-hidden>
                        <Avatar
                          name={vehicle.name}
                          size="sm"
                          src={userPicSrc(vehicle.pic_url)}
                        />
                      </span>
                      <span className="ud-vehicle-name">{vehicle.name}</span>
                      <div
                        className="ud-vehicle-menu"
                        onClick={(event) => event.stopPropagation()}
                        onKeyDown={(event) => event.stopPropagation()}
                      >
                        <Dropdown
                          align="right"
                          trigger={(
                            <button
                              type="button"
                              className="ud-actions-btn"
                              aria-label={`${vehicle.name} actions`}
                            >
                              <MoreVertical size={16} />
                            </button>
                          )}
                        >
                          <DropdownItem onClick={() => navigate(`${basePath}/vehicles/${vehicle.id}`)}>
                            <ChevronRight size={14} />
                            View vehicle
                          </DropdownItem>
                        </Dropdown>
                      </div>
                    </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

export default UserDetail
