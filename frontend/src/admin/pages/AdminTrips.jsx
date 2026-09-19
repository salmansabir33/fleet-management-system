import { Fragment, memo, startTransition, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import {
  Filter,
  ChevronDown,
  ChevronUp,
  ChevronsUpDown,
  Search,
} from 'lucide-react'
import api from '../../api'
import {
  FilterBar,
  LoadingState,
  Modal,
  TripCostsBox,
  tripTotalCostPkr,
} from '../../shared/components'
import { MobilePageHeading } from '../../shared/shell'
import { adminNavLabel } from '../navItems'
import { usePanelScope } from '../../manager/hooks/usePanelScope'
import { TRIP_PERIODS, tripPeriodToParams } from '../utils/tripPeriod'
import TripDriverConfirmCell, {
  tripDisplayDriverName,
} from '../components/TripDriverConfirmCell'
import TripRouteConfirmCell, {
  tripDisplayRouteName,
} from '../components/TripRouteConfirmCell'
import {
  ADMIN_COLUMNS,
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
import '../styles/admin-trips.css'

const MOBILE_CARDS_MQ = '(max-width: 768px)'

const GROUP_OPTIONS = [
  { key: 'none', label: 'Ungrouped' },
  { key: 'driver', label: 'Driver-wise' },
  { key: 'date', label: 'Date-wise' },
  { key: 'manager', label: 'Manager-wise' },
  { key: 'vehicle', label: 'Vehicle-wise' },
]

const fmt = (v) => (v === null || v === undefined ? '—' : String(v))
const dateOf = (iso) => (
  iso
    ? new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    : '—'
)
const TripStatusPill = memo(({ status }) => {
  const meta = tripStatusMeta(status)
  return (
    <span className={`at-trips-status at-trips-status--${meta.tone}`}>
      {meta.label}
    </span>
  )
})

function SortIcon({ active, dir }) {
  if (!active) return <ChevronsUpDown size={14} className="at-trips-sort-icon" />
  if (dir === 'asc') return <ChevronUp size={14} className="at-trips-sort-icon" />
  return <ChevronDown size={14} className="at-trips-sort-icon" />
}

const TripCardField = memo(function TripCardField({ label, value, muted, expanded, onToggle }) {
  const valueRef = useRef(null)
  const [truncatable, setTruncatable] = useState(false)
  const text = value == null ? '—' : String(value)

  useEffect(() => {
    const el = valueRef.current
    if (!el) return undefined

    const check = () => {
      if (expanded) return
      setTruncatable(el.scrollWidth > el.clientWidth + 1)
    }

    check()
    const observer = new ResizeObserver(check)
    observer.observe(el)
    return () => observer.disconnect()
  }, [text, expanded])

  const canExpand = truncatable || expanded

  const handleClick = (event) => {
    if (!canExpand) return
    event.stopPropagation()
    onToggle?.()
  }

  const handleKeyDown = (event) => {
    if (!canExpand) return
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      event.stopPropagation()
      onToggle?.()
    }
  }

  return (
    <div className={`at-trips-card-row${expanded ? ' at-trips-card-row--expanded' : ''}`}>
      <span className="at-trips-card-label" title={label}>{label}</span>
      <span
        ref={valueRef}
        className={[
          'at-trips-card-value',
          muted ? 'at-trips-cell-muted' : '',
          truncatable ? 'at-trips-card-value--trunc' : '',
          expanded ? 'at-trips-card-value--expanded' : '',
        ].filter(Boolean).join(' ')}
        title={text}
        onClick={handleClick}
        onKeyDown={handleKeyDown}
        role={canExpand ? 'button' : undefined}
        tabIndex={canExpand ? 0 : undefined}
        aria-expanded={canExpand ? expanded : undefined}
      >
        {text}
      </span>
    </div>
  )
})

const TripCardVehicle = memo(function TripCardVehicle({ text, expanded, onToggle }) {
  const valueRef = useRef(null)
  const [truncatable, setTruncatable] = useState(false)

  useEffect(() => {
    const el = valueRef.current
    if (!el) return undefined

    const check = () => {
      if (expanded) return
      setTruncatable(el.scrollWidth > el.clientWidth + 1)
    }

    check()
    const observer = new ResizeObserver(check)
    observer.observe(el)
    return () => observer.disconnect()
  }, [text, expanded])

  const canExpand = truncatable || expanded

  const handleClick = (event) => {
    if (!canExpand) return
    event.stopPropagation()
    onToggle?.()
  }

  const handleKeyDown = (event) => {
    if (!canExpand) return
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      event.stopPropagation()
      onToggle?.()
    }
  }

  return (
    <span
      ref={valueRef}
      className={[
        'at-trips-card-vehicle',
        truncatable ? 'at-trips-card-vehicle--trunc' : '',
        expanded ? 'at-trips-card-vehicle--expanded' : '',
      ].filter(Boolean).join(' ')}
      title={text}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      role={canExpand ? 'button' : undefined}
      tabIndex={canExpand ? 0 : undefined}
      aria-expanded={canExpand ? expanded : undefined}
    >
      {text}
    </span>
  )
})

