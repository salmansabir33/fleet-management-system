import { PKT_OFFSET_MINUTES, pktLocalStringToUtcIso } from '../../utils/pktTime'

// Same fixed offset trick as pktTime.js — Pakistan doesn't observe DST,
// so this is safe to hard-code.
const PKT_OFFSET_MS = PKT_OFFSET_MINUTES * 60 * 1000

// A Date whose UTC getters (getUTCFullYear/Month/Date/Day) read as PKT
// wall-clock values. Only ever used to read those fields below — never
// serialized directly, since it isn't a real UTC instant.
const pktShiftedNow = () => new Date(Date.now() + PKT_OFFSET_MS)

// PKT calendar digits -> the real UTC instant they represent, as a
// 'Z'-suffixed ISO string. This is the format both /api/route
// (from_time/to_time) and /api/trips (start/end) accept — the backend's
// _parse_flexible_datetime tolerates a trailing 'Z', and Traccar's own
// /api/reports/route requires one.
const pktDigitsToUtcIso = (y, m, d, h = 0, mi = 0, s = 0, ms = 0) => {
  // JS normalizes out-of-range month/day (e.g. day 0, day -7, month -1)
  // automatically, so callers can pass "day - 7" etc. without special-casing.
  const asIfUtcMs = Date.UTC(y, m, d, h, mi, s, ms)
  return new Date(asIfUtcMs - PKT_OFFSET_MS).toISOString()
}

// Days since the most recent Monday. JS getUTCDay() is Sun=0..Sat=6;
// this remaps to Mon=0..Sun=6 so week boundaries land on Monday.
const daysSinceMonday = (jsDay) => (jsDay + 6) % 7

export const PERIOD_PRESETS = [
  { key: 'today', label: 'Today' },
  { key: 'yesterday', label: 'Yesterday' },
  { key: 'this_week', label: 'This Week' },
  { key: 'previous_week', label: 'Previous Week' },
  { key: 'this_month', label: 'This Month' },
  { key: 'previous_month', label: 'Previous Month' },
  { key: 'custom', label: 'Custom' },
]

// preset key -> { fromIso, toIso }. Not valid for 'custom' — resolve that
// from a DateRangeFilter value via customRangeToIso() below instead.
export const getPresetRange = (key) => {
  const now = pktShiftedNow()
  const y = now.getUTCFullYear()
  const m = now.getUTCMonth()
  const d = now.getUTCDate()
  const nowIso = new Date().toISOString()

  switch (key) {
    case 'today':
      return { fromIso: pktDigitsToUtcIso(y, m, d), toIso: pktDigitsToUtcIso(y, m, d + 1) }
    case 'yesterday':
      return { fromIso: pktDigitsToUtcIso(y, m, d - 1), toIso: pktDigitsToUtcIso(y, m, d) }
    case 'this_week': {
      const backToMonday = daysSinceMonday(now.getUTCDay())
      return { fromIso: pktDigitsToUtcIso(y, m, d - backToMonday), toIso: nowIso }
    }
    case 'previous_week': {
      const backToMonday = daysSinceMonday(now.getUTCDay())
      return {
        fromIso: pktDigitsToUtcIso(y, m, d - backToMonday - 7),
        toIso: pktDigitsToUtcIso(y, m, d - backToMonday),
      }
    }
    case 'this_month':
      return { fromIso: pktDigitsToUtcIso(y, m, 1), toIso: nowIso }
    case 'previous_month':
      return { fromIso: pktDigitsToUtcIso(y, m - 1, 1), toIso: pktDigitsToUtcIso(y, m, 1) }
    default:
      return { fromIso: pktDigitsToUtcIso(y, m, d), toIso: pktDigitsToUtcIso(y, m, d + 1) }
  }
}

// DateRangeFilter's value -> { fromIso, toIso }, for when the preset is 'custom'.
export const customRangeToIso = (dateFilterValue) => {
  const { mode, date, rangeStart, rangeEnd } = dateFilterValue
  if (mode === 'range') {
    return {
      fromIso: `${pktLocalStringToUtcIso(rangeStart)}Z`,
      toIso: `${pktLocalStringToUtcIso(rangeEnd)}Z`,
    }
  }
  const [y, m, d] = date.split('-').map(Number)
  return { fromIso: pktDigitsToUtcIso(y, m - 1, d), toIso: pktDigitsToUtcIso(y, m - 1, d + 1) }
}