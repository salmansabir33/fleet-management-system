import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Plus,
  Search,
  Pencil,
  Trash2,
  MoreVertical,
  Truck,
  UserX,
  ChevronRight,
  ChevronUp,
  ChevronDown,
  ChevronsUpDown,
} from 'lucide-react'
import api from '../../api'
import {
  LoadingState,
  Avatar,
  ConfirmDialog,
  Dropdown,
  DropdownItem,
} from '../../shared/components'
import AddDriverModal from '../components/AddDriverModal'
import EditDriverModal from '../components/EditDriverModal'
import AssignVehicleModal from '../components/AssignVehicleModal'
import { usePanelScope } from '../../manager/hooks/usePanelScope'
import { useSaAdminListParams } from '../hooks/useSaAdminListParams'
import AdminFilterBar from '../components/AdminFilterBar'
import { userPicSrc } from '../utils/userPic'
import '../styles/admin-drivers.css'

const STATUS_LABEL = {
  active: 'Active',
  on_leave: 'On Leave',
  inactive: 'Inactive',
}

function statusLabel(status) {
  return STATUS_LABEL[status] || (status || 'Unknown').replace('_', ' ')
}

function SortIcon({ active, dir }) {
  if (!active) return <ChevronsUpDown size={14} className="ad-sort-icon" />
  if (dir === 'asc') return <ChevronUp size={14} className="ad-sort-icon" />
  return <ChevronDown size={14} className="ad-sort-icon" />
}

function DriverStatus({ status }) {
  const key = status === 'on_leave' || status === 'inactive' ? status : 'active'
  return (
    <span className={`ad-status ad-status--${key}`}>
      <span className="ad-status-dot" aria-hidden />
      {statusLabel(status)}
    </span>
  )
}

