import { useTheme } from '../../theme'
import { cx } from '../utils'
import { Skeleton } from './Feedback'
import { KpiStatCard } from './KpiStatCard'

function CardSkeleton({ lines = 4 }) {
  return (
    <div
      aria-hidden
      style={{ display: 'flex', flexDirection: 'column', gap: 10 }}
    >
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton
          key={i}
          height={12}
          width={i === lines - 1 ? '64%' : '100%'}
        />
      ))}
    </div>
  )
}

export function Card({
  children,
  style,
  title,
  subtitle,
  right,
  badge,
  interactive = false,
  onClick,
  className,
  loading = false,
  skeleton,
  skeletonLines = 4,
  ...rest
}) {
  const { tokens } = useTheme()
  const clickable = !loading && typeof onClick === 'function'
  const isInteractive = interactive || clickable

  return (
    <div
      className={cx('ft-card', isInteractive && 'ft-card--interactive', className)}
      style={{
        padding: 18,
        cursor: clickable ? 'pointer' : undefined,
        ...style,
      }}
      onClick={clickable ? onClick : undefined}
      role={clickable ? 'button' : undefined}
      tabIndex={clickable ? 0 : undefined}
      aria-busy={loading || undefined}
      {...rest}
      onKeyDown={clickable ? (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          onClick(event)
        }
      } : undefined}
    >
      {(title || right) && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: 14,
            gap: tokens.spacing.sm,
          }}
        >
          {title && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: tokens.spacing.sm,
                minWidth: 0,
              }}
            >
              {badge != null && (
                <span
                  aria-hidden
                  style={{
                    width: 22,
                    height: 22,
                    borderRadius: '50%',
                    background: tokens.primary,
                    color: tokens.surface,
                    fontSize: 11,
                    fontWeight: 700,
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                    lineHeight: 1,
                  }}
                >
                  {badge}
                </span>
              )}
              <div style={{ minWidth: 0 }}>
                <h3
                  style={{
                    fontSize: 15,
                    fontWeight: 700,
                    color: tokens.text,
                    margin: 0,
                    lineHeight: 1.3,
                  }}
                >
                  {title}
                </h3>
                {subtitle && (
                  <p className="ft-card-subtitle">{subtitle}</p>
                )}
              </div>
            </div>
          )}
          {loading ? null : right}
        </div>
      )}
      {loading ? (skeleton || <CardSkeleton lines={skeletonLines} />) : children}
    </div>
  )
}

export function StatCard(props) {
  return <KpiStatCard {...props} />
}
