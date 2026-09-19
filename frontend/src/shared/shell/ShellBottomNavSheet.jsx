import { NavLink } from 'react-router-dom'
import { cx } from '../utils'

export function ShellBottomNavSheet({ open, items = [], onClose }) {
  if (!open) return null

  return (
    <>
      <button
        type="button"
        className="ft-shell-bottomnav-sheet-backdrop"
        aria-label="Close menu"
        onClick={onClose}
      />
      <div
        className="ft-shell-bottomnav-sheet"
        role="menu"
        aria-label="More"
      >
        {items.map((item) => {
          const Icon = item.icon
          const handleClick = (event) => {
            item.onClick?.(event)
            onClose?.()
          }
          const content = (
            <>
              {Icon && <Icon size={18} className="ft-shell-bottomnav-sheet-icon" />}
              <span className="ft-shell-bottomnav-sheet-label">{item.label}</span>
            </>
          )

          if (item.to) {
            return (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                role="menuitem"
                title={item.label}
                onClick={handleClick}
                className={({ isActive }) => cx(
                  'ft-shell-bottomnav-sheet-item',
                  isActive && 'ft-shell-bottomnav-sheet-item--active',
                )}
              >
                {content}
              </NavLink>
            )
          }

          return (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              title={item.label}
              className="ft-shell-bottomnav-sheet-item"
              onClick={handleClick}
            >
              {content}
            </button>
          )
        })}
      </div>
    </>
  )
}