const Drivers = () => {
  const navigate = useNavigate()
  const { basePath, apiFor, can, isManager } = usePanelScope()
  const saListParams = useSaAdminListParams()
  const canViewDrivers = can('driver_management')
  const canManage = can('driver_management')

  const [drivers, setDrivers] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [sortKey, setSortKey] = useState('name')
  const [sortDir, setSortDir] = useState('asc')

  const [showAddModal, setShowAddModal] = useState(false)
  const [editTarget, setEditTarget] = useState(null)
  const [assignTarget, setAssignTarget] = useState(null)
  const [unassignTarget, setUnassignTarget] = useState(null)
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [actionLoading, setActionLoading] = useState(false)
  const [actionError, setActionError] = useState(null)

  const loadDrivers = useCallback(async () => {
    if (!canViewDrivers) {
      setDrivers([])
      setLoading(false)
      return
    }
    setLoading(true)
    try {
      const res = await api.get(apiFor('/drivers', '/api/drivers'), { params: saListParams })
      setDrivers(res.data)
    } catch (err) {
      console.error('Failed to load drivers:', err)
    } finally {
      setLoading(false)
    }
  }, [apiFor, canViewDrivers, saListParams])

  useEffect(() => {
    loadDrivers()
  }, [loadDrivers])

  useEffect(() => {
    const handle = setTimeout(() => setSearchQuery(search), 250)
    return () => clearTimeout(handle)
  }, [search])

  const openDetail = (driverId) => navigate(`${basePath}/drivers/${driverId}`)

  const filtered = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    if (!q) return drivers
    return drivers.filter((d) => (
      (d.name || '').toLowerCase().includes(q)
      || (d.id_card_number || '').toLowerCase().includes(q)
      || (d.phone_number || '').toLowerCase().includes(q)
      || (d.license_number || '').toLowerCase().includes(q)
      || (d.current_device_name || '').toLowerCase().includes(q)
    ))
  }, [drivers, searchQuery])

  const sorted = useMemo(() => {
    const copy = [...filtered]
    copy.sort((a, b) => {
      let diff = 0
      if (sortKey === 'name') {
        diff = String(a.name || '').localeCompare(String(b.name || ''), undefined, { sensitivity: 'base' })
      } else if (sortKey === 'status') {
        diff = String(a.status || '').localeCompare(String(b.status || ''), undefined, { sensitivity: 'base' })
      } else if (sortKey === 'assignment') {
        diff = String(a.current_device_name || '').localeCompare(String(b.current_device_name || ''), undefined, { sensitivity: 'base' })
      }
      return sortDir === 'asc' ? diff : -diff
    })
    return copy
  }, [filtered, sortKey, sortDir])

  const listItems = sorted

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

  const handleUnassign = async () => {
    if (!unassignTarget) return
    setActionLoading(true)
    setActionError(null)
    try {
      await api.post(apiFor(`/drivers/${unassignTarget.id}/unassign`, `/api/drivers/${unassignTarget.id}/unassign`))
      setUnassignTarget(null)
      await loadDrivers()
    } catch (err) {
      setActionError(err.response?.data?.detail || 'Failed to unassign vehicle')
    } finally {
      setActionLoading(false)
    }
  }

  const handleDelete = async () => {
    if (!deleteTarget) return
    setActionLoading(true)
    setActionError(null)
    try {
      await api.delete(`/api/drivers/${deleteTarget.id}`)
      setDeleteTarget(null)
      await loadDrivers()
    } catch (err) {
      setActionError(err.response?.data?.detail || 'Failed to delete driver')
    } finally {
      setActionLoading(false)
    }
  }

  return (
    <div className="ad-page">
      <ConfirmDialog
        open={Boolean(unassignTarget)}
        title="Unassign vehicle?"
        message={[
          unassignTarget
            ? `Unassign ${unassignTarget.name} from ${unassignTarget.current_device_name || 'their current vehicle'}?`
            : '',
          unassignTarget ? actionError : null,
        ].filter(Boolean).join('\n\n')}
        confirmLabel="Unassign"
        cancelLabel="Cancel"
        variant="danger"
        loading={actionLoading}
        onConfirm={handleUnassign}
        onCancel={() => {
          if (actionLoading) return
          setUnassignTarget(null)
          setActionError(null)
        }}
      />

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title="Delete driver?"
        message={[
          deleteTarget ? `Delete ${deleteTarget.name}? This cannot be undone.` : '',
          deleteTarget ? actionError : null,
        ].filter(Boolean).join('\n\n')}
        confirmLabel="Delete driver"
        cancelLabel="Cancel"
        variant="danger"
        loading={actionLoading}
        onConfirm={handleDelete}
        onCancel={() => {
          if (actionLoading) return
          setDeleteTarget(null)
          setActionError(null)
        }}
      />

      {showAddModal && (
        <AddDriverModal
          onClose={() => setShowAddModal(false)}
          onCreated={loadDrivers}
        />
      )}
      {editTarget && (
        <EditDriverModal
          driver={editTarget}
          onClose={() => setEditTarget(null)}
          onSaved={loadDrivers}
        />
      )}
      {assignTarget && (
        <AssignVehicleModal
          driverId={assignTarget.id}
          currentDeviceId={assignTarget.current_device_id ?? null}
          onClose={() => setAssignTarget(null)}
          onAssigned={loadDrivers}
        />
      )}

      <div className="ad-header">
        <h1 className="ad-title">Drivers</h1>
        <div className="ad-header-actions">
          <div className="ad-search">
            <Search size={15} color="var(--ft-text-disabled)" />
            <input
              type="search"
              placeholder="Search drivers…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <AdminFilterBar inline className="ad-admin-filter" />
          {canManage && (
            <button
              type="button"
              className="ad-btn ad-btn--primary"
              onClick={() => setShowAddModal(true)}
            >
              <Plus size={15} />
              Create Driver
            </button>
          )}
        </div>
      </div>

      <div className="ad-panel">
        {loading && drivers.length === 0 ? (
          <LoadingState label="Loading drivers…" />
        ) : !canViewDrivers ? (
          <div className="ad-empty">You don&apos;t have permission to view this.</div>
        ) : sorted.length === 0 ? (
          <div className="ad-empty">
            {searchQuery ? 'No drivers match your search.' : 'No drivers yet. Create one to get started.'}
          </div>
        ) : (
          <div className="ad-table-section">
            <div className="ad-table-wrap">
              <table className="ad-table">
                <thead>
                  <tr>
                    <th
                      className="ad-th--sortable"
                      onClick={() => toggleSort('name')}
                      aria-sort={sortKey === 'name' ? (sortDir === 'asc' ? 'ascending' : 'descending') : undefined}
                    >
                      <span className="ad-th-label">
                        Name
                        <SortIcon active={sortKey === 'name'} dir={sortDir} />
                      </span>
                    </th>
                    <th>Driver License Info</th>
                    <th
                      className="ad-th--sortable"
                      onClick={() => toggleSort('status')}
                      aria-sort={sortKey === 'status' ? (sortDir === 'asc' ? 'ascending' : 'descending') : undefined}
                    >
                      <span className="ad-th-label">
                        Status
                        <SortIcon active={sortKey === 'status'} dir={sortDir} />
                      </span>
                    </th>
                    <th
                      className="ad-th--sortable"
                      onClick={() => toggleSort('assignment')}
                      aria-sort={sortKey === 'assignment' ? (sortDir === 'asc' ? 'ascending' : 'descending') : undefined}
                    >
                      <span className="ad-th-label">
                        Current Assignment
                        <SortIcon active={sortKey === 'assignment'} dir={sortDir} />
                      </span>
                    </th>
                    <th aria-label="Actions" className="ad-th-actions">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {listItems.map((d) => (
                    <tr
                      key={d.id}
                      className="ad-row ad-row--clickable"
                      onClick={() => openDetail(d.id)}
                      tabIndex={0}
                      role="button"
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault()
                          openDetail(d.id)
                        }
                      }}
                    >
                      <td>
                        <span className="ad-name">
                          <Avatar name={d.name} size="sm" src={userPicSrc(d.driver_pic_path)} />
                          <span className="ad-name-text">
                            <span className="ad-name-title">{d.name}</span>
                            <span className="ad-name-sub">{d.id_card_number || 'Driver'}</span>
                          </span>
                        </span>
                      </td>
                      <td>
                        <span className="ad-stack">
                          <span className="ad-stack-primary">{d.license_number || 'No license on file'}</span>
                          <span className="ad-stack-sub">{d.phone_number || '—'}</span>
                        </span>
                      </td>
                      <td>
                        <DriverStatus status={d.status} />
                      </td>
                      <td className={d.current_device_name ? undefined : 'ad-cell-muted'}>
                        {d.current_device_name || 'Unassigned'}
                      </td>
                      <td onClick={stopRowAction} onKeyDown={stopRowAction}>
                        <div className="ad-row-actions">
                          {canManage && (
                            <button
                              type="button"
                              className="ad-icon-btn ad-icon-btn--edit"
                              aria-label={`Edit ${d.name}`}
                              onClick={() => setEditTarget(d)}
                            >
                              <Pencil size={15} />
                            </button>
                          )}
                          {canManage && !isManager && (
                            <button
                              type="button"
                              className="ad-icon-btn ad-icon-btn--delete"
                              aria-label={`Delete ${d.name}`}
                              onClick={() => {
                                setActionError(null)
                                setDeleteTarget(d)
                              }}
                            >
                              <Trash2 size={15} />
                            </button>
                          )}
                          <Dropdown
                            align="right"
                            trigger={(
                              <button
                                type="button"
                                className="ad-icon-btn"
                                aria-label={`More actions for ${d.name}`}
                              >
                                <MoreVertical size={16} />
                              </button>
                            )}
                          >
                            <DropdownItem onClick={() => openDetail(d.id)}>
                              <ChevronRight size={14} />
                              View details
                            </DropdownItem>
                            {canManage && (
                              <>
                                <DropdownItem onClick={() => setAssignTarget(d)}>
                                  <Truck size={14} />
                                  Assign
                                </DropdownItem>
                                {d.current_device_name && (
                                  <DropdownItem onClick={() => {
                                    setActionError(null)
                                    setUnassignTarget(d)
                                  }}
                                  >
                                    <UserX size={14} />
                                    Unassign
                                  </DropdownItem>
                                )}
                              </>
                            )}
                          </Dropdown>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="ad-cards" aria-label="Drivers">
              {listItems.map((d) => (
                <article
                  key={d.id}
                  className="ad-card"
                  role="button"
                  tabIndex={0}
                  onClick={() => openDetail(d.id)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault()
                      openDetail(d.id)
                    }
                  }}
                >
                  <div className="ad-card-header">
                    <span className="ad-card-identity">
                      <Avatar name={d.name} size="md" src={userPicSrc(d.driver_pic_path)} />
                      <span className="ad-card-name-block">
                        <span className="ad-card-name">{d.name}</span>
                        <span className="ad-card-id">{d.id_card_number || 'Driver'}</span>
                      </span>
                    </span>
                    <DriverStatus status={d.status} />
                  </div>

                  <div className="ad-card-main">
                    <div className="ad-card-body">
                      <div className="ad-card-row">
                        <span className="ad-card-label">License</span>
                        <span className="ad-card-value">
                          {d.license_number || 'No license on file'}
                        </span>
                      </div>
                      <div className="ad-card-row">
                        <span className="ad-card-label">Phone</span>
                        <span className="ad-card-value ad-cell-muted">
                          {d.phone_number || '—'}
                        </span>
                      </div>
                      <div className="ad-card-row">
                        <span className="ad-card-label">Assignment</span>
                        <span className={`ad-card-value${d.current_device_name ? '' : ' ad-cell-muted'}`}>
                          {d.current_device_name || 'Unassigned'}
                        </span>
                      </div>
                    </div>

                    {canManage && (
                      <div
                        className="ad-card-side-actions"
                        onClick={stopRowAction}
                        onKeyDown={stopRowAction}
                      >
                        <button
                          type="button"
                          className="ad-action-btn"
                          onClick={() => setAssignTarget(d)}
                        >
                          <Truck size={14} />
                          Assign
                        </button>
                        {d.current_device_name && (
                          <button
                            type="button"
                            className="ad-action-btn"
                            onClick={() => {
                              setActionError(null)
                              setUnassignTarget(d)
                            }}
                          >
                            <UserX size={14} />
                            Unassign
                          </button>
                        )}
                      </div>
                    )}
                  </div>

                  {canManage && (
                    <div
                      className="ad-card-actions"
                      onClick={stopRowAction}
                      onKeyDown={stopRowAction}
                    >
                      <button
                        type="button"
                        className="ad-action-btn ad-action-btn--edit"
                        onClick={() => setEditTarget(d)}
                      >
                        <Pencil size={14} />
                        Edit
                      </button>
                      {!isManager && (
                        <button
                          type="button"
                          className="ad-action-btn ad-action-btn--delete"
                          onClick={() => {
                            setActionError(null)
                            setDeleteTarget(d)
                          }}
                        >
                          <Trash2 size={14} />
                          Delete
                        </button>
                      )}
                    </div>
                  )}
                </article>
              ))}
            </div>

          </div>
        )}
      </div>
    </div>
  )
}

export default Drivers
