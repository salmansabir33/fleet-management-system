import { EmptyState } from '../../shared/components'

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

const barColor = (status) => {
  if (status === 'overdue') return 'var(--ft-maint-overdue)'
  if (status === 'due_soon') return 'var(--ft-maint-due-soon)'
  if (status === 'ok') return 'var(--ft-primary)'
  return 'var(--ft-text-disabled)'
}

export default function MaintenanceGantt({ items = [] }) {
  if (!items.length) {
    return (
      <EmptyState
        title="No scheduled items yet"
        description="Add baseline maintenance to see the calendar timeline."
        style={{ padding: '16px 0' }}
      />
    )
  }

  return (
    <div className="ft-gantt">
      <div className="ft-gantt-head">
        <span />
        {WEEKDAYS.map((day) => (
          <span key={day} className="ft-gantt-day">{day}</span>
        ))}
      </div>
      {items.map((item) => {
        const pct = item.progress_pct == null ? 0.2 : Math.min(1, Math.max(0.08, Number(item.progress_pct)))
        const span = Math.max(1, Math.min(7, Math.round(pct * 7)))
        return (
          <div key={item.item_id || item.key} className="ft-gantt-row">
            <span className="ft-gantt-label" title={item.label}>{item.label}</span>
            <div className="ft-gantt-track">
              <div
                className="ft-gantt-bar"
                style={{
                  gridColumn: `1 / span ${span}`,
                  background: barColor(item.status),
                  opacity: item.status === 'no_baseline' ? 0.45 : 0.9,
                }}
              />
            </div>
          </div>
        )
      })}
    </div>
  )
}
