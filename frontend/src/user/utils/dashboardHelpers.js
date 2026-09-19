export const fmtNum = (value, digits = 0) => {
  if (value == null || Number.isNaN(Number(value))) return '—'
  return Number(value).toLocaleString(undefined, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })
}

export const formatSeconds = (seconds) => {
  if (seconds == null) return '—'
  const total = Math.max(0, Math.round(Number(seconds)))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  if (h > 0) return `${h}h ${m}m`
  return `${m}m`
}

export const formatDurationMin = (mins) => {
  if (mins == null) return '—'
  const total = Math.round(mins)
  const h = Math.floor(total / 60)
  const m = total % 60
  return h > 0 ? `${h}h ${m}m` : `${m}m`
}

export const fmtTime = (iso) => (
  iso ? new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—'
)

export const timeAgo = (iso) => {
  if (!iso) return '—'
  const diffMs = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diffMs / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins} min ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs} hr ago`
  return `${Math.floor(hrs / 24)} d ago`
}

export const headingLabel = (course) => {
  if (course == null || Number.isNaN(Number(course))) return '—'
  const deg = ((Number(course) % 360) + 360) % 360
  const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW']
  const idx = Math.round(deg / 45) % 8
  return `${dirs[idx]} ${Math.round(deg)}°`
}

export const tripAvgSpeed = (trip) => {
  if (trip?.distance_km == null || !trip?.duration_min || trip.duration_min <= 0) return null
  return trip.distance_km / (trip.duration_min / 60)
}

export const yesterdayIsoDate = () => {
  const d = new Date()
  d.setUTCDate(d.getUTCDate() - 1)
  return d.toISOString().slice(0, 10)
}

/** Percent change vs yesterday — returns undefined when comparison isn't meaningful. */
export const dayOverDayTrend = (today, yesterday) => {
  if (today == null || yesterday == null) return undefined
  const t = Number(today)
  const y = Number(yesterday)
  if (Number.isNaN(t) || Number.isNaN(y)) return undefined
  if (y === 0) {
    if (t === 0) return undefined
    return { direction: 'up', percent: 100, label: 'vs yesterday' }
  }
  const raw = Math.round(((t - y) / y) * 100)
  if (raw === 0) return undefined
  return {
    direction: raw > 0 ? 'up' : 'down',
    percent: Math.abs(raw),
    label: 'vs yesterday',
  }
}

export const formatBattery = (batteryLevel) => {
  if (batteryLevel == null) return '—'
  if (typeof batteryLevel === 'number' && batteryLevel <= 100) return `${batteryLevel}%`
  return `${batteryLevel} V`
}

export const idleStatusLabel = (status) => {
  if (status === 'idle') return 'ON'
  if (status === 'moving') return 'OFF'
  if (status === 'stopped') return 'Parked'
  return '—'
}
