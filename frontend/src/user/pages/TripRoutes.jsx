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
  EmptyState,
  Modal,
  Avatar,
  TripCostsBox,
  tripTotalCostPkr,
} from '../../shared/components'
import { MobilePageHeading } from '../../shared/shell'
import { userNavLabel } from '../navItems'
import { useSelectedDevice } from '../context/SelectedDeviceContext'
import { userPicSrc } from '../../admin/utils/userPic'
import { TRIP_PERIODS, tripPeriodToParams } from '../../admin/utils/tripPeriod'
import {
  tripDisplayDriverName,
  tripDisplayDriverPic,
} from '../../admin/components/TripDriverConfirmCell'
import { tripDisplayRouteName } from '../../admin/components/TripRouteConfirmCell'
import {
  USER_COLUMNS,
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
} from '../../admin/utils/tripTableDisplay'
import '../../admin/styles/admin-trips.css'

const MOBILE_CARDS_MQ = '(max-width: 768px)'
const TRIPS_LIST_CACHE_MAX = 12
const tripsListCache = new Map()

const tripsListCacheKey = (deviceId, periodFilter) => `${deviceId}|${periodFilter}`

const getCachedTripsList = (key) => tripsListCache.get(key)

const setCachedTripsList = (key, value) => {
  if (tripsListCache.has(key)) tripsListCache.delete(key)
  tripsListCache.set(key, value)
  while (tripsListCache.size > TRIPS_LIST_CACHE_MAX) {
    const oldest = tripsListCache.keys().next().value
    tripsListCache.delete(oldest)
  }
  return value
}

