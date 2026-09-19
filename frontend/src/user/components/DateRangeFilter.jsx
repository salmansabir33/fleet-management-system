import { useEffect, useState } from 'react'
import { useTheme } from '../../theme'
import './date-range-filter.css'

// Single Date / Date & Time Range toggle, lifted from the admin
// DeviceReport page so Trip Routes and Alerts (User role) get the same
// filtering pattern instead of each inventing their own.
//
// value: { mode: 'single' | 'range', date, rangeStart, rangeEnd }
//   - date: 'YYYY-MM-DD' (single mode)
//   - rangeStart / rangeEnd: 'YYYY-MM-DDTHH:MM' PKT wall-clock strings (range mode)
// onChange(nextValue) is called with the whole updated value object.

const MOBILE_MQ = '(max-width: 900px)'

const splitDateTime = (value) => {
  if (!value || !value.includes('T')) return { datePart: value || '', timePart: '00:00' }
  const [datePart, rawTime = '00:00'] = value.split('T')
  return { datePart, timePart: rawTime.slice(0, 5) || '00:00' }
}

const joinDateTime = (datePart, timePart) => {
  if (!datePart) return ''
  return `${datePart}T${timePart || '00:00'}`
}

const DateRangeFilter = ({ value, onChange, style }) => {
  const { tokens } = useTheme()
  const { mode, date, rangeStart, rangeEnd } = value
  const [isMobile, setIsMobile] = useState(
    () => typeof window !== 'undefined' && window.matchMedia(MOBILE_MQ).matches,
  )

  useEffect(() => {
    const mq = window.matchMedia(MOBILE_MQ)
    const update = () => setIsMobile(mq.matches)
    update()
    mq.addEventListener('change', update)
    return () => mq.removeEventListener('change', update)
  }, [])

  const modeButton = (active) => ({
    padding: '7px 14px',
    borderRadius: tokens.radius.sm,
    border: 'none',
    background: active ? tokens.primary : 'transparent',
    fontSize: 13,
    fontWeight: 600,
    color: active ? '#fff' : tokens.textMuted,
    cursor: 'pointer',
    transition: tokens.motion.transitionFast,
  })

  const inputStyle = {
    ...styles.dateInput,
    borderRadius: tokens.radius.sm,
    border: `1px solid ${tokens.border}`,
    color: tokens.text,
    background: tokens.surface,
  }

  const updateRangePart = (key, part, nextPartValue) => {
    const current = key === 'rangeStart' ? rangeStart : rangeEnd
    const { datePart, timePart } = splitDateTime(current)
    const next = part === 'date'
      ? joinDateTime(nextPartValue, timePart)
      : joinDateTime(datePart, nextPartValue)
    onChange({ ...value, [key]: next })
  }

  const renderDateTimeField = (key, label) => {
    const current = key === 'rangeStart' ? rangeStart : rangeEnd

    if (!isMobile) {
      return (
        <>
          <label style={{ ...styles.dateLabel, color: tokens.textMuted }}>{label}</label>
          <input
            type="datetime-local"
            value={current}
            onChange={(e) => onChange({ ...value, [key]: e.target.value })}
            style={inputStyle}
          />
        </>
      )
    }

    const { datePart, timePart } = splitDateTime(current)
    return (
      <div className="ft-date-range-filter__field">
        <label style={{ ...styles.dateLabel, color: tokens.textMuted }}>{label}</label>
        <div className="ft-date-range-filter__parts">
          <input
            type="date"
            value={datePart}
            onChange={(e) => updateRangePart(key, 'date', e.target.value)}
            style={inputStyle}
            aria-label={`${label} date`}
          />
          <input
            type="time"
            value={timePart}
            onChange={(e) => updateRangePart(key, 'time', e.target.value)}
            style={inputStyle}
            aria-label={`${label} time`}
          />
        </div>
      </div>
    )
  }

  return (
    <div
      className={`ft-date-range-filter${isMobile ? ' ft-date-range-filter--mobile' : ''}`}
      style={{ ...styles.wrap, ...style }}
    >
      <div
        className="ft-date-range-filter__modes"
        style={{
          ...styles.modeToggle,
          background: tokens.background,
          borderRadius: tokens.radius.sm,
        }}
      >
        <button
          type="button"
          onClick={() => onChange({ ...value, mode: 'single' })}
          style={modeButton(mode === 'single')}
        >
          Single Date
        </button>
        <button
          type="button"
          onClick={() => onChange({ ...value, mode: 'range' })}
          style={modeButton(mode === 'range')}
        >
          Date &amp; Time Range
        </button>
      </div>

      {mode === 'single' ? (
        <div className="ft-date-range-filter__row" style={styles.dateRow}>
          <label style={{ ...styles.dateLabel, color: tokens.textMuted }}>Select Date:</label>
          <input
            type="date"
            value={date}
            onChange={(e) => onChange({ ...value, date: e.target.value })}
            style={inputStyle}
          />
        </div>
      ) : (
        <div className="ft-date-range-filter__row" style={styles.dateRow}>
          {renderDateTimeField('rangeStart', 'From (PKT):')}
          {renderDateTimeField('rangeEnd', 'To (PKT):')}
        </div>
      )}
    </div>
  )
}

const styles = {
  wrap: {
    display: 'flex',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 14,
    marginBottom: 16,
  },
  modeToggle: {
    display: 'flex',
    gap: 4,
    padding: 4,
  },
  dateRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    flexWrap: 'wrap',
  },
  dateLabel: {
    fontSize: 13,
    fontWeight: 600,
  },
  dateInput: {
    padding: '7px 10px',
    fontSize: 13,
  },
}

export default DateRangeFilter
