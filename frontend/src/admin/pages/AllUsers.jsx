import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  UserPlus,
  Search,
  Pencil,
  Trash2,
  ArrowRight,
  ChevronRight,
  ChevronUp,
  ChevronDown,
  ChevronsUpDown,
  Eye,
  EyeOff,
} from 'lucide-react'
import api from '../../api'
import { useAuth } from '../../auth/AuthContext'
import {
  LoadingState,
  Avatar,
  ConfirmDialog,
} from '../../shared/components'
import { MobilePageHeading } from '../../shared/shell'
import { adminNavLabel } from '../navItems'
import CreateUserModal from '../components/CreateUserModal'
import AddManagerModal from '../components/AddManagerModal'
import EditUserModal from '../components/EditUserModal'
import AssignManagerModal from '../components/AssignManagerModal'
import { usePanelScope } from '../../manager/hooks/usePanelScope'
import { useSaAdminListParams, useShowSaAdminFilter } from '../hooks/useSaAdminListParams'
import AdminFilterBar from '../components/AdminFilterBar'
import { userPicSrc } from '../utils/userPic'
import '../styles/all-users.css'

function PasswordReveal({ userId }) {
  const { role } = useAuth()
  const [revealed, setRevealed] = useState(false)
  const [password, setPassword] = useState(null)
  const [loading, setLoading] = useState(false)

  if (role !== 'admin') return null

  const toggle = async (event) => {
    event.stopPropagation()
    if (revealed) {
      setRevealed(false)
      return
    }
    setLoading(true)
    try {
      const res = await api.get(`/api/users/${userId}/password`)
      setPassword(res.data?.password || '—')
      setRevealed(true)
    } catch {
      setPassword('Unavailable')
      setRevealed(true)
    } finally {
      setLoading(false)
    }
  }

  return (
    <span className="au-users-password">
      {revealed ? (password || '—') : '••••••••'}
      <button
        type="button"
        className="au-users-icon-btn au-users-icon-btn--reveal"
        aria-label={revealed ? 'Hide password' : 'Reveal password'}
        onClick={toggle}
        disabled={loading}
      >
        {revealed ? <EyeOff size={14} /> : <Eye size={14} />}
      </button>
    </span>
  )
}

function UserVehicles({ vehicles }) {
  if (!vehicles.length) {
    return <span className="au-users-cell-muted">—</span>
  }
  return (
    <span className="au-users-pills">
      {vehicles.map((v) => (
        <span key={v.id} className="au-users-pill">
          {v.name}
        </span>
      ))}
    </span>
  )
}

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

function SortIcon({ active, dir }) {
  if (!active) return <ChevronsUpDown size={14} className="au-users-sort-icon" />
  if (dir === 'asc') return <ChevronUp size={14} className="au-users-sort-icon" />
  return <ChevronDown size={14} className="au-users-sort-icon" />
}

