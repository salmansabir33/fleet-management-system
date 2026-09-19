import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
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
  ChevronsLeft,
  ChevronsRight,
  ChevronLeft,
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
import { userPicSrc } from '../utils/userPic'
import '../styles/admin-drivers.css'

const MIN_PAGE_SIZE = 1
const FALLBACK_PAGE_SIZE = 8
const FALLBACK_ROW_HEIGHT = 65
const FALLBACK_HEAD_HEIGHT = 48
/** Matches `.ad-cards` / table swap in admin-drivers.css */
const MOBILE_CARDS_MQ = '(max-width: 768px)'

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

function DriversPagination({ page, pageCount, onPageChange }) {
  if (!pageCount || pageCount < 1) return null

  return (
    <nav className="ad-pagination" aria-label="Pagination">
      <button
        type="button"
        className="ad-page-btn"
        disabled={page <= 1}
        aria-label="First page"
        onClick={() => onPageChange(1)}
      >
        <ChevronsLeft size={14} />
      </button>
      <button
        type="button"
        className="ad-page-btn"
        disabled={page <= 1}
        aria-label="Previous page"
        onClick={() => onPageChange(page - 1)}
      >
        <ChevronLeft size={14} />
      </button>
      <button
        type="button"
        className="ad-page-btn ad-page-btn--active"
        aria-current="page"
        onClick={() => onPageChange(page)}
      >
        {page}
      </button>
      <button
        type="button"
        className="ad-page-btn"
        disabled={page >= pageCount}
        aria-label="Next page"
        onClick={() => onPageChange(page + 1)}
      >
        <ChevronRight size={14} />
      </button>
      <button
        type="button"
        className="ad-page-btn"
        disabled={page >= pageCount}
        aria-label="Last page"
        onClick={() => onPageChange(pageCount)}
      >
        <ChevronsRight size={14} />
      </button>
    </nav>
  )
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
  const canViewDrivers = can('driver_management')
  const canManage = can('driver_management')

  const [drivers, setDrivers] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(FALLBACK_PAGE_SIZE)
  const [sortKey, setSortKey] = useState('name')
  const [sortDir, setSortDir] = useState('asc')
  const [isMobile, setIsMobile] = useState(() => (
    typeof window !== 'undefined' ? window.matchMedia(MOBILE_CARDS_MQ).matches : false
  ))

  const [showAddModal, setShowAddModal] = useState(false)
  const [editTarget, setEditTarget] = useState(null)
  const [assignTarget, setAssignTarget] = useState(null)
  const [unassignTarget, setUnassignTarget] = useState(null)
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [actionLoading, setActionLoading] = useState(false)
  const [actionError, setActionError] = useState(null)
  const tableWrapRef = useRef(null)

  useEffect(() => {
    const mq = window.matchMedia(MOBILE_CARDS_MQ)
    const sync = () => setIsMobile(mq.matches)
    sync()
    mq.addEventListener('change', sync)
    return () => mq.removeEventListener('change', sync)
  }, [])

  const loadDrivers = useCallback(async () => {
    if (!canViewDrivers) {
      setDrivers([])
      setLoading(false)
      return
    }
    setLoading(true)
    try {
      const res = await api.get(apiFor('/drivers', '/api/drivers'))
      setDrivers(res.data)
    } catch (err) {
      console.error('Failed to load drivers:', err)
    } finally {
      setLoading(false)
    }
  }, [apiFor, canViewDrivers])

  useEffect(() => {
    loadDrivers()
  }, [loadDrivers])

  useEffect(() => {
    const handle = setTimeout(() => setSearchQuery(search), 250)
    return () => clearTimeout(handle)
  }, [search])

  useEffect(() => {
    setPage(1)
  }, [searchQuery])

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

  const pageCount = Math.max(1, Math.ceil(sorted.length / pageSize))
  // Mobile: full list in page scroll (no pagination). Desktop: sliced page.
  const listItems = isMobile ? sorted : sorted.slice((page - 1) * pageSize, page * pageSize)

  useEffect(() => {
    const wrap = tableWrapRef.current
    if (!wrap) return undefined

    const measure = () => {
      // Table is hidden on mobile; page size unused while isMobile shows the full list.
      if (window.matchMedia(MOBILE_CARDS_MQ).matches) {
        setPageSize((prev) => (prev === FALLBACK_PAGE_SIZE ? prev : FALLBACK_PAGE_SIZE))
        return
      }
      const thead = wrap.querySelector('thead')
      const row = wrap.querySelector('tbody tr')
      const headH = thead?.getBoundingClientRect().height || FALLBACK_HEAD_HEIGHT
      const rowH = row?.getBoundingClientRect().height || FALLBACK_ROW_HEIGHT
      if (rowH <= 0) return
      const next = Math.max(MIN_PAGE_SIZE, Math.floor((wrap.clientHeight - headH) / rowH))
      setPageSize((prev) => (prev === next ? prev : next))
    }

    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(wrap)
    const mq = window.matchMedia(MOBILE_CARDS_MQ)
    mq.addEventListener('change', measure)
    return () => {
      observer.disconnect()
      mq.removeEventListener('change', measure)
    }
  }, [loading, sorted.length])

  useEffect(() => {
    if (!isMobile && page > pageCount) setPage(pageCount)
  }, [page, pageCount, isMobile])

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
            <div className="ad-table-wrap" ref={tableWrapRef}>
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

            {!isMobile && (
              <div className="ad-footer">
                <span className="ad-footer-meta">
                  Showing {(page - 1) * pageSize + 1} to{' '}
                  {Math.min(page * pageSize, sorted.length)} of {sorted.length}
                </span>
                <DriversPagination page={page} pageCount={pageCount} onPageChange={setPage} />
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

export default Drivers
