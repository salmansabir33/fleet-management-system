import { pktLocalStringToUtcIso } from '../../utils/pktTime'

export const TOP_VEHICLE_PERIODS = [
  { key: 'today', label: 'Today' },
  { key: 'week', label: 'This Week' },
  { key: 'month', label: 'This Month' },
]

export const TREND_PERIODS = [
  { key: 'day', label: 'Today' },
  { key: '3days', label: 'Last 3 Days' },
  { key: 'week', label: 'Last 7 Days' },
  { key: 'month', label: 'Last 30 Days' },
  { key: 'alltime', label: 'All Time' },
]

/** Days in each trend/dashboard period (matches backend TREND_PERIOD_DAYS). */
export const TREND_PERIOD_DAYS = {
  day: 1,
  '3days': 3,
  week: 7,
  month: 30,
  alltime: 0,
}

/** PKT offset — Pakistan does not observe DST. */
const PKT_OFFSET_MS = 5 * 60 * 60 * 1000

function pktNowParts() {
  const pkt = new Date(Date.now() + PKT_OFFSET_MS)
  return {
    y: pkt.getUTCFullYear(),
    m: pkt.getUTCMonth(),
    d: pkt.getUTCDate(),
  }
}

/** Inclusive start / exclusive end as UTC ms for a dashboard period (PKT calendar). */
export function periodBoundsUtcMs(periodKey) {
  if (periodKey === 'alltime') return { startMs: null, endMs: null }

  const days = TREND_PERIOD_DAYS[periodKey] || 1
  const { y, m, d } = pktNowParts()
  const todayStartUtcMs = Date.UTC(y, m, d) - PKT_OFFSET_MS
  const endMs = todayStartUtcMs + 24 * 60 * 60 * 1000
  const startMs = todayStartUtcMs - (days - 1) * 24 * 60 * 60 * 1000
  return { startMs, endMs }
}

export function isInDashboardPeriod(iso, periodKey) {
  if (!iso) return false
  if (periodKey === 'alltime') return true
  const t = new Date(iso).getTime()
  if (Number.isNaN(t)) return false
  const { startMs, endMs } = periodBoundsUtcMs(periodKey)
  return t >= startMs && t < endMs
}

export function periodKpiLabels(periodKey) {
  if (periodKey === 'day') {
    return {
      trips: 'Trips Today',
      distance: "Today's Distance",
      fuelCost: "Today's Fuel Cost",
      alerts: 'Alerts Today',
      costSection: "Today's cost",
      glance: 'Today at a glance',
    }
  }
  return {
    trips: 'Trips',
    distance: 'Distance',
    fuelCost: 'Fuel Cost',
    alerts: 'Alerts',
    costSection: 'Cost',
    glance: 'At a glance',
  }
}

const pad = (n) => String(n).padStart(2, '0')

const localRangeParams = (start, end) => {
  const startLocal = `${start.getFullYear()}-${pad(start.getMonth() + 1)}-${pad(start.getDate())}T00:00`
  const endLocal = `${end.getFullYear()}-${pad(end.getMonth() + 1)}-${pad(end.getDate())}T23:59`
  return {
    start: pktLocalStringToUtcIso(startLocal),
    end: pktLocalStringToUtcIso(endLocal),
  }
}

/** Map dashboard period presets to /api/trips query params. */
export const periodToTripParams = (periodKey) => {
  const now = new Date()
  const todayStr = now.toISOString().split('T')[0]

  if (periodKey === 'today') {
    return { trip_date: todayStr }
  }

  const start = new Date(now)
  if (periodKey === 'week') {
    start.setDate(start.getDate() - 6)
  } else {
    start.setDate(1)
    start.setHours(0, 0, 0, 0)
  }

  return localRangeParams(start, now)
}

/** Trend chart periods — wider lookback windows for fleet analytics. */
export const trendPeriodToTripParams = (periodKey) => {
  const now = new Date()
  const todayStr = now.toISOString().split('T')[0]

  if (periodKey === 'day') {
    return { trip_date: todayStr }
  }

  const start = new Date(now)
  start.setHours(0, 0, 0, 0)

  if (periodKey === '3days') {
    start.setDate(start.getDate() - 2)
  } else if (periodKey === 'week') {
    start.setDate(start.getDate() - 6)
  } else {
    start.setDate(start.getDate() - 29)
  }

  return localRangeParams(start, now)
}

const hourLabel = (date) => date.toLocaleTimeString([], { hour: 'numeric' })

const dayLabel = (date) => date.toLocaleDateString([], { weekday: 'short', day: 'numeric' })

/** Build empty time buckets for trend aggregation. */
export const buildTrendBuckets = (periodKey) => {
  const now = new Date()

  if (periodKey === 'day') {
    const buckets = []
    for (let h = 0; h < 24; h += 1) {
      const d = new Date(now)
      d.setHours(h, 0, 0, 0)
      buckets.push({
        key: `h-${h}`,
        label: hourLabel(d),
        fuelLiters: 0,
        fuelCost: 0,
        distance: 0,
      })
    }
    return buckets
  }

  const days = periodKey === '3days' ? 3 : periodKey === 'week' ? 7 : 30
  const buckets = []
  for (let i = days - 1; i >= 0; i -= 1) {
    const d = new Date(now)
    d.setHours(0, 0, 0, 0)
    d.setDate(d.getDate() - i)
    const key = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
    buckets.push({
      key,
      label: dayLabel(d),
      fuelLiters: 0,
      fuelCost: 0,
      distance: 0,
    })
  }
  return buckets
}

/** Aggregate trip rows into chart buckets for fuel / cost / distance trends. */
export const aggregateTripsForTrend = (trips, periodKey) => {
  const buckets = buildTrendBuckets(periodKey)
  const bucketMap = new Map(buckets.map((b) => [b.key, b]))

  for (const trip of trips) {
    if (!trip.start_time) continue
    const d = new Date(trip.start_time)
    if (Number.isNaN(d.getTime())) continue

    let key
    if (periodKey === 'day') {
      key = `h-${d.getHours()}`
    } else {
      key = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
    }

    const bucket = bucketMap.get(key)
    if (!bucket) continue

    bucket.fuelLiters += Number(trip.total_fuel_liters) || 0
    bucket.fuelCost += Number(trip.fuel_cost_pkr) || 0
    bucket.distance += Number(trip.distance_km) || 0
  }

  return buckets.map((b) => ({
    label: b.label,
    fuelLiters: Math.round(b.fuelLiters * 10) / 10,
    fuelCost: Math.round(b.fuelCost),
    distance: Math.round(b.distance * 10) / 10,
  }))
}

/** Count alert severities triggered on the current UTC calendar day. */
export const summarizeAlertsToday = (alerts) => {
  const today = new Date().toISOString().slice(0, 10)
  const counts = { critical: 0, warning: 0, info: 0 }
  for (const alert of alerts) {
    if (!alert.triggered_at || !alert.triggered_at.startsWith(today)) continue
    const key = (alert.severity || '').toLowerCase()
    if (key in counts) counts[key] += 1
  }
  return {
    ...counts,
    total: counts.critical + counts.warning + counts.info,
  }
}
