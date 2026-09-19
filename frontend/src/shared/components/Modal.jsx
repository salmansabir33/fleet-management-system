import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { useTheme } from '../../theme'
import { cx } from '../utils'
import { Button, IconButton } from './Button'

function usePresence(open, durationMs = 200) {
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
    }, durationMs)
    return () => clearTimeout(timer)
  }, [open, shown, durationMs])

  return { shown, exiting }
}

export function Modal({
  open = true,
  onClose,
  title,
  children,
  footer,
  size = 'md',
  className,
}) {
  const { tokens } = useTheme()
  const { shown, exiting } = usePresence(open, 180)

  useEffect(() => {
    if (!shown) return undefined
    const onKey = (event) => {
      if (event.key === 'Escape') onClose?.()
    }
    document.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [shown, onClose])

  if (!shown) return null

  return createPortal(
    <div
      className={cx('ft-backdrop', exiting && 'ft-backdrop--out')}
      onClick={onClose}
    >
      <div
        className={cx('ft-modal', `ft-modal--${size}`, className)}
        role="dialog"
        aria-modal="true"
        aria-label={typeof title === 'string' ? title : undefined}
        onClick={(event) => event.stopPropagation()}
      >
        {(title || onClose) && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '20px 22px 0',
              gap: 12,
            }}
          >
            {title && (
              <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: tokens.text, letterSpacing: '-0.01em' }}>
                {title}
              </h3>
            )}
            {onClose && (
              <IconButton label="Close" onClick={onClose}>
                <X size={18} />
              </IconButton>
            )}
          </div>
        )}
        <div style={{ padding: '20px 22px', overflowX: 'hidden', overflowY: 'auto', minHeight: 0, flex: 1 }}>
          {children}
        </div>
        {footer && (
          <div
            style={{
              display: 'flex',
              justifyContent: 'flex-end',
              gap: 10,
              padding: '0 22px 20px',
              borderTop: `1px solid ${tokens.border}`,
              marginTop: 'auto',
              paddingTop: 16,
            }}
          >
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body,
  )
}

export function ConfirmDialog({
  open,
  title = 'Are you sure?',
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  variant = 'danger',
  loading = false,
  onConfirm,
  onCancel,
  className,
}) {
  const { tokens } = useTheme()
  return (
    <Modal
      open={open}
      onClose={onCancel}
      title={title}
      size="sm"
      className={cx('ft-confirm-dialog', className)}
      footer={(
        <>
          <Button variant="secondary" onClick={onCancel} disabled={loading}>
            {cancelLabel}
          </Button>
          <Button variant={variant} onClick={onConfirm} loading={loading}>
            {confirmLabel}
          </Button>
        </>
      )}
    >
      {message && (
        <p style={{ margin: 0, fontSize: 14, color: tokens.textSecondary, lineHeight: 1.5 }}>
          {message}
        </p>
      )}
    </Modal>
  )
}
