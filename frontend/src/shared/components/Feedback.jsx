import { Inbox, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTheme } from '../../theme'
import { cx, hexToRgba } from '../utils'
import { IconButton } from './Button'

export function EmptyState({ icon: Icon = Inbox, title, description, action, className, style }) {
  return (
    <div className={cx('ft-empty', className)} style={style}>
      <Icon size={28} color="var(--ft-text-disabled)" />
      {title && <h3 className="ft-empty-title">{title}</h3>}
      {description && <p className="ft-empty-desc">{description}</p>}
      {action}
    </div>
  )
}

export function LoadingState({ label = 'Loading…', className, style }) {
  return (
    <div className={cx('ft-loading', className)} style={style}>
      <span
        className="ft-spinner"
        style={{
          width: 20,
          height: 20,
          borderColor: 'var(--ft-text-muted)',
          borderRightColor: 'transparent',
        }}
      />
      <div>{label}</div>
    </div>
  )
}

export function Skeleton({ width = '100%', height = 12, circle = false, className, style }) {
  return (
    <span
      className={cx('ft-skeleton', className)}
      aria-hidden
      style={{
        width,
        height,
        borderRadius: circle ? 999 : undefined,
        background: 'var(--ft-surface-hover)',
        ...style,
      }}
    />
  )
}

export function Toast({
  open = true,
  variant = 'info',
  children,
  onClose,
  duration = 3200,
}) {
  const { tokens } = useTheme()
  const [shown, setShown] = useState(open)
  const [exiting, setExiting] = useState(false)

  useEffect(() => {
    if (open) {
      setShown(true)
      setExiting(false)
      return undefined
    }
    if (!shown) return undefined
    setExiting(true)
    const timer = setTimeout(() => {
      setShown(false)
      setExiting(false)
    }, 160)
    return () => clearTimeout(timer)
  }, [open, shown])

  useEffect(() => {
    if (!open || !duration) return undefined
    const timer = setTimeout(() => onClose?.(), duration)
    return () => clearTimeout(timer)
  }, [open, duration, onClose])

  if (!shown) return null

  const color = tokens.semantic[variant] || tokens.semantic.info

  return createPortal(
    <div className="ft-toast-stack">
      <div
        className={cx('ft-toast', exiting && 'ft-toast--out')}
        role="status"
        style={{
          borderLeft: `3px solid ${color}`,
          background: hexToRgba(color, 0.08),
        }}
      >
        <div style={{ flex: 1, fontSize: 13, fontWeight: 600, color: tokens.text }}>
          {children}
        </div>
        {onClose && (
          <IconButton label="Dismiss" size="sm" onClick={onClose}>
            <X size={14} />
          </IconButton>
        )}
      </div>
    </div>,
    document.body,
  )
}
