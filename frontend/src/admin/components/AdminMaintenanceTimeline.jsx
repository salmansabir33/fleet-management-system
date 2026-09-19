const progressLabel = (item) => (
  item.progress_pct != null
    ? `${Math.round(Number(item.progress_pct) * 100)}%`
    : '—'
)

const parseDate = (value) => {
  if (!value) return null
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? null : d
}

const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate())

const fmtLong = (d) => (
  d
    ? d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    : '—'
)

const fmtShort = (d) => (
  d
    ? d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    : '—'
)

const pctAlong = (date, start, end) => {
  const span = end.getTime() - start.getTime()
  if (span <= 0) return 0.5
  const t = (date.getTime() - start.getTime()) / span
  return Math.min(0.96, Math.max(0.04, t))
}

const ServiceHistory = ({ records = [] }) => {
  const dated = records
    .map((r) => ({ ...r, date: parseDate(r.record_date) }))
    .filter((r) => r.date)
    .sort((a, b) => a.date - b.date)

  if (dated.length === 0) {
    return <p className="md-history-empty">No service visits yet.</p>
  }

  const first = dated[0]
  const latest = dated[dated.length - 1]
  const rangeStart = startOfDay(first.date)
  const today = new Date()
  const rangeEnd = latest.date < today ? today : startOfDay(latest.date)
  const latestPct = pctAlong(latest.date, rangeStart, rangeEnd) * 100
  const tipPct = Math.min(88, Math.max(12, latestPct))
  const chip = latest.is_baseline ? 'Baseline' : 'Last service'

  return (
    <div className="md-history">
      <p className="md-history-heading">Service history</p>
      <div className="md-history-track">
        <div className="md-history-line" />
        <div className="md-history-progress" style={{ width: `${latestPct}%` }} />

        {dated.map((r) => {
          const left = `${pctAlong(r.date, rangeStart, rangeEnd) * 100}%`
          const isActive = r.id === latest.id
          return (
            <div
              key={r.id}
              className={`md-history-marker${isActive ? ' md-history-marker--active' : ''}`}
              style={{ left }}
              title={fmtLong(r.date)}
            />
          )
        })}

        <div className="md-history-tip" style={{ left: `${tipPct}%` }}>
          {fmtLong(latest.date)}
        </div>
        <div className="md-history-chip" style={{ left: `${tipPct}%` }}>
          {chip}
        </div>

        <div className="md-history-ends">
          <span>{fmtShort(rangeStart)}</span>
          <span>{fmtShort(rangeEnd)}</span>
        </div>
      </div>

      <div className="md-history-footer">
        <div className="md-history-date">
          <span className="md-history-date-label">Started date</span>
          <span className="md-history-date-value">{fmtLong(first.date)}</span>
        </div>
        <div className="md-history-date">
          <span className="md-history-date-label">Last service</span>
          <span className="md-history-date-value">{fmtLong(latest.date)}</span>
        </div>
      </div>
    </div>
  )
}

const AdminMaintenanceTimeline = ({ items = [], records = [] }) => (
  <div className="md-card">
    <h3 className="md-card-title">Maintenance Timeline</h3>
    {items.length === 0 ? (
      <div className="md-empty">No maintenance items for this vehicle.</div>
    ) : (
      <div className="md-strip">
        {items.map((item, index) => {
          const active = item.status === 'overdue' || item.status === 'due_soon'
          return (
            <div
              key={item.item_id || item.key}
              className="md-strip-item"
            >
              <div className="md-strip-node">
                <span
                  className={`md-strip-dot${active ? ' md-strip-dot--active' : ''}`}
                />
                <span className="md-strip-label">{item.label}</span>
                <span className="md-strip-pct">{progressLabel(item)}</span>
              </div>
              {index < items.length - 1 && <div className="md-strip-connector" />}
            </div>
          )
        })}
      </div>
    )}
    <ServiceHistory records={records} />
  </div>
)

export default AdminMaintenanceTimeline
