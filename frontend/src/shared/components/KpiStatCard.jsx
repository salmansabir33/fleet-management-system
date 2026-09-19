import { useTheme } from '../../theme'
import { Card } from './Card'
import { Skeleton } from './Feedback'
import { Sparkline } from './Sparkline'

const TONE_TO_CHIP = {
  brand: 'blue',
  success: 'green',
  warning: 'orange',
  danger: 'red',
  info: 'blue',
}

function TrendBadge({ trend, tokens }) {
  if (!trend) return null

  const trendColor = trend.direction === 'up'
    ? tokens.trend.up
    : trend.direction === 'down'
      ? tokens.trend.down
      : tokens.trend.neutral

  const trendBg = trend.direction === 'up'
    ? `color-mix(in srgb, ${tokens.trend.up} 12%, transparent)`
    : trend.direction === 'down'
      ? `color-mix(in srgb, ${tokens.trend.down} 12%, transparent)`
      : tokens.background

  const arrow = trend.direction === 'up' ? '↑' : trend.direction === 'down' ? '↓' : ''
  const text = trend.percent != null
    ? `${arrow} ${trend.percent}%${trend.label ? ` ${trend.label}` : ''}`.trim()
    : `${arrow}${arrow ? ' ' : ''}${trend.label || ''}`.trim()

  if (!text) return null

  return (
    <span
      className="ft-kpi-trend"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        padding: '2px 8px',
        borderRadius: tokens.radius.pill,
        fontSize: 11,
        fontWeight: 700,
        color: trendColor,
        background: trendBg,
        lineHeight: 1.3,
      }}
    >
      {text}
    </span>
  )
}

/**
 * Dashboard KPI summary card — label on top, large value, optional trend / sparkline.
 * Pass `media` (e.g. a photo thumb) to replace the icon chip.
 */
export function KpiStatCard({
  icon: Icon,
  media,
  label,
  value,
  trend,
  tone = 'brand',
  iconColor,
  interactive = false,
  onClick,
  style,
  loading = false,
  sparkline,
  sparklineColor,
  progress,
  className,
  size = 'md',
}) {
  const { tokens } = useTheme()

  const chipKey = iconColor || TONE_TO_CHIP[tone] || 'blue'
  const chip = tokens.iconChip[chipKey] || tokens.iconChip.blue
  const compact = size === 'sm'

  const progressPct = progress?.max > 0
    ? Math.min(100, Math.round((progress.current / progress.max) * 100))
    : null

  return (
    <Card
      interactive={interactive}
      onClick={loading ? undefined : onClick}
      className={[
        'ft-kpi-stat',
        compact ? 'ft-kpi-stat--sm' : '',
        className,
      ].filter(Boolean).join(' ')}
      style={{ padding: compact ? '12px 12px' : '16px 18px', ...style }}
      loading={false}
      aria-busy={loading || undefined}
    >
      {loading ? (
        <div aria-hidden>
          <Skeleton width="48%" height={12} style={{ display: 'block', marginBottom: 10 }} />
          <Skeleton width="38%" height={28} style={{ display: 'block' }} />
          <Skeleton width="55%" height={12} style={{ display: 'block', marginTop: 10 }} />
        </div>
      ) : (
        <>
          <div
            className="ft-kpi-stat-head"
            style={{
              display: 'flex',
              alignItems: 'flex-start',
              justifyContent: 'space-between',
              gap: tokens.spacing.sm,
              marginBottom: compact ? 6 : tokens.spacing.sm,
            }}
          >
            <div
              className="ft-kpi-stat-label"
              style={{
                color: tokens.textMuted,
                fontWeight: 600,
                lineHeight: 1.3,
                minWidth: 0,
              }}
            >
              {label}
            </div>
            {media ? (
              <div className="ft-kpi-stat-media" aria-hidden>
                {media}
              </div>
            ) : Icon ? (
              <div
                className="ft-kpi-stat-icon"
                aria-hidden
                style={{
                  width: compact ? 28 : 34,
                  height: compact ? 28 : 34,
                  borderRadius: tokens.radius.sm,
                  background: chip.bg,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                }}
              >
                <Icon size={compact ? 14 : 17} color={chip.fg} />
              </div>
            ) : null}
          </div>

          <div
            className="ft-kpi-stat-value"
            style={{
              fontWeight: 800,
              color: tokens.text,
              lineHeight: 1.15,
              letterSpacing: '-0.02em',
            }}
          >
            {value}
          </div>

          {progressPct != null && (
            <div className="ft-kpi-stat-progress" style={{ marginTop: tokens.spacing.md }}>
              <div
                style={{
                  height: 4,
                  borderRadius: tokens.radius.pill,
                  background: tokens.background,
                  overflow: 'hidden',
                }}
              >
                <div
                  style={{
                    width: `${progressPct}%`,
                    height: '100%',
                    borderRadius: tokens.radius.pill,
                    background: tokens.primary,
                    transition: `width ${tokens.motion.normal} ${tokens.motion.easing}`,
                  }}
                />
              </div>
              {progress.label && (
                <div
                  className="ft-kpi-stat-progress-label"
                  style={{
                    fontSize: 11,
                    color: tokens.textMuted,
                    marginTop: 4,
                    fontWeight: 600,
                  }}
                >
                  {progress.label}
                </div>
              )}
            </div>
          )}

          {(trend || sparkline) && (
            <div
              className="ft-kpi-stat-foot"
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: tokens.spacing.sm,
                marginTop: tokens.spacing.md,
                minHeight: sparkline ? 36 : undefined,
              }}
            >
              <TrendBadge trend={trend} tokens={tokens} />
              {sparkline?.length > 0 && (
                <div className="ft-kpi-stat-spark" style={{ flex: 1, minWidth: 0, maxWidth: 120, marginLeft: 'auto' }}>
                  <Sparkline
                    points={sparkline}
                    color={sparklineColor || tokens.primary}
                    width={120}
                    height={32}
                  />
                </div>
              )}
            </div>
          )}
        </>
      )}
    </Card>
  )
}

export default KpiStatCard
