import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Filter,
  ChevronRight,
  ChevronDown,
  Search,
} from 'lucide-react'
import api from '../../api'
import {
  FilterBar,
  StatusBadge,
  MaintenanceBadge,
  LoadingState,
} from '../../shared/components'
import { MobilePageHeading } from '../../shared/shell'
import { adminNavLabel } from '../navItems'
import {
  deriveVehicleStatus,
  matchesVehicleStatusFilter,
  tallyVehicleStatusCounts,
  VEHICLE_STATUS_FILTERS,
} from '../../user/utils/vehicleStatus'
import { usePanelScope } from '../../manager/hooks/usePanelScope'
import CreateUserModal from '../components/CreateUserModal'
import { fetchMaintenanceStatus } from '../../user/utils/maintenanceStatusCache'
import '../styles/admin-trips.css'
import '../styles/admin-maintenance.css'

const STATUS_FILTERS = VEHICLE_STATUS_FILTERS

const MAINT_FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'ok', label: 'OK' },
  { key: 'due_soon', label: 'Due Soon' },
  { key: 'overdue', label: 'Overdue' },
  { key: 'no_baseline', label: 'No Baseline' },
]

const MOBILE_CARDS_MQ = '(max-width: 768px)'

const summarizeStatus = (status) => {
  if (!status) return null
  const counts = {
    ok: 0, due_soon: 0, overdue: 0, no_baseline: 0, unknown: 0,
  }
  for (const item of status.items || []) {
    const key = Object.prototype.hasOwnProperty.call(counts, item.status)
      ? item.status
      : 'unknown'
    counts[key] += 1
  }
  if (!status.has_baseline) {
    return { overall: 'no_baseline', counts }
  }
  if (counts.overdue > 0) return { overall: 'overdue', counts }
  if (counts.due_soon > 0) return { overall: 'due_soon', counts }
  if (counts.ok > 0) return { overall: 'ok', counts }
  return { overall: 'unknown', counts }
}

const formatMakeModel = (row) => {
  const type = row.vehicle_type
    ? row.vehicle_type.charAt(0).toUpperCase() + row.vehicle_type.slice(1)
    : null
  const name = row.device?.name
  if (type && name) return `${type} · ${name}`
  return type || name || '—'
}

const nextServiceLabel = (summary) => {
  if (!summary) return '—'
  if (summary.overall === 'no_baseline') return 'Baseline not set'
  if (summary.overall === 'overdue') return 'Overdue'
  if (summary.overall === 'due_soon') return 'Imminent'
  if (summary.overall === 'ok') return 'Scheduled'
  return '—'
}

