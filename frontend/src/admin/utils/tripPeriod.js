import { pktLocalStringToUtcIso, utcDateToPktLocalString } from '../../utils/pktTime'

export const TRIP_PERIODS = [
  { key: 'all', label: 'All' },
  { key: 'daily', label: 'Daily' },
  { key: '3days', label: '3 days' },
  { key: 'weekly', label: 'Weekly' },
  { key: 'previous_week', label: 'Previous week' },
  { key: 'current_month', label: 'Current month' },
  { key: 'last_month', label: 'Last month' },
]

const pad = (n) => String(n).padStart(2, '0')

const pktTodayUtcDate = () => {
  const [year, month, day] = utcDateToPktLocalString(new Date()).slice(0, 10).split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, day))
}

const addUtcDays = (date, days) => {
  const next = new Date(date)
  next.setUTCDate(next.getUTCDate() + days)
  return next
}

const ymd = (date) => ({
  y: date.getUTCFullYear(),
  m: date.getUTCMonth() + 1,
  d: date.getUTCDate(),
})

const mondayOf = (date) => addUtcDays(date, -((date.getUTCDay() + 6) % 7))

const monthStart = (date) => new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1))

const rangeParams = (startDate, endExclusiveDate) => {
  const start = ymd(startDate)
  const end = ymd(endExclusiveDate)
  return {
    start: pktLocalStringToUtcIso(`${start.y}-${pad(start.m)}-${pad(start.d)}T00:00`),
    end: pktLocalStringToUtcIso(`${end.y}-${pad(end.m)}-${pad(end.d)}T00:00`),
  }
}

/** Map admin trip period presets to /api/trips query params (PKT calendar). */
export const tripPeriodToParams = (periodKey) => {
  if (!periodKey || periodKey === 'all') return {}

  const today = pktTodayUtcDate()
  const tomorrow = addUtcDays(today, 1)
  const thisMonday = mondayOf(today)
  const thisMonth = monthStart(today)

  if (periodKey === 'daily') return rangeParams(today, tomorrow)
  if (periodKey === '3days') return rangeParams(addUtcDays(today, -2), tomorrow)
  if (periodKey === 'weekly') return rangeParams(thisMonday, addUtcDays(thisMonday, 7))
  if (periodKey === 'previous_week') return rangeParams(addUtcDays(thisMonday, -7), thisMonday)
  if (periodKey === 'current_month') {
    const nextMonth = new Date(Date.UTC(thisMonth.getUTCFullYear(), thisMonth.getUTCMonth() + 1, 1))
    return rangeParams(thisMonth, nextMonth)
  }
  if (periodKey === 'last_month') {
    const prevMonth = new Date(Date.UTC(thisMonth.getUTCFullYear(), thisMonth.getUTCMonth() - 1, 1))
    return rangeParams(prevMonth, thisMonth)
  }
  return {}
}