const avgSpeedKmh = (trip) => {
  if (trip.distance_km == null || !trip.duration_min) return null
  return trip.distance_km / (trip.duration_min / 60)
}

const formatTripRange = (start, end) => {
  const startLabel = start ? new Date(start).toLocaleDateString() : '—'
  const endLabel = end ? new Date(end).toLocaleDateString() : 'Ongoing'
  return `${startLabel} – ${endLabel}`
}

/** Build many date string forms so queries like "6 sep", "sep 6", "6/9" match. */
const dateSearchHaystacks = (iso) => {
  if (!iso) return []
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return []

  const day = d.getDate()
  const month = d.getMonth() + 1
  const year = d.getFullYear()
  const short = d.toLocaleString('en-US', { month: 'short' }).toLowerCase()
  const long = d.toLocaleString('en-US', { month: 'long' }).toLowerCase()
  const dd = String(day)
  const mm = String(month)
  const dd2 = dd.padStart(2, '0')
  const mm2 = mm.padStart(2, '0')

  return [
    formatDateTimeFull(iso),
    formatDateTimeCompact(iso),
    d.toLocaleDateString(),
    d.toLocaleDateString('en-GB'),
    d.toISOString().slice(0, 10),
    `${dd} ${short}`,
    `${dd} ${long}`,
    `${short} ${dd}`,
    `${long} ${dd}`,
    `${dd} ${short} ${year}`,
    `${dd} ${long} ${year}`,
    `${short} ${dd} ${year}`,
    `${long} ${dd} ${year}`,
    `${dd}/${mm}`,
    `${mm}/${dd}`,
    `${dd}-${mm}`,
    `${mm}-${dd}`,
    `${dd2}/${mm2}`,
    `${mm2}/${dd2}`,
    `${dd}/${mm}/${year}`,
    `${mm}/${dd}/${year}`,
    `${dd2}/${mm2}/${year}`,
    `${mm2}/${dd2}/${year}`,
    `${dd2}-${mm2}-${year}`,
    `${year}-${mm2}-${dd2}`,
    iso,
  ].map((value) => String(value).toLowerCase())
}

/** Precompute once per trip so search does not rebuild locale date strings per keystroke. */
const buildTripSearchBlob = (trip) => {
  const statusMeta = tripStatusMeta(trip.status)
  const fields = [
    trip.vehicle_name,
    tripDisplayDriverName(trip),
    trip.driver_name,
    trip.confirmed_driver_name,
    tripDisplayRouteName(trip),
    trip.route_name,
    trip.confirmed_route_name,
    trip.user_name,
    trip.manager_name,
    trip.status,
    statusMeta.label,
    trip.device_id,
    trip.plate_number,
    trip.trip_number,
    trip.end_time ? null : 'ongoing',
    trip.driver_confirmation_status,
    trip.route_confirmation_status,
  ]
  const parts = []
  for (const value of fields) {
    if (value != null && value !== '') parts.push(String(value).toLowerCase())
  }
  parts.push(...dateSearchHaystacks(trip.start_time))
  parts.push(...dateSearchHaystacks(trip.end_time))
  // Join on newlines so includes() cannot match across field/haystack boundaries.
  return parts.join('\n')
}

const compareNewestFirst = (a, b) => {
  const at = a.start_time || ''
  const bt = b.start_time || ''
  if (at === bt) return (b.id ?? 0) - (a.id ?? 0)
  return at < bt ? 1 : -1
}

