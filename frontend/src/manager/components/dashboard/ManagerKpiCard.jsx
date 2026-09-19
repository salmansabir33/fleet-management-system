import { Info } from 'lucide-react'
import { Skeleton } from '../../../shared/components/Feedback'

/**
 * Compact mockup KPI tile — label, info hint, large value, thin bar.
 */
export function ManagerKpiCard({
  label,
  value,
  barColor,
  progress = 0,
  hint,
  loading = false,
  interactive = false,
  onClick,
}) {
  const clickable = interactive && typeof onClick === 'function' && !loading
  const width = Math.max(0, Math.min(100, Number(progress) || 0))

  return (
    <div
      className={`ft-md-kpi${clickable ? ' ft-md-kpi--interactive' : ''}`}
      onClick={clickable ? onClick : undefined}
      role={clickable ? 'button' : undefined}
      tabIndex={clickable ? 0 : undefined}
      aria-busy={loading || undefined}
      onKeyDown={clickable ? (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          onClick(event)
        }
      } : undefined}
    >
      {loading ? (
        <>
          <Skeleton width="58%" height={11} style={{ display: 'block' }} />
          <Skeleton width="42%" height={26} style={{ display: 'block', marginTop: 10 }} />
          <Skeleton width="100%" height={4} style={{ display: 'block', marginTop: 14 }} />
        </>
      ) : (
        <>
          <div className="ft-md-kpi__head">
            <span className="ft-md-kpi__label">{label}</span>
            <span className="ft-md-kpi__info" title={hint || label}>
              <Info size={14} strokeWidth={2} aria-hidden />
            </span>
          </div>
          <div className="ft-md-kpi__value">{value}</div>
          <div className="ft-md-kpi__track" aria-hidden>
            <span
              className="ft-md-kpi__bar"
              style={{ width: `${width}%`, background: barColor }}
            />
          </div>
        </>
      )}
    </div>
  )
}

export default ManagerKpiCard
