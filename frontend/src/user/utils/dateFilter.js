import { pktLocalStringToUtcIso, defaultPktDateTimeLocal } from '../../utils/pktTime'

// Default DateRangeFilter value: today (single date), last 24h (range).
export const defaultDateFilterValue = () => ({
  mode: 'single',
  date: new Date().toISOString().split('T')[0],
  rangeStart: defaultPktDateTimeLocal(24),
  rangeEnd: defaultPktDateTimeLocal(0),
})

// Turns a DateRangeFilter value into the query params a backend endpoint
// expects. singleParamName lets callers match whatever the endpoint
// calls its single-date param (e.g. 'date' vs 'trip_date').
export const dateFilterToParams = (value, singleParamName = 'date') => {
  if (value.mode === 'range') {
    return {
      start: pktLocalStringToUtcIso(value.rangeStart),
      end: pktLocalStringToUtcIso(value.rangeEnd),
    }
  }
  return { [singleParamName]: value.date }
}