const tripSortValue = (trip, key) => {
  if (key === 'total_cost') return tripTotalCostPkr(trip)
  if (key === 'avg_speed') return avgSpeedKmh(trip)
  if (key === 'manager_name' || key === 'user_name') {
    const value = trip[key]
    return value ? String(value).toLowerCase() : null
  }
  if (key === 'driver_name') {
    const value = tripDisplayDriverName(trip)
    return value ? String(value).toLowerCase() : null
  }
  if (key === 'route_name') {
    const value = tripDisplayRouteName(trip)
    return value ? String(value).toLowerCase() : null
  }
  return trip[key] ?? null
}

const sortTripsByColumn = (rows, key, dir = 'asc') => {
  const copy = [...rows]
  copy.sort((a, b) => {
    if (key === 'num') {
      const av = a.displayNumber ?? 0
      const bv = b.displayNumber ?? 0
      return dir === 'desc' ? bv - av : av - bv
    }
    const av = tripSortValue(a, key)
    const bv = tripSortValue(b, key)
    if (av == null && bv == null) return 0
    if (av == null) return 1
    if (bv == null) return -1
    const diff = typeof av === 'number' && typeof bv === 'number'
      ? av - bv
      : String(av).localeCompare(String(bv), undefined, { numeric: true, sensitivity: 'base' })
    if (diff === 0) return 0
    return dir === 'desc' ? -diff : diff
  })
  return copy
}

