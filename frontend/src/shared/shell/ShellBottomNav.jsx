import { NavLink, useLocation } from 'react-router-dom'
import { Menu } from 'lucide-react'
import { cx } from '../utils'

const MAX_PRIMARY = 5
const ICON_SIZE = 24

function isPrimaryActive(item, pathname) {
  if (item.end) return pathname === item.to
  return pathname === item.to || pathname.startsWith(`${item.to}/`)
}

export function ShellBottomNav({
  items = [],
  onMore,
  moreActive = false,
  moreExpanded,
  scrollVisible = true,
}) {
  const location = useLocation()
  const primaryItems = items.slice(0, MAX_PRIMARY)
  const sheetExpanded = moreExpanded ?? moreActive
  const slotCount = primaryItems.length + 1

  const activePrimaryIndex = primaryItems.findIndex((item) => (
    isPrimaryActive(item, location.pathname)
  ))

  // Prefer More when it is considered active (overflow route or sheet open),
  // matching existing moreActive highlighting behavior.
  const elevatedIndex = moreActive
    ? primaryItems.length
    : activePrimaryIndex

  const hasElevation = elevatedIndex >= 0

  return (
    <nav
      className={cx(
        'ft-shell-bottomnav',
        !scrollVisible && 'ft-shell-bottomnav--hidden',
      )}
      aria-label="Primary"
      aria-hidden={scrollVisible ? undefined : true}
      style={{
        '--bn-slots': slotCount,
        '--bn-active': Math.max(elevatedIndex, 0),
      }}
    >
      <div
        className={cx(
          'ft-shell-bottomnav-surface',
          !hasElevation && 'ft-shell-bottomnav-surface--solid',
        )}
        aria-hidden="true"
      >
        {hasElevation && <div className="ft-shell-bottomnav-notch" />}
      </div>

      <div className="ft-shell-bottomnav-items">
        {primaryItems.map((item, index) => {
          const Icon = item.icon
          const elevated = hasElevation && elevatedIndex === index
          return (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              title={item.label}
              aria-label={item.label}
              className={({ isActive }) => cx(
                'ft-shell-bottomnav-item',
                isActive && 'ft-shell-bottomnav-item--active',
                elevated && 'ft-shell-bottomnav-item--elevated',
              )}
            >
              <span className="ft-shell-bottomnav-icon-wrap">
                {Icon && <Icon size={ICON_SIZE} className="ft-shell-bottomnav-icon" />}
              </span>
            </NavLink>
          )
        })}
        <button
          type="button"
          className={cx(
            'ft-shell-bottomnav-item',
            moreActive && 'ft-shell-bottomnav-item--active',
            moreActive && hasElevation && 'ft-shell-bottomnav-item--elevated',
          )}
          title="More"
          aria-label="More"
          aria-expanded={sheetExpanded}
          aria-haspopup="menu"
          onClick={onMore}
        >
          <span className="ft-shell-bottomnav-icon-wrap">
            <Menu size={ICON_SIZE} className="ft-shell-bottomnav-icon" />
          </span>
        </button>
      </div>
    </nav>
  )
}
