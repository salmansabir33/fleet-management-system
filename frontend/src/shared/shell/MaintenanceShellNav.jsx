import { useEffect, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { Wrench, ChevronDown } from 'lucide-react'
import { ShellNavItem, ShellSubNavItem } from './ShellNavItem'
import { useMaintenanceNavItems } from '../../user/hooks/useMaintenanceNavItems'

// Collapsible Maintenance sidebar block for Admin/Manager. Parent link
// always goes to the vehicle-picker page. Once a vehicle is in the URL,
// the same destinations as the per-vehicle tab list appear here
// (Baseline Setup is omitted once that vehicle already has a baseline).
const MaintenanceShellNav = ({ pickerTo, expanded }) => {
  const location = useLocation()
  const { items, deviceId } = useMaintenanceNavItems()
  const maintenanceActive = location.pathname.includes('/maintenance')

  const [open, setOpen] = useState(Boolean(deviceId))

  useEffect(() => {
    if (maintenanceActive) setOpen(true)
  }, [maintenanceActive])

  const showSub = Boolean(deviceId)
  const subItems = showSub ? items : []

  return (
    <>
      <ShellNavItem
        to={pickerTo}
        label="Maintenance"
        icon={Wrench}
        expanded={expanded}
        active={maintenanceActive}
        onClick={(e) => {
          if (showSub && e.target.closest?.('.ft-shell-nav-chevron')) return
        }}
        trailing={showSub ? (
          <ChevronDown
            size={16}
            className={`ft-shell-nav-chevron${open ? ' ft-shell-nav-chevron--open' : ''}`}
            onClick={(e) => {
              e.preventDefault()
              e.stopPropagation()
              setOpen((prev) => !prev)
            }}
          />
        ) : null}
      />
      {showSub && (
        <div
          className={`ft-shell-subnav${expanded && open ? ' ft-shell-subnav--open' : ''}`}
        >
          <div className="ft-shell-subnav-inner">
            {subItems.map((item) => (
              <ShellSubNavItem key={item.to} {...item} />
            ))}
          </div>
        </div>
      )}
    </>
  )
}

export default MaintenanceShellNav
