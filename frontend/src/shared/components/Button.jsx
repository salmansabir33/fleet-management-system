import { cx } from '../utils'

function Spinner({ size = 14 }) {
  return <span className="ft-spinner" style={{ width: size, height: size }} />
}

export function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  disabled = false,
  type = 'button',
  className,
  style,
  children,
  ...props
}) {
  return (
    <button
      type={type}
      className={cx(
        'ft-btn',
        `ft-btn--${variant}`,
        `ft-btn--${size}`,
        loading && 'ft-btn--loading',
        className,
      )}
      style={style}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {loading && <Spinner size={size === 'sm' ? 12 : 14} />}
      {children}
    </button>
  )
}

export function IconButton({
  label,
  variant = 'ghost',
  size = 'md',
  loading = false,
  disabled = false,
  type = 'button',
  className,
  style,
  children,
  ...props
}) {
  return (
    <button
      type={type}
      aria-label={label}
      title={label}
      className={cx(
        'ft-btn',
        `ft-btn--${variant}`,
        'ft-icon-btn',
        `ft-icon-btn--${size}`,
        loading && 'ft-btn--loading',
        className,
      )}
      style={style}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {loading ? <Spinner size={14} /> : children}
    </button>
  )
}
