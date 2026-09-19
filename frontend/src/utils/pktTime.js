// Pakistan Standard Time is a fixed UTC+5 offset year-round — Pakistan
// does not observe daylight saving — so it's safe to hard-code the
// offset instead of pulling in a timezone library.
export const PKT_OFFSET_MINUTES = 5 * 60

// Backend timestamps (fix_time, trip start/end, etc.) are naive UTC.
// These helpers convert between that and the PKT wall-clock time shown
// in the UI, so every screen agrees on one timezone.

// A UTC Date -> the PKT wall-clock string an <input type="datetime-local">
// expects, e.g. "2026-08-06T15:08".
export const utcDateToPktLocalString = (utcDate) => {
  const pktMs = utcDate.getTime() + PKT_OFFSET_MINUTES * 60 * 1000
  return new Date(pktMs).toISOString().slice(0, 16)
}

// The PKT wall-clock string from a datetime-local input, e.g.
// "2026-08-06T15:08" -> a naive-UTC ISO string the backend expects,
// e.g. "2026-08-06T10:08:00".
export const pktLocalStringToUtcIso = (pktLocalStr) => {
  // Parse the typed digits as if they were UTC (a convenient way to
  // turn "YYYY-MM-DDTHH:MM" into an epoch value without the browser's
  // own local timezone getting involved), then shift back by the fixed
  // PKT offset to get the real UTC instant.
  const asIfUtcMs = new Date(`${pktLocalStr}:00Z`).getTime()
  const utcMs = asIfUtcMs - PKT_OFFSET_MINUTES * 60 * 1000
  return new Date(utcMs).toISOString().slice(0, 19)
}

// Default datetime-local value, N hours before "now", expressed as a
// PKT wall-clock string (so the picker opens already showing local
// Pakistan time instead of UTC).
export const defaultPktDateTimeLocal = (hoursAgo) => {
  const utcNowMinusHours = new Date(Date.now() - hoursAgo * 60 * 60 * 1000)
  return utcDateToPktLocalString(utcNowMinusHours)
}