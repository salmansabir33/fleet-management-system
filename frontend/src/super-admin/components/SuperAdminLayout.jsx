import { useEffect, useRef, useState } from 'react'
import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import { LogOut, RefreshCw } from 'lucide-react'
import api from '../../api'
import { useAuth } from '../../auth/AuthContext'
import { readActingAdminId } from '../../auth/actingAdminStorage'
import { useBasePath } from '../../shared/hooks/useBasePath'
import {
  ShellBrand,
  ShellSidebarFooter,
  ShellNavItem,
  ShellNavAction,
  MaintenanceShellNav,
  ProfileMenu,
  ShellTopbar,
  ShellNotificationBell,
  ShellBottomNav,
  ShellBottomNavSheet,
  useShellNav,
  useScrollVisibility,
  resolvePageTitle,
} from '../../shared/shell'
import { IconButton } from '../../shared/components'
import { userPicSrc } from '../../admin/utils/userPic'
import ActingAdminBanner from '../../admin/components/ActingAdminBanner'
import {
  ALERT_TYPE_LABELS,
  isAlertTypeDisplayed,
  readNotificationDisplayPrefs,
  ADMIN_NOTIFICATION_PREFS_EVENT,
} from '../../admin/utils/notificationDisplayPrefs'
import {
  SUPER_ADMIN_MAIN_NAV as MAIN_NAV,
  SUPER_ADMIN_MOBILE_PRIMARY_NAV as MOBILE_PRIMARY_NAV,
  SUPER_ADMIN_MOBILE_MORE_NAV as MOBILE_MORE_NAV,
} from '../navItems'

const EXPANDED_SIDEBAR_WIDTH = 248