const AllUsers = () => {
  const navigate = useNavigate()
  const { role } = useAuth()
  const { basePath, apiFor, isManager, can } = usePanelScope()
  const saListParams = useSaAdminListParams()
  const showAdminCol = useShowSaAdminFilter()
  const [users, setUsers] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [sortKey, setSortKey] = useState('id')
  const [sortDir, setSortDir] = useState('asc')
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [showAddManagerModal, setShowAddManagerModal] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [editTarget, setEditTarget] = useState(null)
  const [managerTarget, setManagerTarget] = useState(null)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState(null)

  const loadUsers = useCallback(async (q) => {
    setLoading(true)
    try {
      const params = { ...saListParams, ...(q ? { q } : {}) }
      const res = await api.get(apiFor('/users', '/api/users'), { params })
      setUsers(res.data)
    } catch (err) {
      console.error('Failed to load users:', err)
    } finally {
      setLoading(false)
    }
  }, [apiFor, saListParams])

  useEffect(() => {
    const handle = setTimeout(() => loadUsers(search), 250)
    return () => clearTimeout(handle)
  }, [search, loadUsers])

  const openDetail = (userId) => navigate(`${basePath}/users/${userId}`)

  const handleCreated = () => {
    loadUsers(search)
  }

  const handlePromoted = () => {
    loadUsers(search)
  }

  const handleDeleteConfirm = async () => {
    if (!deleteTarget) return
    setDeleting(true)
    setDeleteError(null)
    try {
      await api.delete(apiFor(`/users/${deleteTarget.id}`, `/api/users/${deleteTarget.id}`))
      setDeleteTarget(null)
      await loadUsers(search)
    } catch (err) {
      setDeleteError(err.response?.data?.detail || 'Failed to delete user')
    } finally {
      setDeleting(false)
    }
  }

  const sortedUsers = useMemo(() => {
    const copy = [...users]
    copy.sort((a, b) => {
      let diff = 0
      if (sortKey === 'id') {
        diff = (a.id ?? 0) - (b.id ?? 0)
      } else if (sortKey === 'email') {
        diff = String(a.username || '').localeCompare(String(b.username || ''), undefined, { sensitivity: 'base' })
      } else if (sortKey === 'role') {
        const roleA = a.is_manager ? 1 : 0
        const roleB = b.is_manager ? 1 : 0
        diff = roleA - roleB
      }
      return sortDir === 'asc' ? diff : -diff
    })
    return copy
  }, [users, sortKey, sortDir])

  const listUsers = sortedUsers

  const toggleSort = (key) => {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
      return
    }
    setSortKey(key)
    setSortDir('asc')
  }

  const stopRowAction = (event) => {
    event.stopPropagation()
  }

  const openManageGroups = () => setShowAddManagerModal(true)

  return (
    <div className="au-users-page">
      <MobilePageHeading>{adminNavLabel('/admin/users')}</MobilePageHeading>
      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title="Delete user?"
        message={[
          deleteTarget ? buildDeleteUserMessage(deleteTarget) : '',
          deleteError,
        ].filter(Boolean).join('\n\n')}
        confirmLabel="Delete user"
        cancelLabel="Cancel"
        variant="danger"
        loading={deleting}
        onConfirm={handleDeleteConfirm}
        onCancel={() => {
          if (deleting) return
          setDeleteTarget(null)
          setDeleteError(null)
        }}
      />

      {showCreateModal && (
        <CreateUserModal
          onClose={() => setShowCreateModal(false)}
          onCreated={handleCreated}
        />
      )}
      {showAddManagerModal && (
        <AddManagerModal
          onClose={() => setShowAddManagerModal(false)}
          onPromoted={handlePromoted}
        />
      )}
      {editTarget && (
        <EditUserModal
          user={editTarget}
          onClose={() => setEditTarget(null)}
          onSaved={() => loadUsers(search)}
        />
      )}
      {managerTarget && (
        <AssignManagerModal
          user={managerTarget}
          onClose={() => setManagerTarget(null)}
          onAssigned={() => loadUsers(search)}
        />
      )}

      <div className="au-users-header">
        <div className="au-users-search">
          <Search size={15} color="var(--ft-text-disabled)" />
          <input
            type="search"
            placeholder="Search users…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <AdminFilterBar inline className="au-users-admin-filter" />
        <div className="au-users-header-actions">
          {can('user_management') && (
            <button
              type="button"
              className="au-users-btn au-users-btn--ghost"
              onClick={() => setShowCreateModal(true)}
            >
              <UserPlus size={15} />
              Add user & vehicle
            </button>
          )}
          {!isManager && (
            <button
              type="button"
              className="au-users-btn au-users-btn--primary"
              onClick={openManageGroups}
            >
              Add Manager
            </button>
          )}
        </div>
      </div>

      <div className="au-users-panel">
        {loading && users.length === 0 ? (
          <LoadingState label="Loading users…" />
        ) : users.length === 0 ? (
          <>
            <div className="au-users-empty">
              {search ? 'No users match your search.' : 'No users yet. Add one to get started.'}
            </div>
            {!isManager && (
              <div className="au-users-footer">
                <span />
                <button
                  type="button"
                  className="au-users-btn au-users-btn--ghost au-users-footer-btn"
                  onClick={openManageGroups}
                >
                  Add Manager
                </button>
              </div>
            )}
          </>
        ) : (
          <div className="au-users-table-section">
            <div className="au-users-table-wrap">
              <table className="au-users-table">
                <thead>
                  <tr>
                    <th
                      className="au-users-th--sortable"
                      onClick={() => toggleSort('id')}
                      aria-sort={sortKey === 'id' ? (sortDir === 'asc' ? 'ascending' : 'descending') : undefined}
                    >
                      <span className="au-users-th-label">
                        User ID
                        <SortIcon active={sortKey === 'id'} dir={sortDir} />
                      </span>
                    </th>
                    <th>Full Name</th>
                    <th
                      className="au-users-th--sortable"
                      onClick={() => toggleSort('email')}
                      aria-sort={sortKey === 'email' ? (sortDir === 'asc' ? 'ascending' : 'descending') : undefined}
                    >
                      <span className="au-users-th-label">
                        Username
                        <SortIcon active={sortKey === 'email'} dir={sortDir} />
                      </span>
                    </th>
                    {role === 'admin' && <th>Password</th>}
                    {showAdminCol && <th>Admin</th>}
                    <th
                      className="au-users-th--sortable"
                      onClick={() => toggleSort('role')}
                      aria-sort={sortKey === 'role' ? (sortDir === 'asc' ? 'ascending' : 'descending') : undefined}
                    >
                      <span className="au-users-th-label">
                        Role
                        <SortIcon active={sortKey === 'role'} dir={sortDir} />
                      </span>
                    </th>
                    <th>Vehicle</th>
                    <th aria-label="Actions" className="au-users-th-actions">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {listUsers.map((u) => {
                    const displayName = u.full_name || u.username
                    const vehicles = u.vehicles || []
                    return (
                      <tr
                        key={u.id}
                        className="au-users-row au-users-row--clickable"
                        onClick={() => openDetail(u.id)}
                        tabIndex={0}
                        role="button"
                        onKeyDown={(event) => {
                          if (event.key === 'Enter' || event.key === ' ') {
                            event.preventDefault()
                            openDetail(u.id)
                          }
                        }}
                      >
                        <td className="au-users-cell-id">{u.id}</td>
                        <td>
                          <span className="au-users-name">
                            <Avatar name={displayName} size="sm" src={userPicSrc(u.pic_url)} />
                            <span>{displayName}</span>
                          </span>
                        </td>
                        <td className="au-users-cell-muted">{u.username}</td>
                        {role === 'admin' && (
                          <td className="au-users-cell-muted">
                            <PasswordReveal userId={u.id} />
                          </td>
                        )}
                        {showAdminCol && (
                          <td className="au-users-cell-muted">
                            {u.admin_id == null ? 'Unassigned' : `#${u.admin_id}`}
                          </td>
                        )}
                        <td>{u.is_manager ? 'Manager' : 'User'}</td>
                        <td>
                          <UserVehicles vehicles={vehicles} />
                        </td>
                        <td>
                          <div className="au-users-row-actions">
                            {can('user_management') && (
                              <>
                                <button
                                  type="button"
                                  className="au-users-icon-btn au-users-icon-btn--edit"
                                  aria-label={`Edit ${displayName}`}
                                  onClick={(event) => {
                                    stopRowAction(event)
                                    setEditTarget(u)
                                  }}
                                  onKeyDown={stopRowAction}
                                >
                                  <Pencil size={15} />
                                </button>
                                <button
                                  type="button"
                                  className="au-users-icon-btn au-users-icon-btn--delete"
                                  aria-label={`Delete ${displayName}`}
                                  onClick={(event) => {
                                    stopRowAction(event)
                                    setDeleteError(null)
                                    setDeleteTarget(u)
                                  }}
                                  onKeyDown={stopRowAction}
                                >
                                  <Trash2 size={15} />
                                </button>
                              </>
                            )}
                            {role === 'super_admin' && !u.is_manager && (
                              <button
                                type="button"
                                className="au-users-icon-btn"
                                aria-label={`Assign ${displayName} to manager`}
                                title="Assign to manager"
                                onClick={(event) => {
                                  stopRowAction(event)
                                  setManagerTarget(u)
                                }}
                                onKeyDown={stopRowAction}
                              >
                                <UserPlus size={15} />
                              </button>
                            )}
                            <button
                              type="button"
                              className="au-users-icon-btn au-users-icon-btn--open"
                              aria-label={`Open ${displayName} details`}
                              onClick={() => openDetail(u.id)}
                            >
                              <ArrowRight size={16} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            <div className="au-users-cards" aria-label="Users">
              {listUsers.map((u) => {
                const displayName = u.full_name || u.username
                const vehicles = u.vehicles || []
                return (
                  <article
                    key={u.id}
                    className="au-users-card"
                    role="button"
                    tabIndex={0}
                    onClick={() => openDetail(u.id)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault()
                        openDetail(u.id)
                      }
                    }}
                  >
                    <div className="au-users-card-header">
                      <span className="au-users-card-identity">
                        <Avatar name={displayName} size="md" src={userPicSrc(u.pic_url)} />
                        <span className="au-users-card-name-block">
                          <span className="au-users-card-name">{displayName}</span>
                          <span className="au-users-card-id">ID {u.id}</span>
                        </span>
                      </span>
                      <span className={`au-users-role-badge${u.is_manager ? ' au-users-role-badge--manager' : ''}`}>
                        {u.is_manager ? 'Manager' : 'User'}
                      </span>
                    </div>

                    <div className="au-users-card-body">
                      <div className="au-users-card-row">
                        <span className="au-users-card-label">Username</span>
                        <span className="au-users-card-value au-users-cell-muted">{u.username}</span>
                      </div>
                      {role === 'admin' && (
                        <div className="au-users-card-row">
                          <span className="au-users-card-label">Password</span>
                          <span className="au-users-card-value au-users-cell-muted">
                            <PasswordReveal userId={u.id} />
                          </span>
                        </div>
                      )}
                      <div className="au-users-card-row">
                        <span className="au-users-card-label">Vehicle</span>
                        <span className="au-users-card-value">
                          <UserVehicles vehicles={vehicles} />
                        </span>
                      </div>
                    </div>

                    {(can('user_management') || role === 'super_admin') && (
                      <div
                        className="au-users-card-actions"
                        onClick={stopRowAction}
                        onKeyDown={stopRowAction}
                      >
                        {can('user_management') && (
                          <>
                            <button
                              type="button"
                              className="au-users-action-btn au-users-action-btn--edit"
                              onClick={() => setEditTarget(u)}
                            >
                              <Pencil size={14} />
                              Edit
                            </button>
                            <button
                              type="button"
                              className="au-users-action-btn au-users-action-btn--delete"
                              onClick={() => {
                                setDeleteError(null)
                                setDeleteTarget(u)
                              }}
                            >
                              <Trash2 size={14} />
                              Delete
                            </button>
                          </>
                        )}
                        {role === 'super_admin' && !u.is_manager && (
                          <button
                            type="button"
                            className="au-users-action-btn"
                            onClick={() => setManagerTarget(u)}
                          >
                            <UserPlus size={14} />
                            Manager
                          </button>
                        )}
                      </div>
                    )}
                  </article>
                )
              })}
            </div>

          </div>
        )}
      </div>
    </div>
  )
}

export default AllUsers
