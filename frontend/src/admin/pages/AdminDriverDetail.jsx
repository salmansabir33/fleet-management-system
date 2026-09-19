import { useCallback, useEffect, useMemo, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  ArrowLeft,
  MoreHorizontal,
  Pencil,
  Truck,
  UserX,
  Trash2,
  ChevronUp,
  ChevronDown,
  ChevronsUpDown,
} from 'lucide-react'
import api, { API_BASE_URL } from '../../api'
import {
  LoadingState,
  EmptyState,
  Avatar,
  ConfirmDialog,
  Dropdown,
  DropdownItem,
  tripTotalCostPkr,
} from '../../shared/components'
import EditDriverModal from '../components/EditDriverModal'
import AssignVehicleModal from '../components/AssignVehicleModal'
import { usePanelScope } from '../../manager/hooks/usePanelScope'
import { userPicSrc } from '../utils/userPic'
import { getPresetRange } from '../../user/utils/playbackPeriod'
import {
  formatDateTimeCompact,
  formatDateTimeFull,
  formatDistanceCompact,
  formatDistanceFull,
  formatDurationCompact,
  formatAvgSpeedCompact,
  formatMaxSpeedCompact,
  formatLitersCompact,
  formatLitersFull,
  formatFuelPriceCompact,
  formatFuelPriceFull,
  formatPkrCompact,
  formatPkrFull,
  tripStatusMeta,
} from '../utils/tripTableDisplay'
import '../styles/admin-drivers.css'
import '../styles/admin-trips.css'
import '../styles/admin-driver-detail.css'

const RANGE_PRESETS = [
  { key: 'today', label: 'Today' },
  { key: 'this_week', label: 'This week' },
  { key: 'this_month', label: 'This month' },
  { key: 'previous_month', label: 'Previous month' },
]

const MOBILE_MQ = '(max-width: 820px)'

const HISTORY_COLUMNS = [
  { key: 'num', label: '#', sticky: 'at-trips-sticky-num' },
  { key: 'vehicle', label: 'Vehicle', sticky: 'at-trips-sticky-vehicle' },
  { key: 'status', label: 'Status' },
  { key: 'start_time', label: 'Start' },
  { key: 'end_time', label: 'End' },
  { key: 'distance_km', label: 'Distance' },
  { key: 'duration_min', label: 'Duration' },
  { key: 'avg_speed', label: 'Average' },
  { key: 'max_speed_kmh', label: 'Max speed' },
  { key: 'total_fuel_liters', label: 'Fuel used' },
  { key: 'price_per_liter_used', label: 'Price Rs/L' },
  { key: 'assigned', label: 'Assignment Date' },
  { key: 'released', label: 'Release Date' },
  { key: 'fuel_cost_pkr', label: 'Fuel cost' },
  { key: 'toll_tax_pkr', label: 'Toll tax' },
  { key: 'challan_pkr', label: 'Challan' },
  { key: 'harsh_brake_count', label: 'Harsh brakes' },
  { key: 'harsh_accel_count', label: 'Harsh acceleration' },
  { key: 'overspeed_count', label: 'Overspeed' },
  { key: 'idle_count', label: 'Idle' },
  { key: 'total_cost', label: 'Total cost', sticky: 'at-trips-sticky-cost' },
]

const STATUS_LABEL = {
  active: 'Active',
  on_leave: 'On Leave',
  inactive: 'Inactive',
}

function statusLabel(status) {
  return STATUS_LABEL[status] || (status || 'Unknown').replace('_', ' ')
}

