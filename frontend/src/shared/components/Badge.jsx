import { useTheme } from '../../theme'
import { cx, hexToRgba } from '../utils'

const FLEET_STATUS = {
  online: { label: 'Online', token: 'moving' },
  moving: { label: 'Moving', token: 'moving' },
  idle: { label: 'Idle', token: 'idle' },
  stopped: { label: 'Parked', token: 'parked' },
  parked: { label: 'Parked', token: 'parked' },
  offline: { label: 'Offline', token: 'offline' },
  active: { label: 'Active', token: 'moving' },
  in_progress: { label: 'In Progress', token: 'idle' },
  completed: { label: 'Completed', token: 'moving' },
}

const SEVERITY = {
  critical: { label: 'Critical' },
  warning: { label: 'Warning' },
  info: { label: 'Info' },
}

const MAINTENANCE = {
  ok: { label: 'OK', token: 'ok' },
  due_soon: { label: 'Due soon', token: 'dueSoon' },
  overdue: { label: 'Overdue', token: 'overdue' },
  no_baseline: { label: 'No data', token: 'noBaseline' },
  unknown: { label: 'Unknown', token: 'unknown' },
}

function Dot({ color, size = 8 }) {
  return (
    <span
      style={{
        width: size,
        height: size,
        borderRadius: '50%',
        display: 'inline-block',
        background: color,
        flexShrink: 0,
      }}
    />
  )
}

export function Badge({
  children,
  color,
  background,
  dot = false,
  pill = false,
  variant,
  className,
  style,
}) {
  const { tokens } = useTheme()
  const isPill = pill || variant === 'pill'
  const showBackground = Boolean(background) || isPill

  return (
    <span
      className={cx('ft-badge', isPill && 'ft-badge--pill', className)}
      style={{
        color,
        background: background || (isPill ? hexToRgba(color, 0.14) : 'transparent'),
        padding: showBackground && !isPill ? '3px 10px' : undefined,
        borderRadius: isPill ? undefined : (showBackground ? tokens.radius.pill : undefined),
        fontSize: showBackground && !isPill ? 12 : (isPill ? undefined : 13),
        fontWeight: showBackground && !isPill ? 700 : (isPill ? undefined : 600),
        ...style,
      }}
    >
      {dot && <Dot color={color} size={isPill ? 7 : 8} />}
      {children}
    </span>
  )
}

export function StatusBadge({ status, pill = true, connection = false }) {
  const { tokens } = useTheme()
  const resolved = connection
    ? (status != null && status !== 'offline' ? 'online' : 'offline')
    : status
  const meta = FLEET_STATUS[resolved]
  const color = meta
    ? tokens.fleetStatus[meta.token]
    : tokens.textMuted
  const background = hexToRgba(color, 0.14)
  return (
    <Badge color={color} background={background} dot pill={pill}>
      {meta?.label || resolved || 'Unknown'}
    </Badge>
  )
}

export function SeverityBadge({ severity, pill = true }) {
  const { tokens } = useTheme()
  const meta = SEVERITY[severity]
  const color = meta
    ? tokens.alertSeverity[severity]
    : tokens.textMuted
  const background = meta ? hexToRgba(color, 0.14) : tokens.background
  return (
    <Badge color={color} background={background} pill={pill}>
      {meta?.label || severity}
    </Badge>
  )
}

export function MaintenanceBadge({ status, pill = true }) {
  const { tokens } = useTheme()
  const meta = MAINTENANCE[status] || MAINTENANCE.unknown
  const color = tokens.maintenanceState[meta.token] || tokens.textMuted
  const background = hexToRgba(color, 0.14)
  return (
    <Badge color={color} background={background} dot pill={pill}>
      {meta.label}
    </Badge>
  )
}