const GROUP_OPTIONS = [
  { key: 'none', label: 'Ungrouped' },
  { key: 'driver', label: 'Driver-wise' },
  { key: 'date', label: 'Date-wise' },
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

/** Precompute once per trip so search does not rebuild strings per keystroke. */
const buildTripSearchBlob = (trip) => {
  const statusMeta = tripStatusMeta(trip.status)
  const fields = [
    tripDisplayDriverName(trip),
    trip.driver_name,
    trip.confirmed_driver_name,
    tripDisplayRouteName(trip),
    trip.route_name,
    trip.confirmed_route_name,
    trip.vehicle_name,
    trip.status,
    statusMeta.label,
    trip.trip_number,
    trip.end_time ? null : 'ongoing',
    trip.driver_confirmation_status,
    trip.route_confirmation_status,
  ]
  const parts = []
  for (const value of fields) {
    if (value != null && value !== '') parts.push(String(value).toLowerCase())
  }
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

const Field = ({ label, value }) => {
  const text = typeof value === 'string' || typeof value === 'number' ? String(value) : undefined
  return (
    <div className="at-trips-detail-field">
      <span className="at-trips-detail-field-label">{label}</span>
      <span className="at-trips-detail-field-value" title={text}>{value}</span>
    </div>
  )
}

const TripRoutes = () => {
  const { deviceId } = useSelectedDevice()
  const [trips, setTrips] = useState([])
  const [loading, setLoading] = useState(true)
  const [groupBy, setGroupBy] = useState('none')
  const [sortKey, setSortKey] = useState('num')
  const [sortDir, setSortDir] = useState('asc')
  const [detailTrip, setDetailTrip] = useState(null)
  const [expandedFieldKey, setExpandedFieldKey] = useState(null)
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
    if (!deviceId) {
      setTrips([])
      setLoading(false)
      return undefined
    }

    const cacheKey = tripsListCacheKey(deviceId, periodFilter)
    const cached = getCachedTripsList(cacheKey)
    if (cached) {
      setTrips(cached)
      setLoading(false)
    } else {
      setLoading(true)
    }

    const controller = new AbortController()
    const params = { ...tripPeriodToParams(periodFilter) }
    api.get(`/api/trips/${deviceId}`, { params, signal: controller.signal })
      .then((res) => {
        const next = res.data || []
        setCachedTripsList(cacheKey, next)
        startTransition(() => setTrips(next))
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
  }, [deviceId, periodFilter])

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
      else groupKey = dateOf(trip.start_time)
      if (!map.has(groupKey)) map.set(groupKey, [])
      map.get(groupKey).push(trip)
    }
    return Array.from(map.entries()).map(([label, rows]) => ({
      label,
      rows: sortTripsByColumn(rows, sortKey, sortDir),
    }))
  }, [numberedTrips, sortedTrips, groupBy, sortKey, sortDir])

  const activeFilterCount = [
    periodFilter !== 'current_month',
    groupBy !== 'none',
  ].filter(Boolean).length

  const resetFilters = () => {
    setPeriodFilter('current_month')
    setGroupBy('none')
  }

  const toggleSort = (key) => {
    if (sortKey === key) {
      setSortDir((current) => (current === 'asc' ? 'desc' : 'asc'))
      return
    }
    setSortKey(key)
    setSortDir('asc')
  }

  const applySavedCosts = (updated) => {
    setTrips((current) => {
      const next = current.map((item) => (
        item.id === updated.id
          ? { ...item, toll_tax_pkr: updated.toll_tax_pkr, challan_pkr: updated.challan_pkr }
          : item
      ))
      if (deviceId) {
        setCachedTripsList(tripsListCacheKey(deviceId, periodFilter), next)
      }
      return next
    })
    setDetailTrip((current) => (
      current && current.id === updated.id
        ? { ...current, toll_tax_pkr: updated.toll_tax_pkr, challan_pkr: updated.challan_pkr }
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
        <td className="at-trips-col-driver">
          <div className={`at-trips-driver-confirm at-trips-driver-confirm--readonly ${trip.driver_confirmation_status === 'confirmed' ? 'at-trips-driver-confirm--confirmed' : 'at-trips-driver-confirm--pending'}`}>
            <div className="at-trips-driver-confirm-row">
              <span className="at-trips-driver-avatar-wrap">
                <Avatar
                  name={tripDisplayDriverName(trip) || 'Unassigned'}
                  size="sm"
                  src={userPicSrc(tripDisplayDriverPic(trip))}
                />
              </span>
              <div className="at-trips-driver-confirm-meta">
                <div className="at-trips-driver-confirm-name-row">
                  <span className="at-trips-driver-name" title={tripDisplayDriverName(trip) || 'Unassigned'}>
                    {tripDisplayDriverName(trip) || 'Unassigned'}
                  </span>
                </div>
                <span className={`at-trips-driver-badge ${trip.driver_confirmation_status === 'confirmed' ? 'is-confirmed' : 'is-pending'}`}>
                  {trip.driver_confirmation_status === 'confirmed' ? 'Confirmed' : 'Pending'}
                </span>
              </div>
            </div>
          </div>
        </td>
        <td className="at-trips-col-route">
          <div className={`at-trips-driver-confirm at-trips-route-confirm at-trips-driver-confirm--readonly ${trip.route_confirmation_status === 'confirmed' ? 'at-trips-driver-confirm--confirmed' : 'at-trips-driver-confirm--pending'}`}>
            <div className="at-trips-driver-confirm-row">
              <div className="at-trips-driver-confirm-meta">
                <div className="at-trips-driver-confirm-name-row">
                  <span className="at-trips-driver-name" title={tripDisplayRouteName(trip) || 'Unassigned'}>
                    {tripDisplayRouteName(trip) || 'Unassigned'}
                  </span>
                </div>
                <span className={`at-trips-driver-badge ${trip.route_confirmation_status === 'confirmed' ? 'is-confirmed' : 'is-pending'}`}>
                  {trip.route_confirmation_status === 'confirmed' ? 'Confirmed' : 'Pending'}
                </span>
              </div>
            </div>
          </div>
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

  const renderTripCard = (trip) => {
    const avg = avgSpeedKmh(trip)
    const totalCost = tripTotalCostPkr(trip)
    const identityText = trip.vehicle_name || trip.driver_name || '—'
    const identityKey = `${trip.id}:Identity`
    const identityExpanded = expandedFieldKey === identityKey

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
        className="at-trips-card"
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
              text={identityText}
              expanded={identityExpanded}
              onToggle={() => setExpandedFieldKey((prev) => (prev === identityKey ? null : identityKey))}
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

          <div className="at-trips-card-group">
            <TripCardField
              label="Driver"
              value={(
                <span className="at-trips-card-driver-readonly">
                  {tripDisplayDriverName(trip) || 'Unassigned'}
                  <span className={`at-trips-driver-badge ${trip.driver_confirmation_status === 'confirmed' ? 'is-confirmed' : 'is-pending'}`}>
                    {trip.driver_confirmation_status === 'confirmed' ? 'Confirmed' : 'Pending'}
                  </span>
                </span>
              )}
              {...fieldProps('Driver')}
            />
            <TripCardField
              label="Route"
              value={(
                <span className="at-trips-card-driver-readonly">
                  {tripDisplayRouteName(trip) || 'Unassigned'}
                  <span className={`at-trips-driver-badge ${trip.route_confirmation_status === 'confirmed' ? 'is-confirmed' : 'is-pending'}`}>
                    {trip.route_confirmation_status === 'confirmed' ? 'Confirmed' : 'Pending'}
                  </span>
                </span>
              )}
              {...fieldProps('Route')}
            />
            <TripCardField label="Distance" value={formatDistanceCompact(trip.distance_km)} {...fieldProps('Distance')} />
            <TripCardField label="Duration" value={formatDurationCompact(trip.duration_min)} {...fieldProps('Duration')} />
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
      </article>
    )
  }

  if (!deviceId) {
    return (
      <EmptyState
        title="No vehicle assigned"
        description="This user does not have a vehicle yet."
      />
    )
  }

  return (
    <div className="at-trips-page">
      <MobilePageHeading>{userNavLabel('/user/trip-routes')}</MobilePageHeading>
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
        ) : numberedTrips.length === 0 ? (
          <div className="at-trips-empty">No trips match the current filters.</div>
        ) : (
          <div className="at-trips-table-section">
            {!isMobileCards && (
              <div className="at-trips-table-wrap">
                <table className="at-trips-table at-trips-table--admin">
                  <thead>
                    <tr>
                      {USER_COLUMNS.map((column) => (
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
                              <td colSpan={USER_COLUMNS.length}>{group.label}</td>
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
      </div>

      <Modal
        open={!!detailTrip}
        onClose={() => setDetailTrip(null)}
        title={detailTrip ? `Trip #${detailTrip.displayNumber ?? detailTrip.trip_number} details` : ''}
        size="md"
        className="at-trips-detail-modal"
      >
        {detailTrip && (
          <div className="at-trips-detail">
            <Field label="Vehicle" value={detailTrip.vehicle_name || '—'} />
            {detailTrip.manager_name && (
              <Field label="Manager" value={detailTrip.manager_name} />
            )}
            {detailTrip.user_name && (
              <Field label="User" value={detailTrip.user_name} />
            )}
            <Field
              label="Driver"
              value={(
                <span className="at-trips-card-driver-readonly">
                  {tripDisplayDriverName(detailTrip) || 'Unassigned'}
                  <span className={`at-trips-driver-badge ${detailTrip.driver_confirmation_status === 'confirmed' ? 'is-confirmed' : 'is-pending'}`}>
                    {detailTrip.driver_confirmation_status === 'confirmed' ? 'Confirmed' : 'Pending'}
                  </span>
                </span>
              )}
            />
            <Field
              label="Route"
              value={(
                <span className="at-trips-card-driver-readonly">
                  {tripDisplayRouteName(detailTrip) || 'Unassigned'}
                  <span className={`at-trips-driver-badge ${detailTrip.route_confirmation_status === 'confirmed' ? 'is-confirmed' : 'is-pending'}`}>
                    {detailTrip.route_confirmation_status === 'confirmed' ? 'Confirmed' : 'Pending'}
                  </span>
                </span>
              )}
            />
            <Field label="Status" value={<TripStatusPill status={detailTrip.status} />} />
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
              onSaved={applySavedCosts}
            />
          </div>
        )}
      </Modal>
    </div>
  )
}

export default TripRoutes
