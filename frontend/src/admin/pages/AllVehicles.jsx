import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Search,
  Filter,
  ChevronDown,
  ChevronUp,
  MapPin,
  Car,
  Pencil,
  Trash2,
} from 'lucide-react'
import api from '../../api'
import {
  FilterBar,
  LoadingState,
  EmptyState,
  Avatar,
  ConfirmDialog,
} from '../../shared/components'
import { MobilePageHeading } from '../../shared/shell'
import { adminNavLabel } from '../navItems'
import {
  deriveVehicleStatus,
  isVehicleOnline,
  matchesVehicleStatusFilter,
  tallyVehicleStatusCounts,
  VEHICLE_STATUS_FILTERS,
} from '../../user/utils/vehicleStatus'
import { usePanelScope } from '../../manager/hooks/usePanelScope'
import { userPicSrc } from '../utils/userPic'
import { vehiclePhotoSrc } from '../../user/utils/vehiclePhoto'
import '../styles/all-vehicles.css'

const EditVehicleUserModal = lazy(() => import('../components/EditVehicleUserModal'))
const CreateUserModal = lazy(() => import('../components/CreateUserModal'))

const FILTERS = VEHICLE_STATUS_FILTERS
const LIVE_POLL_MS = 15000
const MOBILE_CARDS_MQ = '(max-width: 768px)'

const formatLocation = (position) => {
  if (position?.address) return position.address
  if (position?.latitude == null || position?.longitude == null) return '—'
  return `${position.latitude.toFixed(2)}, ${position.longitude.toFixed(2)}`
}

const formatMakeModel = (row) => {
  const type = row.vehicle_type
    ? row.vehicle_type.charAt(0).toUpperCase() + row.vehicle_type.slice(1)
    : null
  const name = row.device?.name
  if (type && name) return `${type} ${name}`
  return name || type || '—'
}

const assignedDisplay = (row) => {
  if (row.owner) {
    return {
      name: row.owner.full_name || row.owner.username,
      src: userPicSrc(row.owner.pic_url),
    }
  }
  if (row.active_driver) {
    return {
      name: row.active_driver.name,
      src: userPicSrc(row.active_driver.pic_url),
    }
  }
  return { name: 'Unassigned', src: null }
}

function VehicleStatusPill({ status }) {
  if (status === 'moving') {
    return (
      <span className="av-vehicles-status av-vehicles-status--moving">
        <span className="av-vehicles-status-dot" aria-hidden />
        Moving
      </span>
    )
  }
  if (isVehicleOnline(status)) {
    return (
      <span className="av-vehicles-status av-vehicles-status--online">
        <span className="av-vehicles-status-dot" aria-hidden />
        Online
      </span>
    )
  }
  return (
    <span className="av-vehicles-status av-vehicles-status--offline">
      <Car size={13} aria-hidden />
      Offline
    </span>
  )
}

const buildDeleteMessage = (row) => {
  const vehicleLabel = row.device?.name || `Vehicle ${row.db_id}`
  const owner = row.owner
  if (!owner) {
    return `Delete "${vehicleLabel}"? This cannot be undone.`
  }
  const ownerLabel = owner.full_name || owner.username
  let message = `Deleting this vehicle will also delete the corresponding user (${ownerLabel}).`
  if (owner.is_manager) {
    message += ' Because this user is a manager, their manager role will be removed and any users assigned to them will be unassigned.'
  }
  message += ' This action cannot be undone.'
  return message
}

