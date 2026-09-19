import { useTheme } from '../../theme'
import { cx, hexToRgba } from '../utils'

export function AlertRow({
  severity = 'info',
  icon: Icon,
  title,
  subtitle,
  timestamp,
  badge,
  trailing,
  expanded = false,
  onClick,
  children,
  className,
  style,
}) {
  const { tokens } = useTheme()
  const color = tokens.alertSeverity[severity] || tokens.alertSeverity.info
  const clickable = typeof onClick === 'function'

  return (
    <div
      className={cx(
        'ft-alert-row',
        clickable && 'ft-alert-row--expandable',
        expanded && 'ft-alert-row--expanded',
        severity === 'critical' && 'ft-alert-row--critical',
        severity === 'warning' && !expanded ? 'ft-alert-row--warning' : null,
        className,
      )}
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        padding: `${tokens.spacing.md}px ${tokens.spacing.lg}px`,
        borderLeft: `4px solid ${color}`,
        background: tokens.surface,
        borderRadius: tokens.radius.md,
        ...style,
      }}
      onClick={onClick}
      role={clickable ? 'button' : undefined}
      tabIndex={clickable ? 0 : undefined}
      onKeyDown={clickable ? (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          onClick(event)
        }
      } : undefined}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: tokens.spacing.md }}>
        {Icon && (
          <div
            style={{
              width: 32,
              height: 32,
              borderRadius: '50%',
              background: hexToRgba(color, 0.14),
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            <Icon size={16} color={color} />
          </div>
        )}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              flexWrap: 'wrap',
            }}
          >
            <span
              style={{
                fontWeight: 700,
                fontSize: 13,
                color: tokens.text,
                lineHeight: 1.3,
              }}
            >
              {title}
            </span>
            {badge}
          </div>
          {subtitle && (
            <div
              style={{
                fontSize: 12,
                color: tokens.textMuted,
                marginTop: 2,
                lineHeight: 1.35,
              }}
            >
              {subtitle}
            </div>
          )}
        </div>
        {(timestamp || trailing) && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              flexShrink: 0,
            }}
          >
            {timestamp && (
              <span
                style={{
                  fontSize: 12,
                  color: tokens.textMuted,
                  whiteSpace: 'nowrap',
                  paddingTop: 1,
                }}
              >
                {timestamp}
              </span>
            )}
            {trailing}
          </div>
        )}
      </div>
      {expanded && children}
    </div>
  )
}
