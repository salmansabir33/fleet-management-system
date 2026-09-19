import { NavLink } from 'react-router-dom'
import { cx } from '../utils'

export function ShellNavItem({
  to,
  label,
  icon: Icon,
  end,
  active: activeOverride,
  expanded = true,
  disabled = false,
  trailing,
  onClick,
}) {
  if (disabled) {
    return (
      <span
        className="ft-shell-nav-item ft-shell-nav-item--disabled"
        title={label}
        aria-disabled="true"
      >
        {Icon && <Icon size={18} className="ft-shell-nav-icon" />}
        {expanded && <span className="ft-shell-nav-label">{label}</span>}
        {expanded && trailing}
      </span>
    )
  }

  return (
    <NavLink
      to={to}
      end={end}
      title={label}
      onClick={onClick}
      className={({ isActive }) => cx(
        'ft-shell-nav-item',
        (activeOverride ?? isActive) && 'ft-shell-nav-item--active',
      )}
    >
      {Icon && <Icon size={18} className="ft-shell-nav-icon" />}
      {expanded && <span className="ft-shell-nav-label">{label}</span>}
      {expanded && trailing}
    </NavLink>
  )
}

export function ShellNavAction({
  label,
  icon: Icon,
  expanded = true,
  onClick,
}) {
  return (
    <button
      type="button"
      className="ft-shell-nav-item"
      title={label}
      aria-label={label}
      onClick={onClick}
    >
      {Icon && <Icon size={18} className="ft-shell-nav-icon" />}
      {expanded && <span className="ft-shell-nav-label">{label}</span>}
    </button>
  )
}

export function ShellSubNavItem({ to, label, end }) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) => cx(
        'ft-shell-subnav-item',
        isActive && 'ft-shell-subnav-item--active',
      )}
    >
      {label}
    </NavLink>
  )
}