const SuperAdminLayout = () => {
  const location = useLocation()
  const navigate = useNavigate()
  const basePath = useBasePath()
  const { logout, picUrl, fullName, username } = useAuth()
  const actingAdminId = readActingAdminId()
  const displayName = fullName || username || 'Super Admin'
  const avatarSrc = userPicSrc(picUrl)
  const roleLabel = actingAdminId != null ? 'Super Admin (acting)' : 'Super Admin · All fleets'
  const [alerts, setAlerts] = useState([])
  const [displayPrefs, setDisplayPrefs] = useState(() => readNotificationDisplayPrefs())
  const [bellOpen, setBellOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [moreOpen, setMoreOpen] = useState(false)
  const {
    expanded,
    isMobile,
    toggleExpanded,
    closeNav,
    handleSidebarEnter,
    handleSidebarLeave,
  } = useShellNav({ pathname: location.pathname })
  const contentRef = useRef(null)
  const chromeVisible = useScrollVisibility(contentRef, { enabled: isMobile })

  useEffect(() => {
    let cancelled = false
    const fetchUnread = async () => {
      try {
        const res = await api.get('/api/alerts', { params: { resolved: false, limit: 50 } })
        if (!cancelled) setAlerts(res.data || [])
      } catch {
        // No badge if this fails.
      }
    }
    fetchUnread()
    const interval = setInterval(fetchUnread, 15000)
    return () => { cancelled = true; clearInterval(interval) }
  }, [actingAdminId])

  useEffect(() => {
    const sync = () => setDisplayPrefs(readNotificationDisplayPrefs())
    window.addEventListener(ADMIN_NOTIFICATION_PREFS_EVENT, sync)
    window.addEventListener('storage', sync)
    return () => {
      window.removeEventListener(ADMIN_NOTIFICATION_PREFS_EVENT, sync)
      window.removeEventListener('storage', sync)
    }
  }, [])

  useEffect(() => {
    setMoreOpen(false)
  }, [location.pathname, isMobile])

  const visibleAlerts = alerts.filter((alert) => isAlertTypeDisplayed(alert.alert_type, displayPrefs))
  const searchableNavItems = MAIN_NAV.filter((item) => !item.disabled)

  const handleSearchSelect = (item) => {
    setSearch('')
    navigate(item.to)
  }

  const handleLogout = () => {
    setSearch('')
    setBellOpen(false)
    setMoreOpen(false)
    logout('/admin/login')
  }

  const showLabels = expanded || isMobile
  const mapPath = `${basePath}/map`
  const escapedBase = basePath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

  const pageTitle = new RegExp(`^${escapedBase}/users/\\d+`).test(location.pathname)
    ? null
    : new RegExp(`^${escapedBase}/drivers(/|$)`).test(location.pathname)
      ? null
      : new RegExp(`^${escapedBase}/vehicles/\\d+`).test(location.pathname)
        ? 'Vehicle Detail'
        : resolvePageTitle(location.pathname, MAIN_NAV)
  const sidebarWidth = isMobile ? 280 : (expanded ? EXPANDED_SIDEBAR_WIDTH : 64)

  if (isMobile) {
    const moreItems = [
      ...MOBILE_MORE_NAV,
      { label: 'Logout', icon: LogOut, onClick: handleLogout },
    ]
    const moreRouteActive = MOBILE_MORE_NAV.some((item) => (
      location.pathname === item.to || location.pathname.startsWith(`${item.to}/`)
    ))

    return (
      <div className="ft-shell ft-shell--admin">
        <div className="ft-shell-main">
          <ShellTopbar
            mobileMinimal
            scrollVisible={chromeVisible}
            actions={(
              <ShellNotificationBell
                alerts={visibleAlerts}
                alertTypeLabels={ALERT_TYPE_LABELS}
                open={bellOpen}
                onToggle={() => setBellOpen((open) => !open)}
                onClose={() => setBellOpen(false)}
              />
            )}
            profileMenu={(
              <ProfileMenu
                name={displayName}
                roleLabel={roleLabel}
                avatarSrc={avatarSrc}
                settingsPath={`${basePath}/settings`}
                onLogout={handleLogout}
              />
            )}
          />

          <main
            ref={contentRef}
            className="ft-shell-content"
            style={{ paddingBottom: 'calc(72px + env(safe-area-inset-bottom, 0px))' }}
          >
            <ActingAdminBanner />
            <Outlet />
          </main>
        </div>

        <ShellBottomNav
          items={MOBILE_PRIMARY_NAV}
          moreActive={moreOpen || moreRouteActive}
          moreExpanded={moreOpen}
          onMore={() => setMoreOpen((open) => !open)}
          scrollVisible={chromeVisible}
        />
        <ShellBottomNavSheet
          open={moreOpen}
          items={moreItems}
          onClose={() => setMoreOpen(false)}
        />
      </div>
    )
  }

  return (
    <div className={`ft-shell ft-shell--admin${expanded && isMobile ? ' ft-shell--nav-open' : ''}`}>
      {expanded && isMobile && (
        <button
          type="button"
          className="ft-shell-backdrop"
          aria-label="Close navigation"
          onClick={closeNav}
        />
      )}

      <div className="ft-shell-rail">
        <aside
          className="ft-shell-sidebar"
          style={{
            width: sidebarWidth,
            boxShadow: expanded || isMobile ? 'var(--ft-shadow-dropdown)' : 'none',
          }}
          onMouseEnter={handleSidebarEnter}
          onMouseLeave={handleSidebarLeave}
        >
          <ShellBrand portalLabel="Super Admin" expanded={showLabels} />

          <nav className="ft-shell-nav" onClick={isMobile ? closeNav : undefined}>
            {MAIN_NAV.map((item) => {
              if (item.kind === 'maintenance') {
                return (
                  <MaintenanceShellNav
                    key={item.to}
                    pickerTo={item.to}
                    expanded={showLabels}
                  />
                )
              }

              return (
                <ShellNavItem
                  key={`${item.to}-${item.label}`}
                  to={item.to}
                  label={item.label}
                  icon={item.icon}
                  expanded={showLabels}
                  disabled={item.disabled}
                />
              )
            })}

            <div className="ft-shell-nav-bottom">
              <ShellNavAction
                label="Logout"
                icon={LogOut}
                expanded={showLabels}
                onClick={handleLogout}
              />
            </div>
          </nav>

          <ShellSidebarFooter
            name={displayName}
            roleLabel={roleLabel}
            avatarSrc={avatarSrc}
            expanded={showLabels}
            showHelpCard={false}
            onLogout={handleLogout}
          />
        </aside>
      </div>

      <div className="ft-shell-main">
        <ShellTopbar
          pageTitle={pageTitle}
          expanded={expanded}
          onToggleNav={toggleExpanded}
          onBack={location.pathname === mapPath ? () => navigate(basePath) : undefined}
          backLabel="Back to Dashboard"
          searchValue={search}
          onSearchChange={(e) => setSearch(e.target.value)}
          searchPlaceholder="Search pages…"
          searchItems={searchableNavItems}
          onSearchSelect={handleSearchSelect}
          onSearchClear={() => setSearch('')}
          actions={(
            <>
              <IconButton
                label="Refresh"
                className="ft-shell-topbar-icon-btn"
                onClick={() => window.location.reload()}
              >
                <RefreshCw size={18} />
              </IconButton>

              <ShellNotificationBell
                alerts={visibleAlerts}
                alertTypeLabels={ALERT_TYPE_LABELS}
                open={bellOpen}
                onToggle={() => setBellOpen((open) => !open)}
                onClose={() => setBellOpen(false)}
              />
            </>
          )}
          profileMenu={(
            <ProfileMenu
              name={displayName}
              roleLabel={roleLabel}
              avatarSrc={avatarSrc}
              settingsPath={`${basePath}/settings`}
              onLogout={handleLogout}
            />
          )}
        />

        <main className="ft-shell-content">
          <ActingAdminBanner />
          <Outlet />
        </main>
      </div>
    </div>
  )
}

export default SuperAdminLayout
