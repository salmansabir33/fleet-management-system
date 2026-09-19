/** Shared trip table columns + cell formatters (admin + user trips pages). */

export const ADMIN_COLUMNS = [
  { key: 'num', label: '#', className: 'at-trips-sticky-num', sortable: true },
  { key: 'vehicle_name', label: 'Vehicle', className: 'at-trips-sticky-vehicle at-trips-col-vehicle' },
  { key: 'driver_name', label: 'Driver', className: 'at-trips-col-driver', sortable: true },
  { key: 'route_name', label: 'Route', className: 'at-trips-col-route', sortable: true },
  { key: 'status', label: 'Status', className: 'at-trips-col-status' },
  { key: 'start_time', label: 'Start', className: 'at-trips-col-datetime' },
  { key: 'end_time', label: 'End', className: 'at-trips-col-datetime' },
  { key: 'distance_km', label: 'Distance', className: 'at-trips-col-num', sortable: true },
  { key: 'duration_min', label: 'Duration', className: 'at-trips-col-num' },
  { key: 'avg_speed', label: 'Average', className: 'at-trips-col-num' },
  { key: 'max_speed_kmh', label: 'Max speed', className: 'at-trips-col-num' },
  { key: 'total_fuel_liters', label: 'Fuel used', className: 'at-trips-col-num' },
  { key: 'price_per_liter_used', label: 'Price Rs/L', className: 'at-trips-col-num' },
  { key: 'fuel_cost_pkr', label: 'Fuel cost', className: 'at-trips-col-cost' },
  { key: 'toll_tax_pkr', label: 'Toll tax', className: 'at-trips-col-cost' },
  { key: 'challan_pkr', label: 'Challan', className: 'at-trips-col-cost' },
  { key: 'harsh_brake_count', label: 'Harsh brakes', className: 'at-trips-col-count' },
  { key: 'harsh_accel_count', label: 'Harsh acceleration', className: 'at-trips-col-count' },
  { key: 'overspeed_count', label: 'Overspeed', className: 'at-trips-col-count' },
  { key: 'idle_count', label: 'Idle', className: 'at-trips-col-count' },
  { key: 'total_cost', label: 'Total cost', className: 'at-trips-sticky-cost at-trips-col-cost', sortable: true },
]

export const USER_COLUMNS = [
  { key: 'num', label: '#', className: 'at-trips-sticky-num', sortable: true },
  { key: 'driver_name', label: 'Driver', className: 'at-trips-col-driver', sortable: true },
  { key: 'route_name', label: 'Route', className: 'at-trips-col-route', sortable: true },
  { key: 'status', label: 'Status', className: 'at-trips-col-status' },
  { key: 'start_time', label: 'Start', className: 'at-trips-col-datetime' },
  { key: 'end_time', label: 'End', className: 'at-trips-col-datetime' },
  { key: 'distance_km', label: 'Distance', className: 'at-trips-col-num', sortable: true },
  { key: 'duration_min', label: 'Duration', className: 'at-trips-col-num' },
  { key: 'avg_speed', label: 'Average', className: 'at-trips-col-num' },
  { key: 'max_speed_kmh', label: 'Max speed', className: 'at-trips-col-num' },
  { key: 'total_fuel_liters', label: 'Fuel used', className: 'at-trips-col-num' },
  { key: 'price_per_liter_used', label: 'Price Rs/L', className: 'at-trips-col-num' },
  { key: 'fuel_cost_pkr', label: 'Fuel cost', className: 'at-trips-col-cost' },
  { key: 'toll_tax_pkr', label: 'Toll tax', className: 'at-trips-col-cost' },
  { key: 'challan_pkr', label: 'Challan', className: 'at-trips-col-cost' },
  { key: 'harsh_brake_count', label: 'Harsh brakes', className: 'at-trips-col-count' },
  { key: 'harsh_accel_count', label: 'Harsh acceleration', className: 'at-trips-col-count' },
  { key: 'overspeed_count', label: 'Overspeed', className: 'at-trips-col-count' },
  { key: 'idle_count', label: 'Idle', className: 'at-trips-col-count' },
  { key: 'total_cost', label: 'Total cost', className: 'at-trips-sticky-cost at-trips-col-cost', sortable: true },
]

export const formatDateTimeFull = (iso) => (
  iso
    ? new Date(iso).toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    })
    : '—'
)

export const formatDateTimeCompact = (iso) => {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

export const formatDistanceFull = (km) => (km == null ? '—' : `${Number(km).toFixed(1)} km`)
export const formatDistanceCompact = (km) => (km == null ? '—' : `${Number(km).toFixed(1)} km`)

export const formatDurationCompact = (mins) => {
  if (mins === null || mins === undefined) return '—'
  const total = Math.round(mins)
  const h = Math.floor(total / 60)
  const m = total % 60
  return h > 0 ? `${h}h ${m}m` : `${m}m`
}

export const formatAvgSpeedCompact = (avg) => (avg == null ? '—' : `${Number(avg).toFixed(0)} km/h`)
export const formatMaxSpeedCompact = (kmh) => (kmh == null ? '—' : `${Math.round(Number(kmh))} km/h`)

export const formatLitersFull = (value) => (value == null ? '—' : `${Number(value).toFixed(2)} L`)
export const formatLitersCompact = (value) => (value == null ? '—' : `${Number(value).toFixed(1)} L`)

export const formatFuelPriceFull = (value) => {
  if (value == null) return '—'
  const n = Number(value)
  if (!Number.isFinite(n)) return '—'
  return `${n.toLocaleString('en-US')} PKR/L`
}

export const formatFuelPriceCompact = (value) => {
  if (value == null) return '—'
  const n = Number(value)
  if (!Number.isFinite(n)) return '—'
  return `${n.toLocaleString('en-US')} Rs/L`
}

export const formatPkrFull = (value) => {
  if (value == null || value === '') return '—'
  const n = Number(value)
  if (!Number.isFinite(n)) return '—'
  return `${n.toLocaleString('en-US')} PKR`
}

export const formatPkrCompact = (value) => {
  if (value == null || value === '') return '—'
  const n = Number(value)
  if (!Number.isFinite(n)) return '—'
  return `${n.toLocaleString('en-US', { maximumFractionDigits: 0 })} PKR`
}

export const tripStatusMeta = (status) => {
  if (status === 'completed') return { label: 'Completed', tone: 'completed' }
  if (status === 'in_progress') return { label: 'Ongoing', tone: 'ongoing' }
  if (!status) return { label: 'Ongoing', tone: 'ongoing' }
  const full = String(status).replaceAll('_', ' ')
  return { label: full, tone: 'ongoing' }
}