const AllVehicles = () => {
  const navigate = useNavigate()
  const { basePath, apiFor, can } = usePanelScope()
  const canViewFleet = can('live_tracking')
  const canManageVehicles = can('vehicle_management')
  const canAddUser = can('user_management')
  const [live, setLive] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [showFilters, setShowFilters] = useState(false)
  const [sortDir, setSortDir] = useState('asc')
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [editTarget, setEditTarget] = useState(null)
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [useCards, setUseCards] = useState(
    () => typeof window !== 'undefined' && window.matchMedia(MOBILE_CARDS_MQ).matches,
  )
  const inflightRef = useRef(false)

  const loadLive = useCallback(async () => {
    if (!canViewFleet) {
      setLive([])
      setLoading(false)
      return
    }
    if (inflightRef.current) return
    inflightRef.current = true
    try {
      const res = await api.get(apiFor('/vehicles', '/api/live'))
      setLive(res.data.live || [])
    } catch (err) {
      console.error('Failed to load vehicles:', err)
    } finally {
      inflightRef.current = false
      setLoading(false)
    }
  }, [apiFor, canViewFleet])

  useEffect(() => {
    loadLive()
    const tick = () => {
      if (typeof document !== 'undefined' && document.hidden) return
      loadLive()
    }
    const interval = setInterval(tick, LIVE_POLL_MS)
    const onVisible = () => {
      if (!document.hidden) loadLive()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      clearInterval(interval)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [loadLive])

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return undefined
    const mq = window.matchMedia(MOBILE_CARDS_MQ)
    const sync = () => setUseCards(mq.matches)
    sync()
    mq.addEventListener('change', sync)
    return () => mq.removeEventListener('change', sync)
  }, [])

  const rows = useMemo(() => live
    .filter((item) => item.db_id != null)
    .map((item) => ({
      ...item,
      status: deriveVehicleStatus(item),
    })), [live])

  const statusCounts = useMemo(
    () => tallyVehicleStatusCounts(rows.map((r) => r.status)),
    [rows],
  )

  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase()
    return rows.filter((r) => {
      if (!matchesVehicleStatusFilter(r.status, statusFilter)) return false
      if (!q) return true
      const name = (r.device?.name || '').toLowerCase()
      const plate = (r.plate_number || '').toLowerCase()
      const driver = (r.active_driver?.name || '').toLowerCase()
      const owner = (r.owner?.full_name || r.owner?.username || '').toLowerCase()
      const vin = (r.device?.uniqueId || '').toLowerCase()
      return name.includes(q) || plate.includes(q) || driver.includes(q) || owner.includes(q) || vin.includes(q)
    })
  }, [rows, statusFilter, search])

  const sortedRows = useMemo(() => {
    const copy = [...filteredRows]
    copy.sort((a, b) => {
      const diff = (a.db_id ?? 0) - (b.db_id ?? 0)
      return sortDir === 'asc' ? diff : -diff
    })
    return copy
  }, [filteredRows, sortDir])

  const openDetail = (dbId) => navigate(`${basePath}/vehicles/${dbId}`)

  const stopRowAction = (event) => {
    event.stopPropagation()
  }

  const deleteApiPath = (dbId) => (
    apiFor(`/vehicles/${dbId}`, `/api/fleet/devices/${dbId}`)
  )

  const handleDeleteConfirm = async () => {
    if (!deleteTarget) return
    setDeleting(true)
    try {
      await api.delete(deleteApiPath(deleteTarget.db_id))
      setDeleteTarget(null)
      await loadLive()
    } catch (err) {
      window.alert(err.response?.data?.detail || 'Failed to delete vehicle')
    } finally {
      setDeleting(false)
    }
  }

  const filterOptions = FILTERS.map((f) => ({
    key: f.key,
    label: f.label,
    count: statusCounts[f.key] || 0,
  }))

  const toggleSort = () => setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))

  return (
    <div className="av-vehicles-page">
      <MobilePageHeading>{adminNavLabel('/admin/vehicles')}</MobilePageHeading>
      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title="Delete vehicle?"
        message={deleteTarget ? buildDeleteMessage(deleteTarget) : ''}
        confirmLabel="Delete vehicle"
        cancelLabel="Cancel"
        variant="danger"
        loading={deleting}
        onConfirm={handleDeleteConfirm}
        onCancel={() => !deleting && setDeleteTarget(null)}
      />

      {editTarget && (
        <Suspense fallback={null}>
          <EditVehicleUserModal
            vehicleRow={editTarget}
            onClose={() => setEditTarget(null)}
            onSaved={loadLive}
          />
        </Suspense>
      )}
      {showCreateModal && (
        <Suspense fallback={null}>
          <CreateUserModal
            onClose={() => setShowCreateModal(false)}
            onCreated={loadLive}
          />
        </Suspense>
      )}

      <div className="av-vehicles-panel">
        <div className="av-vehicles-toolbar">
          <div className="av-vehicles-search ft-search">
            <Search size={16} color="var(--ft-text-disabled)" />
            <input
              type="search"
              placeholder="Search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          <div className="av-vehicles-toolbar-actions">
            <button
              type="button"
              className="av-vehicles-filters-btn"
              onClick={() => setShowFilters((v) => !v)}
              aria-expanded={showFilters}
            >
              <Filter size={15} />
              Filters
              <ChevronDown
                size={14}
                style={{
                  transition: 'transform 0.2s ease',
                  transform: showFilters ? 'rotate(180deg)' : undefined,
                }}
              />
            </button>

            {canAddUser && (
              <button
                type="button"
                className="av-vehicles-new-btn"
                onClick={() => setShowCreateModal(true)}
              >
                Add user
              </button>
            )}
          </div>
        </div>

        <div
          className={`av-vehicles-filters-panel${showFilters ? ' av-vehicles-filters-panel--open' : ''}`}
        >
          <FilterBar
            options={filterOptions}
            value={statusFilter}
            onChange={setStatusFilter}
          />
        </div>

        {loading && rows.length === 0 ? (
          <LoadingState label="Loading vehicles…" />
        ) : !canViewFleet ? (
          <EmptyState title="Not permitted" description="You don't have permission to view this." />
        ) : sortedRows.length === 0 ? (
          <div className="av-vehicles-empty">No vehicles match your search or filters.</div>
        ) : (
          <div className="av-vehicles-table-section">
            {!useCards && (
              <div className="av-vehicles-table-wrap">
                <table className="av-vehicles-table">
                  <thead>
                    <tr>
                      <th
                        className="av-vehicles-th--sortable"
                        onClick={toggleSort}
                        aria-sort={sortDir === 'asc' ? 'ascending' : 'descending'}
                      >
                        <span className="av-vehicles-th-label">
                          Vehicle ID
                          {sortDir === 'asc' ? (
                            <ChevronUp size={14} className="av-vehicles-sort-icon" />
                          ) : (
                            <ChevronDown size={14} className="av-vehicles-sort-icon" />
                          )}
                        </span>
                      </th>
                      <th>VIN</th>
                      <th>Make/Model</th>
                      <th>Assigned User</th>
                      <th>Location</th>
                      <th>Status</th>
                      {canManageVehicles && <th>Actions</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {sortedRows.map((r) => {
                      const assigned = assignedDisplay(r)
                      return (
                        <tr
                          key={r.db_id}
                          className="av-vehicles-row av-vehicles-row--clickable"
                          onClick={() => openDetail(r.db_id)}
                          tabIndex={0}
                          role="button"
                          onKeyDown={(event) => {
                            if (event.key === 'Enter' || event.key === ' ') {
                              event.preventDefault()
                              openDetail(r.db_id)
                            }
                          }}
                        >
                          <td className="av-vehicles-cell-id">{r.db_id}</td>
                          <td className="av-vehicles-cell-muted">
                            {r.device?.uniqueId || '—'}
                          </td>
                          <td>{formatMakeModel(r)}</td>
                          <td>
                            <span className="av-vehicles-user">
                              <Avatar
                                name={assigned.name}
                                size="sm"
                                src={assigned.src}
                              />
                              <span>{assigned.name}</span>
                            </span>
                          </td>
                          <td>
                            <span className="av-vehicles-location">
                              <MapPin size={14} />
                              {formatLocation(r.position)}
                            </span>
                          </td>
                          <td>
                            <VehicleStatusPill status={r.status} />
                          </td>
                          {canManageVehicles && (
                            <td onClick={stopRowAction} onKeyDown={stopRowAction}>
                              <div className="av-vehicles-row-actions">
                                <button
                                  type="button"
                                  className="av-vehicles-action-btn av-vehicles-action-btn--edit"
                                  onClick={() => setEditTarget(r)}
                                >
                                  <Pencil size={14} />
                                  Edit
                                </button>
                                <button
                                  type="button"
                                  className="av-vehicles-action-btn av-vehicles-action-btn--delete"
                                  onClick={() => setDeleteTarget(r)}
                                >
                                  <Trash2 size={14} />
                                  Delete
                                </button>
                              </div>
                            </td>
                          )}
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {useCards && (
              <div className="av-vehicles-cards" aria-label="Vehicles">
                {sortedRows.map((r) => {
                  const assigned = assignedDisplay(r)
                  return (
                    <article
                      key={r.db_id}
                      className="av-vehicles-card"
                      role="button"
                      tabIndex={0}
                      onClick={() => openDetail(r.db_id)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault()
                          openDetail(r.db_id)
                        }
                      }}
                    >
                      <div className="av-vehicles-card-header">
                        <span className="av-vehicles-card-identity">
                          <Avatar
                            name={r.device?.name || formatMakeModel(r)}
                            size="md"
                            src={vehiclePhotoSrc(r)}
                            className="av-vehicles-card-photo"
                          />
                          <span className="av-vehicles-card-name">
                            {r.device?.name || formatMakeModel(r)}
                          </span>
                        </span>
                        <VehicleStatusPill status={r.status} />
                      </div>

                      <div className="av-vehicles-card-body">
                        <div className="av-vehicles-card-row">
                          <span className="av-vehicles-card-label">VIN</span>
                          <span className="av-vehicles-card-value av-vehicles-cell-muted">
                            {r.device?.uniqueId || '—'}
                          </span>
                        </div>
                        <div className="av-vehicles-card-row">
                          <span className="av-vehicles-card-label">Make/Model</span>
                          <span className="av-vehicles-card-value">{formatMakeModel(r)}</span>
                        </div>
                        <div className="av-vehicles-card-row">
                          <span className="av-vehicles-card-label">Assigned User</span>
                          <span className="av-vehicles-card-value">
                            <span className="av-vehicles-user">
                              <Avatar
                                name={assigned.name}
                                size="sm"
                                src={assigned.src}
                              />
                              <span>{assigned.name}</span>
                            </span>
                          </span>
                        </div>
                        <div className="av-vehicles-card-row">
                          <span className="av-vehicles-card-label">Location</span>
                          <span className="av-vehicles-card-value">
                            <span className="av-vehicles-location">
                              <MapPin size={14} />
                              {formatLocation(r.position)}
                            </span>
                          </span>
                        </div>
                      </div>

                      {canManageVehicles && (
                        <div
                          className="av-vehicles-card-actions"
                          onClick={stopRowAction}
                          onKeyDown={stopRowAction}
                        >
                          <button
                            type="button"
                            className="av-vehicles-action-btn av-vehicles-action-btn--edit"
                            onClick={() => setEditTarget(r)}
                          >
                            <Pencil size={14} />
                            Edit
                          </button>
                          <button
                            type="button"
                            className="av-vehicles-action-btn av-vehicles-action-btn--delete"
                            onClick={() => setDeleteTarget(r)}
                          >
                            <Trash2 size={14} />
                            Delete
                          </button>
                        </div>
                      )}
                    </article>
                  )
                })}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

export default AllVehicles