const AdminMaintenanceVehicles = () => {
  const navigate = useNavigate()
  const { basePath, apiFor, can } = usePanelScope()
  const canView = can('maintenance')
  const [live, setLive] = useState([])
  const [summaries, setSummaries] = useState({})
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(null)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [maintFilter, setMaintFilter] = useState('all')
  const [showFilters, setShowFilters] = useState(false)
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [isMobileCards, setIsMobileCards] = useState(() => (
    typeof window !== 'undefined' ? window.matchMedia(MOBILE_CARDS_MQ).matches : false
  ))
  const filtersRef = useRef(null)

  const loadLive = useCallback(async () => {
    if (!canView) {
      setLive([])
      setLoading(false)
      return
    }
    try {
      const res = await api.get(apiFor('/maintenance/vehicles', '/api/live'))
      setLive(res.data.live || [])
      setLoadError(null)
    } catch (err) {
      console.error('Failed to load vehicles:', err)
      setLive([])
      setLoadError(err.response?.data?.detail || 'Failed to load vehicles')
    } finally {
      setLoading(false)
    }
  }, [apiFor, canView])

  useEffect(() => {
    loadLive()
  }, [loadLive])

  useEffect(() => {
    const mq = window.matchMedia(MOBILE_CARDS_MQ)
    const sync = () => setIsMobileCards(mq.matches)
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

  useEffect(() => {
    if (rows.length === 0) {
      setSummaries({})
      return undefined
    }
    let cancelled = false
    const loadSummaries = async () => {
      const results = await Promise.allSettled(
        rows.map((r) => fetchMaintenanceStatus(r.db_id)),
      )
      if (cancelled) return
      const next = {}
      results.forEach((result, idx) => {
        if (result.status === 'fulfilled') {
          next[rows[idx].db_id] = summarizeStatus(result.value.data)
        }
      })
      setSummaries(next)
    }
    loadSummaries()
    return () => { cancelled = true }
  }, [rows])

  const statusCounts = useMemo(
    () => tallyVehicleStatusCounts(rows.map((r) => r.status)),
    [rows],
  )

  const maintCounts = useMemo(() => {
    const counts = { all: rows.length, ok: 0, due_soon: 0, overdue: 0, no_baseline: 0 }
    for (const r of rows) {
      const overall = summaries[r.db_id]?.overall
      if (overall && counts[overall] != null) counts[overall] += 1
    }
    return counts
  }, [rows, summaries])

  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase()
    return rows.filter((r) => {
      if (!matchesVehicleStatusFilter(r.status, statusFilter)) return false
      if (maintFilter !== 'all') {
        const overall = summaries[r.db_id]?.overall
        if (overall !== maintFilter) return false
      }
      if (!q) return true
      const name = (r.device?.name || '').toLowerCase()
      const plate = (r.plate_number || '').toLowerCase()
      const type = (r.vehicle_type || '').toLowerCase()
      const id = String(r.db_id)
      return name.includes(q) || plate.includes(q) || type.includes(q) || id.includes(q)
    })
  }, [rows, statusFilter, maintFilter, summaries, search])

  useEffect(() => {
    if (!showFilters) return undefined
    const onPointer = (event) => {
      if (filtersRef.current && !filtersRef.current.contains(event.target)) {
        setShowFilters(false)
      }
    }
    const onKey = (event) => {
      if (event.key === 'Escape') setShowFilters(false)
    }
    document.addEventListener('pointerdown', onPointer)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onPointer)
      document.removeEventListener('keydown', onKey)
    }
  }, [showFilters])

  const openVehicle = (dbId) => navigate(`${basePath}/maintenance/${dbId}`)

  const statusOptions = STATUS_FILTERS.map((f) => ({
    key: f.key,
    label: f.label,
    count: statusCounts[f.key] || 0,
  }))

  const maintOptions = MAINT_FILTERS.map((f) => ({
    key: f.key,
    label: f.label,
    count: maintCounts[f.key] || 0,
  }))

  const canAddUser = can('user_management')

  const activeFilterCount = [
    statusFilter !== 'all',
    maintFilter !== 'all',
  ].filter(Boolean).length

  const resetFilters = () => {
    setStatusFilter('all')
    setMaintFilter('all')
  }

  const stopRowAction = (event) => {
    event.stopPropagation()
  }

  const emptyMessage = !canView
    ? "You don't have permission to view this."
    : loadError
      ? String(loadError)
      : 'No vehicles match the current filters.'

  return (
    <div className="at-trips-page am-vehicles-page">
      <MobilePageHeading>{adminNavLabel('/admin/maintenance')}</MobilePageHeading>
      {showCreateModal && (
        <CreateUserModal
          onClose={() => setShowCreateModal(false)}
          onCreated={loadLive}
        />
      )}

      <div className="at-trips-panel">
        <div className="at-trips-toolbar" ref={filtersRef}>
          <div className="at-trips-search ft-search">
            <Search size={16} color="var(--ft-text-disabled)" />
            <input
              type="search"
              placeholder="Search vehicle, plate, or type..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <button
              type="button"
              className={[
                'at-trips-filters-icon-btn',
                showFilters ? 'at-trips-filters-icon-btn--open' : '',
                activeFilterCount > 0 ? 'at-trips-filters-icon-btn--active' : '',
              ].filter(Boolean).join(' ')}
              onClick={() => setShowFilters((v) => !v)}
              aria-expanded={showFilters}
              aria-haspopup="dialog"
              aria-label={`Filters${activeFilterCount > 0 ? ` (${activeFilterCount} active)` : ''}`}
            >
              <Filter size={16} />
              {activeFilterCount > 0 && (
                <span className="at-trips-filters-count">{activeFilterCount}</span>
              )}
            </button>
          </div>

          <div className="at-trips-toolbar-actions">
            <button
              type="button"
              className={[
                'at-trips-filters-btn',
                showFilters ? 'at-trips-filters-btn--open' : '',
                activeFilterCount > 0 ? 'at-trips-filters-btn--active' : '',
              ].filter(Boolean).join(' ')}
              onClick={() => setShowFilters((v) => !v)}
              aria-expanded={showFilters}
              aria-haspopup="dialog"
            >
              <Filter size={15} />
              Filters
              {activeFilterCount > 0 && (
                <span className="at-trips-filters-count">{activeFilterCount}</span>
              )}
              <ChevronDown size={14} className="at-trips-filters-chevron" />
            </button>

            {canAddUser && (
              <button
                type="button"
                className="am-add-btn"
                onClick={() => setShowCreateModal(true)}
              >
                Add user
              </button>
            )}
          </div>

          {showFilters && (
            <div className="at-trips-filters-dropdown" role="dialog" aria-label="Maintenance filters">
              <div className="at-trips-filters-head">
                <p className="at-trips-filters-heading">Filters</p>
                <button
                  type="button"
                  className="at-trips-filters-reset"
                  onClick={resetFilters}
                  disabled={activeFilterCount === 0}
                >
                  Reset
                </button>
              </div>

              <div className="at-trips-filter-group">
                <span className="at-trips-filter-label">Fleet status</span>
                <FilterBar
                  options={statusOptions}
                  value={statusFilter}
                  onChange={setStatusFilter}
                />
              </div>

              <div className="at-trips-filter-group">
                <span className="at-trips-filter-label">Maintenance status</span>
                <FilterBar
                  options={maintOptions}
                  value={maintFilter}
                  onChange={setMaintFilter}
                />
              </div>
            </div>
          )}
        </div>

        {loading && rows.length === 0 ? (
          <LoadingState label="Loading vehicles…" />
        ) : !canView || loadError || filteredRows.length === 0 ? (
          <div className="at-trips-empty">{emptyMessage}</div>
        ) : (
          <div className="at-trips-table-section">
            {!isMobileCards && (
              <div className="at-trips-table-wrap">
                <table className="at-trips-table">
                  <thead>
                    <tr>
                      <th>Vehicle ID</th>
                      <th>Make / Model</th>
                      <th>Next Service Date</th>
                      <th>Maintenance Status</th>
                      <th>Fleet Status</th>
                      <th className="at-trips-th-actions">Details</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredRows.map((r) => {
                      const summary = summaries[r.db_id]
                      return (
                        <tr
                          key={r.db_id}
                          className="at-trips-row at-trips-row--clickable"
                          onClick={() => openVehicle(r.db_id)}
                          tabIndex={0}
                          role="button"
                          onKeyDown={(event) => {
                            if (event.key === 'Enter' || event.key === ' ') {
                              event.preventDefault()
                              openVehicle(r.db_id)
                            }
                          }}
                        >
                          <td className="at-trips-cell-vehicle">{r.db_id}</td>
                          <td>{formatMakeModel(r)}</td>
                          <td className="at-trips-cell-muted">{nextServiceLabel(summary)}</td>
                          <td>
                            {summary ? <MaintenanceBadge status={summary.overall} /> : '—'}
                          </td>
                          <td><StatusBadge status={r.status} connection /></td>
                          <td className="at-trips-actions-cell" onClick={stopRowAction} onKeyDown={stopRowAction}>
                            <button
                              type="button"
                              className="at-trips-details-btn"
                              onClick={() => openVehicle(r.db_id)}
                            >
                              Details
                              <ChevronRight size={14} />
                            </button>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {isMobileCards && (
              <div className="at-trips-cards" aria-label="Maintenance vehicles">
                {filteredRows.map((r) => {
                  const summary = summaries[r.db_id]
                  return (
                    <article
                      key={r.db_id}
                      className="at-trips-card"
                      role="button"
                      tabIndex={0}
                      onClick={() => openVehicle(r.db_id)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault()
                          openVehicle(r.db_id)
                        }
                      }}
                    >
                      <div className="at-trips-card-header">
                        <div className="at-trips-card-identity">
                          <span className="at-trips-card-num">#{r.db_id}</span>
                          <span className="at-trips-card-vehicle">{formatMakeModel(r)}</span>
                        </div>
                        {summary ? <MaintenanceBadge status={summary.overall} /> : null}
                      </div>
                      <div className="at-trips-card-body">
                        <div className="at-trips-card-group at-trips-card-group--2">
                          <div className="at-trips-card-row">
                            <span className="at-trips-card-label">Next service</span>
                            <span className="at-trips-card-value at-trips-cell-muted">
                              {nextServiceLabel(summary)}
                            </span>
                          </div>
                          <div className="at-trips-card-row">
                            <span className="at-trips-card-label">Fleet status</span>
                            <span className="at-trips-card-value">
                              <StatusBadge status={r.status} connection />
                            </span>
                          </div>
                        </div>
                      </div>
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

export default AdminMaintenanceVehicles