const exportTripsCsv = (rows) => {
  const header = ['Vehicle', 'User', 'Start', 'End', 'Distance (km)', 'Fuel cost', 'Toll', 'Challan', 'Total cost', 'Overspeed', 'Harsh brake', 'Status']
  const lines = rows.map((trip) => [
    trip.vehicle_name || '',
    trip.driver_name || '',
    trip.start_time || '',
    trip.end_time || '',
    trip.distance_km ?? '',
    trip.fuel_cost_pkr ?? '',
    trip.toll_tax_pkr ?? '',
    trip.challan_pkr ?? '',
    tripTotalCostPkr(trip) ?? '',
    trip.overspeed_count ?? '',
    trip.harsh_brake_count ?? '',
    trip.status || '',
  ].map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(','))
  const blob = new Blob([[header.join(','), ...lines].join('\n')], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = 'fleet-trips.csv'
  link.click()
  URL.revokeObjectURL(url)
}

const Field = ({ label, value, className }) => {
  const text = typeof value === 'string' || typeof value === 'number' ? String(value) : undefined
  return (
    <div className={['at-trips-detail-field', className].filter(Boolean).join(' ')}>
      <span className="at-trips-detail-field-label">{label}</span>
      <span className="at-trips-detail-field-value" title={text}>{value}</span>
    </div>
  )
}

const AdminTrips = () => {
  const { apiFor, can } = usePanelScope()
  const canViewTrips = can('trip_history')
  const [trips, setTrips] = useState([])
  const [loading, setLoading] = useState(true)
  const [groupBy, setGroupBy] = useState('none')
  const [sortKey, setSortKey] = useState('num')
  const [sortDir, setSortDir] = useState('asc')
  const [detailTrip, setDetailTrip] = useState(null)
  const [expandedFieldKey, setExpandedFieldKey] = useState(null)
  const [expandedCardIds, setExpandedCardIds] = useState(() => new Set())
  const [periodFilter, setPeriodFilter] = useState('current_month')
  const [search, setSearch] = useState('')
  const [showFilters, setShowFilters] = useState(false)
  const [isMobileCards, setIsMobileCards] = useState(() => (
    typeof window !== 'undefined' ? window.matchMedia(MOBILE_CARDS_MQ).matches : false
  ))
  const filtersRef = useRef(null)
  const searchBlobCacheRef = useRef(new Map())
  const deferredSearch = useDeferredValue(search)

  useEffect(() => {
    if (!canViewTrips) {
      setTrips([])
      setLoading(false)
      return undefined
    }
    const controller = new AbortController()
    setLoading(true)
    const params = { ...tripPeriodToParams(periodFilter) }

    api.get(apiFor('/trips', '/api/trips'), { params, signal: controller.signal })
      .then((res) => {
        startTransition(() => setTrips(res.data || []))
      })
      .catch((err) => {
        if (
          controller.signal.aborted
          || err?.code === 'ERR_CANCELED'
          || err?.name === 'CanceledError'
          || err?.name === 'AbortError'
        ) {
          return
        }
        console.error('Failed to load trips:', err)
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })

    return () => controller.abort()
  }, [periodFilter, apiFor, canViewTrips])

  useEffect(() => {
    const mq = window.matchMedia(MOBILE_CARDS_MQ)
    const sync = () => setIsMobileCards(mq.matches)
    sync()
    mq.addEventListener('change', sync)
    return () => mq.removeEventListener('change', sync)
  }, [])

  const baseTrips = useMemo(
    () => [...trips].sort(compareNewestFirst),
    [trips],
  )

  // Stable trip numbers: rank within the period-filtered list (newest = 1).
  // Search blobs are built lazily on first search so initial paint stays light.
  const numberedBase = useMemo(
    () => baseTrips.map((trip, index) => ({
      ...trip,
      displayNumber: index + 1,
    })),
    [baseTrips],
  )

  useEffect(() => {
    searchBlobCacheRef.current = new Map()
  }, [numberedBase])

  const deferredQuery = deferredSearch.trim().toLowerCase()
  const numberedTrips = useMemo(() => {
    if (!deferredQuery) return numberedBase
    const cache = searchBlobCacheRef.current
    return numberedBase.filter((trip) => {
      let blob = cache.get(trip.id)
      if (blob == null) {
        blob = buildTripSearchBlob(trip)
        cache.set(trip.id, blob)
      }
      return blob.includes(deferredQuery)
    })
  }, [numberedBase, deferredQuery])

  useEffect(() => {
    if (!showFilters) return undefined
    const onPointer = (event) => {
      if (filtersRef.current && !filtersRef.current.contains(event.target)) {
        const active = document.activeElement
        if (
          active
          && filtersRef.current.contains(active)
          && (active.type === 'date' || active.type === 'datetime-local')
        ) {
          return
        }
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

  const sortedTrips = useMemo(
    () => sortTripsByColumn(numberedTrips, sortKey, sortDir),
    [numberedTrips, sortKey, sortDir],
  )

  const groups = useMemo(() => {
    if (groupBy === 'none') return [{ label: null, rows: sortedTrips }]
    const map = new Map()
    for (const trip of numberedTrips) {
      let groupKey
      if (groupBy === 'driver') groupKey = tripDisplayDriverName(trip) || 'Unassigned'
      else if (groupBy === 'date') groupKey = dateOf(trip.start_time)
      else if (groupBy === 'manager') groupKey = trip.manager_name || 'Unassigned'
      else if (groupBy === 'vehicle') groupKey = trip.vehicle_name
      else groupKey = dateOf(trip.start_time)
      if (!map.has(groupKey)) map.set(groupKey, [])
      map.get(groupKey).push(trip)
    }
    return Array.from(map.entries()).map(([label, rows]) => ({
      label,
      rows: sortTripsByColumn(rows, sortKey, sortDir),
    }))
  }, [numberedTrips, sortedTrips, groupBy, sortKey, sortDir])

  const toggleSort = (key) => {
    if (sortKey === key) {
      setSortDir((current) => (current === 'asc' ? 'desc' : 'asc'))
      return
    }
    setSortKey(key)
    setSortDir('asc')
  }

  const applySavedCosts = (updated) => {
    setTrips((current) => current.map((item) => (
      item.id === updated.id
        ? { ...item, toll_tax_pkr: updated.toll_tax_pkr, challan_pkr: updated.challan_pkr }
        : item
    )))
    setDetailTrip((current) => (
      current && current.id === updated.id
        ? { ...current, toll_tax_pkr: updated.toll_tax_pkr, challan_pkr: updated.challan_pkr }
        : current
    ))
  }

  const handleDriverConfirmed = (updated) => {
    setTrips((current) => current.map((item) => (
      item.id === updated.id
        ? {
            ...item,
            driver_confirmation_status: updated.driver_confirmation_status,
            confirmed_driver_id: updated.confirmed_driver_id,
            confirmed_driver_name: updated.confirmed_driver_name,
            confirmed_driver_pic_url: updated.confirmed_driver_pic_url,
            driver_id: updated.driver_id,
            driver_name: updated.driver_name,
            driver_pic_url: updated.driver_pic_url,
            driver_alert: updated.driver_alert,
          }
        : item
    )))
    setDetailTrip((current) => (
      current && current.id === updated.id
        ? {
            ...current,
            driver_confirmation_status: updated.driver_confirmation_status,
            confirmed_driver_id: updated.confirmed_driver_id,
            confirmed_driver_name: updated.confirmed_driver_name,
            confirmed_driver_pic_url: updated.confirmed_driver_pic_url,
            driver_id: updated.driver_id,
            driver_name: updated.driver_name,
            driver_pic_url: updated.driver_pic_url,
            driver_alert: updated.driver_alert,
          }
        : current
    ))
  }

  const handleRouteConfirmed = (updated) => {
    setTrips((current) => current.map((item) => (
      item.id === updated.id
        ? {
            ...item,
            route_confirmation_status: updated.route_confirmation_status,
            confirmed_route_id: updated.confirmed_route_id,
            confirmed_route_name: updated.confirmed_route_name,
            route_id: updated.route_id,
            route_name: updated.route_name,
          }
        : item
    )))
    setDetailTrip((current) => (
      current && current.id === updated.id
        ? {
            ...current,
            route_confirmation_status: updated.route_confirmation_status,
            confirmed_route_id: updated.confirmed_route_id,
            confirmed_route_name: updated.confirmed_route_name,
            route_id: updated.route_id,
            route_name: updated.route_name,
          }
        : current
    ))
  }

  const renderTripRow = (trip) => {
    const avg = avgSpeedKmh(trip)
    return (
      <tr
        key={trip.id}
        className="at-trips-row at-trips-row--clickable"
        onClick={() => setDetailTrip(trip)}
        tabIndex={0}
        role="button"
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            setDetailTrip(trip)
          }
        }}
      >
        <td className="at-trips-cell-num at-trips-sticky-num">
          {trip.displayNumber}
        </td>
        <td className="at-trips-cell-vehicle at-trips-sticky-vehicle" title={trip.vehicle_name || undefined}>
          {trip.vehicle_name || '—'}
        </td>
        <td className="at-trips-col-driver">
          <TripDriverConfirmCell trip={trip} onConfirmed={handleDriverConfirmed} />
        </td>
        <td className="at-trips-col-route">
          <TripRouteConfirmCell trip={trip} onConfirmed={handleRouteConfirmed} />
        </td>
        <td className="at-trips-col-status">
          <TripStatusPill status={trip.status} />
        </td>
        <td className="at-trips-cell-muted at-trips-col-datetime" title={formatDateTimeFull(trip.start_time)}>
          {formatDateTimeCompact(trip.start_time)}
        </td>
        <td className="at-trips-cell-muted at-trips-col-datetime" title={trip.end_time ? formatDateTimeFull(trip.end_time) : 'Ongoing'}>
          {trip.end_time ? formatDateTimeCompact(trip.end_time) : 'Ongoing'}
        </td>
        <td className="at-trips-col-num" title={formatDistanceFull(trip.distance_km)}>
          {formatDistanceCompact(trip.distance_km)}
        </td>
        <td className="at-trips-col-num">{formatDurationCompact(trip.duration_min)}</td>
        <td className="at-trips-col-num" title={avg != null ? `${Number(avg).toFixed(1)} km/h` : undefined}>
          {formatAvgSpeedCompact(avg)}
        </td>
        <td className="at-trips-col-num" title={trip.max_speed_kmh != null ? `${trip.max_speed_kmh} km/h` : undefined}>
          {formatMaxSpeedCompact(trip.max_speed_kmh)}
        </td>
        <td className="at-trips-col-num" title={formatLitersFull(trip.total_fuel_liters)}>
          {formatLitersCompact(trip.total_fuel_liters)}
        </td>
        <td className="at-trips-col-num" title={formatFuelPriceFull(trip.price_per_liter_used)}>
          {formatFuelPriceCompact(trip.price_per_liter_used)}
        </td>
        <td className="at-trips-cell-cost at-trips-col-cost" title={formatPkrFull(trip.fuel_cost_pkr)}>
          {formatPkrCompact(trip.fuel_cost_pkr)}
        </td>
        <td className="at-trips-cell-cost at-trips-col-cost" title={formatPkrFull(trip.toll_tax_pkr)}>
          {formatPkrCompact(trip.toll_tax_pkr)}
        </td>
        <td className="at-trips-cell-cost at-trips-col-cost" title={formatPkrFull(trip.challan_pkr)}>
          {formatPkrCompact(trip.challan_pkr)}
        </td>
        <td className="at-trips-col-count">{fmt(trip.harsh_brake_count)}</td>
        <td className="at-trips-col-count">{fmt(trip.harsh_accel_count)}</td>
        <td className="at-trips-col-count">{fmt(trip.overspeed_count)}</td>
        <td className="at-trips-col-count">{fmt(trip.idle_count)}</td>
        <td className="at-trips-cell-cost at-trips-sticky-cost" title={formatPkrFull(tripTotalCostPkr(trip))}>
          {formatPkrCompact(tripTotalCostPkr(trip))}
        </td>
      </tr>
    )
  }

  const toggleCardExpanded = (tripId) => {
    setExpandedCardIds((prev) => {
      const next = new Set(prev)
      if (next.has(tripId)) next.delete(tripId)
      else next.add(tripId)
      return next
    })
  }

  const renderTripCard = (trip) => {
    const avg = avgSpeedKmh(trip)
    const totalCost = tripTotalCostPkr(trip)
    const vehicleText = trip.vehicle_name || '—'
    const vehicleKey = `${trip.id}:Vehicle`
    const vehicleExpanded = expandedFieldKey === vehicleKey
    const isExpanded = expandedCardIds.has(trip.id)
    const extraId = `trip-card-extra-${trip.id}`

    const fieldProps = (label) => {
      const key = `${trip.id}:${label}`
      return {
        expanded: expandedFieldKey === key,
        onToggle: () => setExpandedFieldKey((prev) => (prev === key ? null : key)),
      }
    }

    const openDetails = () => {
      setExpandedFieldKey(null)
      setDetailTrip(trip)
    }

    return (
      <article
        key={trip.id}
        className={`at-trips-card${isExpanded ? ' at-trips-card--expanded' : ''}`}
        role="button"
        tabIndex={0}
        onClick={openDetails}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            openDetails()
          }
        }}
      >
        <div className="at-trips-card-header">
          <div className="at-trips-card-identity">
            <span className="at-trips-card-num">#{trip.displayNumber ?? trip.trip_number ?? '—'}</span>
            <TripCardVehicle
              text={vehicleText}
              expanded={vehicleExpanded}
              onToggle={() => setExpandedFieldKey((prev) => (prev === vehicleKey ? null : vehicleKey))}
            />
          </div>
          <TripStatusPill status={trip.status} />
        </div>

        <div className="at-trips-card-body">
          <div className="at-trips-card-group at-trips-card-group--2">
            <TripCardField label="Start" value={formatDateTimeCompact(trip.start_time)} muted {...fieldProps('Start')} />
            <TripCardField
              label="End"
              value={trip.end_time ? formatDateTimeCompact(trip.end_time) : 'Ongoing'}
              muted
              {...fieldProps('End')}
            />
          </div>

          <div className="at-trips-card-group at-trips-card-group--2">
            <div className="at-trips-card-driver-wrap">
              <span className="at-trips-card-field-label">Driver</span>
              <TripDriverConfirmCell trip={trip} compact readonly />
            </div>
            <div className="at-trips-card-driver-wrap">
              <span className="at-trips-card-field-label">Route</span>
              <TripRouteConfirmCell trip={trip} compact readonly />
            </div>
          </div>

          <div className="at-trips-card-group at-trips-card-group--2">
            <TripCardField label="Distance" value={formatDistanceCompact(trip.distance_km)} {...fieldProps('Distance')} />
            <TripCardField label="Duration" value={formatDurationCompact(trip.duration_min)} {...fieldProps('Duration')} />
          </div>

          {isExpanded && (
            <div className="at-trips-card-extra" id={extraId}>
              <div className="at-trips-card-group">
                <TripCardField label="Average" value={formatAvgSpeedCompact(avg)} {...fieldProps('Average')} />
                <TripCardField label="Max speed" value={formatMaxSpeedCompact(trip.max_speed_kmh)} {...fieldProps('Max speed')} />
                <TripCardField label="Fuel used" value={formatLitersCompact(trip.total_fuel_liters)} {...fieldProps('Fuel used')} />
              </div>

              <div className="at-trips-card-group">
                <TripCardField label="Price Rs/L" value={formatFuelPriceCompact(trip.price_per_liter_used)} {...fieldProps('Price Rs/L')} />
                <TripCardField label="Fuel cost" value={formatPkrCompact(trip.fuel_cost_pkr)} {...fieldProps('Fuel cost')} />
                <TripCardField label="Toll tax" value={formatPkrCompact(trip.toll_tax_pkr)} {...fieldProps('Toll tax')} />
                <TripCardField label="Challan" value={formatPkrCompact(trip.challan_pkr)} {...fieldProps('Challan')} />
                <TripCardField label="Total cost" value={formatPkrCompact(totalCost)} {...fieldProps('Total cost')} />
                <TripCardField label="Idle" value={fmt(trip.idle_count)} {...fieldProps('Idle')} />
              </div>

              <div className="at-trips-card-group">
                <TripCardField label="Harsh brakes" value={fmt(trip.harsh_brake_count)} {...fieldProps('Harsh brakes')} />
                <TripCardField label="Harsh accel" value={fmt(trip.harsh_accel_count)} {...fieldProps('Harsh accel')} />
                <TripCardField label="Overspeed" value={fmt(trip.overspeed_count)} {...fieldProps('Overspeed')} />
              </div>
            </div>
          )}
        </div>

        <button
          type="button"
          className={`at-trips-card-expand${isExpanded ? ' is-open' : ''}`}
          aria-expanded={isExpanded}
          aria-controls={isExpanded ? extraId : undefined}
          aria-label={isExpanded ? 'Hide trip details' : 'Show more trip details'}
          onClick={(event) => {
            event.stopPropagation()
            event.preventDefault()
            toggleCardExpanded(trip.id)
          }}
        >
          <ChevronDown size={18} aria-hidden />
        </button>
      </article>
    )
  }

  const activeFilterCount = [
    periodFilter !== 'current_month',
    groupBy !== 'none',
  ].filter(Boolean).length

  const resetFilters = () => {
    setPeriodFilter('current_month')
    setGroupBy('none')
  }

  return (
    <div className="at-trips-page">
      <MobilePageHeading>{adminNavLabel('/admin/trips')}</MobilePageHeading>
      <div className="at-trips-panel">
        <div className="at-trips-toolbar" ref={filtersRef}>
          <div className="at-trips-search ft-search">
            <Search size={16} color="var(--ft-text-disabled)" />
            <input
              type="search"
              placeholder="Search"
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
          </div>

          {showFilters && (
            <div className="at-trips-filters-dropdown" role="dialog" aria-label="Trip filters">
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
                <span className="at-trips-filter-label">Period</span>
                <FilterBar
                  options={TRIP_PERIODS}
                  value={periodFilter}
                  onChange={setPeriodFilter}
                />
              </div>

              <div className="at-trips-filter-group">
                <span className="at-trips-filter-label">Group by</span>
                <FilterBar
                  options={GROUP_OPTIONS}
                  value={groupBy}
                  onChange={setGroupBy}
                />
              </div>
            </div>
          )}
        </div>

        {loading ? (
          <LoadingState label="Loading trips…" />
        ) : !canViewTrips ? (
          <div className="at-trips-empty">You don't have permission to view this.</div>
        ) : numberedTrips.length === 0 ? (
          <div className="at-trips-empty">No trips match the current filters.</div>
        ) : (
          <div className="at-trips-table-section">
            {!isMobileCards && (
              <div className="at-trips-table-wrap">
                <table className="at-trips-table at-trips-table--admin">
                  <thead>
                    <tr>
                      {ADMIN_COLUMNS.map((column) => (
                        <th
                          key={column.key}
                          title={column.title || column.label}
                          className={[
                            column.className,
                            column.sortable ? 'at-trips-th--sortable' : '',
                          ].filter(Boolean).join(' ') || undefined}
                          aria-sort={
                            column.sortable && sortKey === column.key
                              ? (sortDir === 'asc' ? 'ascending' : 'descending')
                              : undefined
                          }
                          onClick={column.sortable ? () => toggleSort(column.key) : undefined}
                        >
                          {column.sortable ? (
                            <span className="at-trips-th-label">
                              {column.label}
                              <SortIcon active={sortKey === column.key} dir={sortDir} />
                            </span>
                          ) : (
                            column.label
                          )}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {groupBy === 'none'
                      ? sortedTrips.map((trip) => renderTripRow(trip))
                      : groups.map((group, i) => (
                        <Fragment key={`group-${i}`}>
                          {group.label && (
                            <tr className="at-trips-group-row">
                              <td colSpan={ADMIN_COLUMNS.length}>{group.label}</td>
                            </tr>
                          )}
                          {group.rows.map((trip) => renderTripRow(trip))}
                        </Fragment>
                      ))}
                  </tbody>
                </table>
              </div>
            )}

            {isMobileCards && (
              <div className="at-trips-cards" aria-label="Trips">
                {groupBy === 'none'
                  ? sortedTrips.map((trip) => renderTripCard(trip))
                  : groups.map((group, i) => (
                    <Fragment key={`card-group-${i}`}>
                      {group.label && (
                        <div className="at-trips-card-group-label">{group.label}</div>
                      )}
                      {group.rows.map((trip) => renderTripCard(trip))}
                    </Fragment>
                  ))}
              </div>
            )}
          </div>
        )}

        <Modal
          open={!!detailTrip}
          onClose={() => setDetailTrip(null)}
          title={detailTrip ? (
            <span className="at-trips-detail-title">
              <span className="at-trips-detail-title-text">
                {`Trip #${detailTrip.displayNumber ?? detailTrip.trip_number} details`}
              </span>
              <TripStatusPill status={detailTrip.status} />
            </span>
          ) : ''}
          size="md"
          className="at-trips-detail-modal"
        >
          {detailTrip && (
            <div className="at-trips-detail">
              <Field label="Vehicle" value={detailTrip.vehicle_name || '—'} />
              {detailTrip.manager_name && (
                <Field label="Manager" value={detailTrip.manager_name} />
              )}
              <Field label="User" value={detailTrip.user_name || '—'} />
              <div className="at-trips-detail-pair">
                <Field
                  className="at-trips-detail-field--confirm"
                  label="Driver"
                  value={<TripDriverConfirmCell trip={detailTrip} onConfirmed={handleDriverConfirmed} />}
                />
                <Field
                  className="at-trips-detail-field--confirm"
                  label="Route"
                  value={<TripRouteConfirmCell trip={detailTrip} onConfirmed={handleRouteConfirmed} />}
                />
              </div>
              <Field
                label="Start"
                value={formatDateTimeCompact(detailTrip.start_time)}
              />
              <Field
                label="End"
                value={detailTrip.end_time ? formatDateTimeCompact(detailTrip.end_time) : 'Ongoing'}
              />
              <Field label="Distance" value={formatDistanceCompact(detailTrip.distance_km)} />
              <Field label="Duration" value={formatDurationCompact(detailTrip.duration_min)} />
              <Field label="Max speed" value={detailTrip.max_speed_kmh != null ? `${detailTrip.max_speed_kmh} km/h` : '—'} />
              <Field label="Fuel used" value={formatLitersCompact(detailTrip.total_fuel_liters)} />
              <Field label="Price Rs/L" value={formatFuelPriceCompact(detailTrip.price_per_liter_used)} />
              <Field label="Fuel cost" value={formatPkrCompact(detailTrip.fuel_cost_pkr)} />
              <Field label="Total cost" value={formatPkrCompact(tripTotalCostPkr(detailTrip))} />
              <Field label="Harsh brakes" value={fmt(detailTrip.harsh_brake_count)} />
              <Field label="Harsh accel" value={fmt(detailTrip.harsh_accel_count)} />
              <Field label="Overspeed" value={fmt(detailTrip.overspeed_count)} />
              <Field label="Idle" value={fmt(detailTrip.idle_count)} />
              <TripCostsBox
                trip={detailTrip}
                apiFor={apiFor}
                onSaved={applySavedCosts}
              />
            </div>
          )}
        </Modal>
      </div>
    </div>
  )
}

export default AdminTrips