function formatDate(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function formatJoined(value) {
  if (!value) return '—'
  if (/^\d{4}-\d{2}-\d{2}/.test(value)) {
    const d = new Date(`${value.slice(0, 10)}T00:00:00`)
    if (!Number.isNaN(d.getTime())) {
      return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    }
  }
  return formatDate(value)
}

function fmtCount(v) {
  return v === null || v === undefined ? '—' : String(v)
}

function avgSpeedKmh(trip) {
  if (trip?.distance_km == null || trip?.duration_min == null || Number(trip.duration_min) <= 0) {
    return null
  }
  return Number(trip.distance_km) / (Number(trip.duration_min) / 60)
}

function formatFuelAvg(kmPerL) {
  if (kmPerL == null || kmPerL === '') return '—'
  const n = Number(kmPerL)
  if (!Number.isFinite(n)) return '—'
  return `${n.toLocaleString('en-US', { maximumFractionDigits: 2 })} km/L`
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

function TripStatusPill({ status }) {
  const meta = tripStatusMeta(status)
  return (
    <span className={`at-trips-status at-trips-status--${meta.tone}`}>
      {meta.label}
    </span>
  )
}

function metricIsZero(value) {
  if (value == null || value === '—') return true
  if (typeof value === 'number') return value === 0
  const n = Number(String(value).replace(/[^\d.-]/g, ''))
  return Number.isFinite(n) && n === 0
}

function Metric({ label, value, hint, tone = 'neutral' }) {
  const quiet = metricIsZero(value)
  return (
    <div className={`dd-metric dd-metric--${tone}${quiet ? ' dd-metric--quiet' : ''}`}>
      <span className="dd-metric-label">{label}</span>
      <span className="dd-metric-value">{value}</span>
      {hint ? <span className="dd-metric-hint">{hint}</span> : null}
    </div>
  )
}

function HistoryCardField({ label, value, muted }) {
  const text = value == null ? '—' : String(value)
  return (
    <div className="dd-history-card-row">
      <span className="dd-history-card-label" title={label}>{label}</span>
      <span
        className={`dd-history-card-value${muted ? ' ad-cell-muted' : ''}`}
        title={text}
      >
        {text}
      </span>
    </div>
  )
}

function HistoryVehicleButton({ assignment, onOpen }) {
  return (
    <button
      type="button"
      className="dd-vehicle-link dd-history-card-vehicle"
      onClick={() => onOpen(assignment.device_id)}
    >
      <span className="ad-stack">
        <span className="ad-stack-primary">{assignment.device_name || '—'}</span>
        {assignment.device_plate && (
          <span className="ad-stack-sub">{assignment.device_plate}</span>
        )}
      </span>
    </button>
  )
}

const AdminDriverDetail = () => {
  const { driverId } = useParams()
  const navigate = useNavigate()
  const { basePath, apiFor, can, isManager } = usePanelScope()
  const canManage = can('driver_management')

  const [driver, setDriver] = useState(null)
  const [assignments, setAssignments] = useState([])
  const [trips, setTrips] = useState([])
  const [totals, setTotals] = useState(null)
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [rangeKey, setRangeKey] = useState('today')

  const [showEditModal, setShowEditModal] = useState(false)
  const [showAssignModal, setShowAssignModal] = useState(false)
  const [confirmUnassign, setConfirmUnassign] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [actionLoading, setActionLoading] = useState(false)
  const [actionError, setActionError] = useState(null)
  const [isMobile, setIsMobile] = useState(() => (
    typeof window !== 'undefined' ? window.matchMedia(MOBILE_MQ).matches : false
  ))

  const [sortDir, setSortDir] = useState('desc')
  const [expandedCardIds, setExpandedCardIds] = useState(() => new Set())

  useEffect(() => {
    const mq = window.matchMedia(MOBILE_MQ)
    const sync = () => setIsMobile(mq.matches)
    sync()
    mq.addEventListener('change', sync)
    return () => mq.removeEventListener('change', sync)
  }, [])

  const toggleCardExpanded = (cardKey) => {
    setExpandedCardIds((prev) => {
      const next = new Set(prev)
      if (next.has(cardKey)) next.delete(cardKey)
      else next.add(cardKey)
      return next
    })
  }

  useEffect(() => {
    setExpandedCardIds(new Set())
  }, [driverId, rangeKey])

  const rangeLabel = RANGE_PRESETS.find((p) => p.key === rangeKey)?.label || 'Today'

  const load = useCallback(async () => {
    const { fromIso, toIso } = getPresetRange(rangeKey)
    const res = await api.get(
      apiFor(`/drivers/${driverId}/detail`, `/api/drivers/${driverId}/detail`),
      { params: { start: fromIso, end: toIso } },
    )
    setDriver(res.data.driver)
    setAssignments(res.data.assignments || [])
    setTrips(res.data.trips || [])
    setTotals(res.data.totals || null)
  }, [apiFor, driverId, rangeKey])

  useEffect(() => {
    if (!driverId) return undefined
    let cancelled = false
    setLoading(true)
    setNotFound(false)

    const run = async () => {
      try {
        await load()
      } catch (err) {
        console.error('Failed to load driver:', err)
        if (err.response?.status === 404) setNotFound(true)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    run()
    return () => { cancelled = true }
  }, [driverId, load])

  const tripsByAssignment = useMemo(() => {
    const map = new Map()
    trips.forEach((trip) => {
      const key = trip.assignment_id
      if (!map.has(key)) map.set(key, [])
      map.get(key).push(trip)
    })
    map.forEach((list) => {
      list.sort((a, b) => new Date(a.start_time || 0) - new Date(b.start_time || 0))
    })
    return map
  }, [trips])

  const historyRows = useMemo(() => {
    const rows = []
    assignments.forEach((assignment) => {
      const groupTrips = tripsByAssignment.get(assignment.id) || []
      if (groupTrips.length === 0) {
        rows.push({
          key: `a-${assignment.id}`,
          assignment,
          trip: null,
          sortTime: new Date(assignment.start_time || 0).getTime(),
        })
        return
      }
      groupTrips.forEach((trip) => {
        rows.push({
          key: `t-${trip.id}`,
          assignment,
          trip,
          sortTime: new Date(trip.end_time || trip.start_time || assignment.start_time || 0).getTime(),
        })
      })
    })
    rows.sort((a, b) => (sortDir === 'asc' ? a.sortTime - b.sortTime : b.sortTime - a.sortTime))
    return rows
  }, [assignments, tripsByAssignment, sortDir])

  const handleUnassign = async () => {
    if (!driver) return
    setActionLoading(true)
    setActionError(null)
    try {
      await api.post(apiFor(`/drivers/${driver.id}/unassign`, `/api/drivers/${driver.id}/unassign`))
      setConfirmUnassign(false)
      await load()
    } catch (err) {
      setActionError(err.response?.data?.detail || 'Failed to unassign vehicle')
    } finally {
      setActionLoading(false)
    }
  }

  const handleDelete = async () => {
    if (!driver) return
    setActionLoading(true)
    setActionError(null)
    try {
      await api.delete(`/api/drivers/${driver.id}`)
      navigate(`${basePath}/drivers`)
    } catch (err) {
      setActionError(err.response?.data?.detail || 'Failed to delete driver')
    } finally {
      setActionLoading(false)
    }
  }

  const openVehicle = (deviceId) => {
    if (deviceId == null) return
    navigate(`${basePath}/vehicles/${deviceId}`)
  }

  if (notFound) {
    return (
      <div className="dd-page">
        <button
          type="button"
          className="dd-back"
          aria-label="Back to Drivers"
          onClick={() => navigate(`${basePath}/drivers`)}
        >
          <ArrowLeft size={15} />
          {!isMobile && 'Back to Drivers'}
        </button>
        <EmptyState title="Driver not found" />
      </div>
    )
  }
  if (loading && !driver) return <LoadingState label="Loading driver…" />
  if (!driver) return <EmptyState title="No data for this driver." />

  const avatarSrc = userPicSrc(driver.driver_pic_path)
  const licensePicSrc = driver.license_pic_path
    ? (driver.license_pic_path.startsWith('http') ? driver.license_pic_path : `${API_BASE_URL}${driver.license_pic_path}`)
    : null

  const t = totals || {}
  const challanHint = t.challan_count != null
    ? `${t.challan_count} trip${t.challan_count === 1 ? '' : 's'} with challan`
    : null

  return (
    <div className="dd-page">
      <ConfirmDialog
        open={confirmUnassign}
        title="Unassign vehicle?"
        message={[
          `Unassign ${driver.name} from ${driver.current_device_name || 'their current vehicle'}?`,
          actionError,
        ].filter(Boolean).join('\n\n')}
        confirmLabel="Unassign"
        cancelLabel="Cancel"
        variant="danger"
        loading={actionLoading}
        onConfirm={handleUnassign}
        onCancel={() => {
          if (actionLoading) return
          setConfirmUnassign(false)
          setActionError(null)
        }}
      />

      <ConfirmDialog
        open={confirmDelete}
        title="Delete driver?"
        message={[
          `Delete ${driver.name}? This cannot be undone.`,
          actionError,
        ].filter(Boolean).join('\n\n')}
        confirmLabel="Delete driver"
        cancelLabel="Cancel"
        variant="danger"
        loading={actionLoading}
        onConfirm={handleDelete}
        onCancel={() => {
          if (actionLoading) return
          setConfirmDelete(false)
          setActionError(null)
        }}
      />

      {showEditModal && (
        <EditDriverModal
          driver={driver}
          onClose={() => setShowEditModal(false)}
          onSaved={load}
        />
      )}
      {showAssignModal && (
        <AssignVehicleModal
          driverId={driver.id}
          currentDeviceId={driver.current_device_id ?? null}
          onClose={() => setShowAssignModal(false)}
          onAssigned={load}
        />
      )}

      <div className="dd-header">
        <h1 className="dd-title">Driver detail</h1>
        <button
          type="button"
          className="dd-back-btn"
          aria-label="Back to Drivers"
          onClick={() => navigate(`${basePath}/drivers`)}
        >
          <ArrowLeft size={15} />
          {!isMobile && 'Back'}
        </button>
      </div>

      <div className="dd-range-bar" role="group" aria-label="Performance range">
        <div className="dd-range">
          {RANGE_PRESETS.map((preset) => (
            <button
              key={preset.key}
              type="button"
              className={`dd-range-btn${rangeKey === preset.key ? ' dd-range-btn--active' : ''}`}
              aria-pressed={rangeKey === preset.key}
              onClick={() => setRangeKey(preset.key)}
            >
              {preset.label}
            </button>
          ))}
        </div>
      </div>

      <div className="dd-layout">
        <div className="dd-card">
          <div className="dd-profile-head">
            <Avatar name={driver.name} size="2xl" src={avatarSrc} />
            <div className="dd-profile-meta">
              <h2 className="dd-profile-name">{driver.name}</h2>
              <p className="dd-profile-sub">{driver.id_card_number || 'Driver'}</p>
            </div>
            <div className="dd-current-assignment">
              <span className="dd-current-label">Current Assignment</span>
              {driver.current_device_name ? (
                <>
                  <span className="dd-current-name">{driver.current_device_name}</span>
                  <span className="dd-current-meta">
                    {driver.current_device_plate || 'No plate'}
                    {driver.assigned_since ? ` · since ${formatDate(driver.assigned_since)}` : ''}
                  </span>
                </>
              ) : (
                <span className="dd-current-meta">Unassigned</span>
              )}
            </div>
            {canManage && (
              <div className="dd-profile-menu">
                <Dropdown
                  align="right"
                  trigger={(
                    <button type="button" className="dd-actions-btn" aria-label="Driver actions">
                      <MoreHorizontal size={16} />
                    </button>
                  )}
                >
                  <DropdownItem onClick={() => setShowEditModal(true)}>
                    <Pencil size={14} />
                    Edit
                  </DropdownItem>
                  <DropdownItem onClick={() => setShowAssignModal(true)}>
                    <Truck size={14} />
                    Assign vehicle
                  </DropdownItem>
                  {driver.current_device_name && (
                    <DropdownItem onClick={() => {
                      setActionError(null)
                      setConfirmUnassign(true)
                    }}
                    >
                      <UserX size={14} />
                      Unassign
                    </DropdownItem>
                  )}
                  {!isManager && (
                    <DropdownItem
                      danger
                      onClick={() => {
                        setActionError(null)
                        setConfirmDelete(true)
                      }}
                    >
                      <Trash2 size={14} />
                      Delete
                    </DropdownItem>
                  )}
                </Dropdown>
              </div>
            )}
          </div>

          <div className="dd-section">
            <h3 className="dd-section-label">Driver info</h3>
            <div className="dd-row">
              <span className="dd-row-label">Phone</span>
              <span className="dd-row-value">{driver.phone_number || '—'}</span>
            </div>
            <div className="dd-row">
              <span className="dd-row-label">CNIC</span>
              <span className="dd-row-value">{driver.id_card_number || '—'}</span>
            </div>
            <div className="dd-row">
              <span className="dd-row-label">Status</span>
              <DriverStatus status={driver.status} />
            </div>
            <div className="dd-row">
              <span className="dd-row-label">Date joined</span>
              <span className="dd-row-value">{formatJoined(driver.date_joined)}</span>
            </div>
          </div>

          <div className="dd-section">
            <h3 className="dd-section-label">License info</h3>
            <div className="dd-row">
              <span className="dd-row-label">License number</span>
              <span className="dd-row-value">{driver.license_number || '—'}</span>
            </div>
            <div className="dd-row">
              <span className="dd-row-label">License expiry</span>
              <span className="dd-row-value">{formatJoined(driver.license_expiry)}</span>
            </div>
            {licensePicSrc && (
              <div className="dd-row">
                <span className="dd-row-label">License photo</span>
                <img className="dd-license-pic" src={licensePicSrc} alt="Driver license" />
              </div>
            )}
          </div>
        </div>

        <div className={`dd-card dd-card--overview${loading ? ' dd-card--loading' : ''}`}>
          <div className="dd-overview-head">
            <h3 className="dd-card-title">Performance Overview</h3>
            <span className="dd-overview-range">{rangeLabel}</span>
          </div>

          <div className="dd-metrics-section">
            <h4 className="dd-metrics-heading">Work</h4>
            <div className="dd-metrics">
              <Metric label="Trips" value={fmtCount(t.trip_count ?? 0)} tone="trips" />
              <Metric label="Distance" value={formatDistanceCompact(t.distance_km)} tone="distance" />
              <Metric label="Time on trip" value={formatDurationCompact(t.duration_min)} tone="duration" />
            </div>
          </div>

          <div className="dd-metrics-section">
            <h4 className="dd-metrics-heading">Fuel</h4>
            <div className="dd-metrics">
              <Metric label="Fuel used" value={formatLitersCompact(t.total_fuel_liters)} tone="fuel" />
              <Metric label="Fuel average" value={formatFuelAvg(t.fuel_avg_km_l)} tone="fuel-avg" />
              <Metric label="Fuel cost" value={formatPkrCompact(t.fuel_cost_pkr)} tone="fuel-cost" />
            </div>
          </div>

          <div className="dd-metrics-section">
            <h4 className="dd-metrics-heading">Costs</h4>
            <div className="dd-metrics">
              <Metric label="Toll tax" value={formatPkrCompact(t.toll_tax_pkr)} tone="toll" />
              <Metric
                label="Challans"
                value={formatPkrCompact(t.challan_pkr)}
                hint={challanHint}
                tone="challan"
              />
              <Metric label="Total cost" value={formatPkrCompact(t.total_cost_pkr)} tone="total" />
            </div>
          </div>

          <div className="dd-metrics-section">
            <h4 className="dd-metrics-heading">Driving</h4>
            <div className="dd-metrics dd-metrics--four">
              <Metric label="Harsh brakes" value={fmtCount(t.harsh_brake_count ?? 0)} tone="harsh-brake" />
              <Metric label="Harsh accel" value={fmtCount(t.harsh_accel_count ?? 0)} tone="harsh-accel" />
              <Metric label="Overspeed" value={fmtCount(t.overspeed_count ?? 0)} tone="overspeed" />
              <Metric label="Idle events" value={fmtCount(t.idle_count ?? 0)} tone="idle" />
            </div>
          </div>
        </div>
      </div>

      <section className="dd-history">
        <div className="dd-history-heading">
          <h3 className="dd-history-title">Assignment & trip history</h3>
          <span className="dd-history-meta">
            {assignments.length} assignment{assignments.length !== 1 ? 's' : ''}
            {' · '}
            {trips.length} trip{trips.length !== 1 ? 's' : ''} in {rangeLabel.toLowerCase()}
          </span>
        </div>

        {assignments.length === 0 ? (
          <div className="dd-card dd-card--history">
            <p className="dd-empty">No assignments in this period.</p>
          </div>
        ) : (
          <div className="dd-card dd-card--history">
            <div className="dd-history-table-wrap">
              <table className="ad-table at-trips-table at-trips-table--admin dd-history-table">
                <thead>
                  <tr>
                    {HISTORY_COLUMNS.map((col) => {
                      const stickyClass = col.sticky || ''
                      if (col.key === 'end_time') {
                        return (
                          <th
                            key={col.key}
                            className={`ad-th--sortable ${stickyClass}`.trim()}
                            onClick={() => setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))}
                            aria-sort={sortDir === 'asc' ? 'ascending' : 'descending'}
                          >
                            <span className="ad-th-label">
                              {col.label}
                              <SortIcon active dir={sortDir} />
                            </span>
                          </th>
                        )
                      }
                      return (
                        <th key={col.key} className={stickyClass || undefined}>
                          {col.label}
                        </th>
                      )
                    })}
                  </tr>
                </thead>
                <tbody>
                  {historyRows.map(({ key, assignment: a, trip }) => {
                    if (!trip) {
                      return (
                        <tr key={key} className="dd-history-row at-trips-row">
                          <td className="at-trips-cell-num at-trips-sticky-num">—</td>
                          <td className="at-trips-sticky-vehicle at-trips-col-vehicle">
                            <button
                              type="button"
                              className="dd-vehicle-link"
                              onClick={() => openVehicle(a.device_id)}
                            >
                              <span className="ad-stack">
                                <span className="ad-stack-primary">{a.device_name || '—'}</span>
                                {a.device_plate && (
                                  <span className="ad-stack-sub">{a.device_plate}</span>
                                )}
                              </span>
                            </button>
                          </td>
                          <td colSpan={9} className="dd-empty-trips">No trips in this period</td>
                          <td>{formatDate(a.start_time)}</td>
                          <td className={a.end_time ? undefined : 'ad-cell-muted'}>
                            {a.end_time ? formatDate(a.end_time) : 'Ongoing'}
                          </td>
                          <td colSpan={7} />
                          <td className="at-trips-cell-cost at-trips-sticky-cost">—</td>
                        </tr>
                      )
                    }

                    const avg = avgSpeedKmh(trip)
                    const totalCost = tripTotalCostPkr(trip)
                    return (
                      <tr key={key} className="dd-history-row at-trips-row">
                        <td className="at-trips-cell-num at-trips-sticky-num">{trip.trip_number ?? '—'}</td>
                        <td className="at-trips-sticky-vehicle at-trips-col-vehicle">
                          <button
                            type="button"
                            className="dd-vehicle-link"
                            onClick={() => openVehicle(a.device_id)}
                          >
                            <span className="ad-stack">
                              <span className="ad-stack-primary">{a.device_name || '—'}</span>
                              {a.device_plate && (
                                <span className="ad-stack-sub">{a.device_plate}</span>
                              )}
                            </span>
                          </button>
                        </td>
                        <td className="at-trips-col-status">
                          <TripStatusPill status={trip.status} />
                        </td>
                        <td
                          className="at-trips-cell-muted at-trips-col-datetime"
                          title={formatDateTimeFull(trip.start_time)}
                        >
                          {formatDateTimeCompact(trip.start_time)}
                        </td>
                        <td
                          className="at-trips-cell-muted at-trips-col-datetime"
                          title={trip.end_time ? formatDateTimeFull(trip.end_time) : 'Ongoing'}
                        >
                          {trip.end_time ? formatDateTimeCompact(trip.end_time) : 'Ongoing'}
                        </td>
                        <td
                          className="at-trips-col-num"
                          title={formatDistanceFull(trip.distance_km)}
                        >
                          {formatDistanceCompact(trip.distance_km)}
                        </td>
                        <td className="at-trips-col-num">
                          {formatDurationCompact(trip.duration_min)}
                        </td>
                        <td
                          className="at-trips-col-num"
                          title={avg != null ? `${Number(avg).toFixed(1)} km/h` : undefined}
                        >
                          {formatAvgSpeedCompact(avg)}
                        </td>
                        <td
                          className="at-trips-col-num"
                          title={trip.max_speed_kmh != null ? `${trip.max_speed_kmh} km/h` : undefined}
                        >
                          {formatMaxSpeedCompact(trip.max_speed_kmh)}
                        </td>
                        <td
                          className="at-trips-col-num"
                          title={formatLitersFull(trip.total_fuel_liters)}
                        >
                          {formatLitersCompact(trip.total_fuel_liters)}
                        </td>
                        <td
                          className="at-trips-col-num"
                          title={formatFuelPriceFull(trip.price_per_liter_used)}
                        >
                          {formatFuelPriceCompact(trip.price_per_liter_used)}
                        </td>
                        <td>{formatDate(a.start_time)}</td>
                        <td className={a.end_time ? undefined : 'ad-cell-muted'}>
                          {a.end_time ? formatDate(a.end_time) : 'Ongoing'}
                        </td>
                        <td
                          className="at-trips-cell-cost at-trips-col-cost"
                          title={formatPkrFull(trip.fuel_cost_pkr)}
                        >
                          {formatPkrCompact(trip.fuel_cost_pkr)}
                        </td>
                        <td
                          className="at-trips-cell-cost at-trips-col-cost"
                          title={formatPkrFull(trip.toll_tax_pkr)}
                        >
                          {formatPkrCompact(trip.toll_tax_pkr)}
                        </td>
                        <td
                          className="at-trips-cell-cost at-trips-col-cost"
                          title={formatPkrFull(trip.challan_pkr)}
                        >
                          {formatPkrCompact(trip.challan_pkr)}
                        </td>
                        <td className="at-trips-col-count">{fmtCount(trip.harsh_brake_count)}</td>
                        <td className="at-trips-col-count">{fmtCount(trip.harsh_accel_count)}</td>
                        <td className="at-trips-col-count">{fmtCount(trip.overspeed_count)}</td>
                        <td className="at-trips-col-count">{fmtCount(trip.idle_count)}</td>
                        <td
                          className="at-trips-cell-cost at-trips-sticky-cost"
                          title={formatPkrFull(totalCost)}
                        >
                          {formatPkrCompact(totalCost)}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            <div className="dd-history-cards" aria-label="Assignment and trip history">
              {historyRows.map(({ key, assignment: a, trip }) => {
                if (!trip) {
                  return (
                    <article key={key} className="dd-history-card">
                      <div className="dd-history-card-header">
                        <div className="dd-history-card-identity">
                          <span className="dd-history-card-num">—</span>
                          <HistoryVehicleButton assignment={a} onOpen={openVehicle} />
                        </div>
                        <span className="dd-history-card-empty-badge">No trips</span>
                      </div>
                      <div className="dd-history-card-body">
                        <div className="dd-history-card-group dd-history-card-group--2">
                          <HistoryCardField label="Assignment Date" value={formatDate(a.start_time)} />
                          <HistoryCardField
                            label="Release Date"
                            value={a.end_time ? formatDate(a.end_time) : 'Ongoing'}
                            muted={!a.end_time}
                          />
                        </div>
                      </div>
                    </article>
                  )
                }

                const avg = avgSpeedKmh(trip)
                const totalCost = tripTotalCostPkr(trip)
                const isExpanded = expandedCardIds.has(key)
                const extraId = `dd-history-card-extra-${key}`
                return (
                  <article
                    key={key}
                    className={`dd-history-card${isExpanded ? ' dd-history-card--expanded' : ''}`}
                  >
                    <div className="dd-history-card-header">
                      <div className="dd-history-card-identity">
                        <span className="dd-history-card-num">#{trip.trip_number ?? '—'}</span>
                        <HistoryVehicleButton assignment={a} onOpen={openVehicle} />
                      </div>
                      <TripStatusPill status={trip.status} />
                    </div>

                    <div className="dd-history-card-body">
                      <div className="dd-history-card-group dd-history-card-group--2">
                        <HistoryCardField
                          label="Start"
                          value={formatDateTimeCompact(trip.start_time)}
                          muted
                        />
                        <HistoryCardField
                          label="End"
                          value={trip.end_time ? formatDateTimeCompact(trip.end_time) : 'Ongoing'}
                          muted
                        />
                      </div>

                      <div className="dd-history-card-group dd-history-card-group--2">
                        <HistoryCardField label="Distance" value={formatDistanceCompact(trip.distance_km)} />
                        <HistoryCardField label="Duration" value={formatDurationCompact(trip.duration_min)} />
                      </div>

                      <div className="dd-history-card-group dd-history-card-group--2">
                        <HistoryCardField label="Assignment Date" value={formatDate(a.start_time)} />
                        <HistoryCardField
                          label="Release Date"
                          value={a.end_time ? formatDate(a.end_time) : 'Ongoing'}
                          muted={!a.end_time}
                        />
                      </div>

                      {isExpanded && (
                        <div className="dd-history-card-extra" id={extraId}>
                          <div className="dd-history-card-group">
                            <HistoryCardField label="Average" value={formatAvgSpeedCompact(avg)} />
                            <HistoryCardField label="Max speed" value={formatMaxSpeedCompact(trip.max_speed_kmh)} />
                            <HistoryCardField label="Fuel used" value={formatLitersCompact(trip.total_fuel_liters)} />
                          </div>

                          <div className="dd-history-card-group">
                            <HistoryCardField label="Price Rs/L" value={formatFuelPriceCompact(trip.price_per_liter_used)} />
                            <HistoryCardField label="Fuel cost" value={formatPkrCompact(trip.fuel_cost_pkr)} />
                            <HistoryCardField label="Toll tax" value={formatPkrCompact(trip.toll_tax_pkr)} />
                            <HistoryCardField label="Challan" value={formatPkrCompact(trip.challan_pkr)} />
                            <HistoryCardField label="Total cost" value={formatPkrCompact(totalCost)} />
                            <HistoryCardField label="Idle" value={fmtCount(trip.idle_count)} />
                          </div>

                          <div className="dd-history-card-group">
                            <HistoryCardField label="Harsh brakes" value={fmtCount(trip.harsh_brake_count)} />
                            <HistoryCardField label="Harsh accel" value={fmtCount(trip.harsh_accel_count)} />
                            <HistoryCardField label="Overspeed" value={fmtCount(trip.overspeed_count)} />
                          </div>
                        </div>
                      )}
                    </div>

                    <button
                      type="button"
                      className={`dd-history-card-expand${isExpanded ? ' is-open' : ''}`}
                      aria-expanded={isExpanded}
                      aria-controls={isExpanded ? extraId : undefined}
                      aria-label={isExpanded ? 'Hide trip details' : 'Show more trip details'}
                      onClick={(event) => {
                        event.stopPropagation()
                        event.preventDefault()
                        toggleCardExpanded(key)
                      }}
                    >
                      <ChevronDown size={18} aria-hidden />
                    </button>
                  </article>
                )
              })}
            </div>
          </div>
        )}
      </section>
    </div>
  )
}

export default AdminDriverDetail
