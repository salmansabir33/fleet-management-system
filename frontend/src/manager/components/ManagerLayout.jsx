import { useEffect, useMemo, useRef, useState } from 'react'
import { Outlet, useLocation, useNavigate, useParams } from 'react-router-dom'
import { LogOut, RefreshCw } from 'lucide-react'
import api from '../../api'
import { useAuth } from '../../auth/AuthContext'
import {
  ShellBrand,
  ShellSidebarFooter,
  ShellNavItem,
  ShellNavAction,
  ProfileMenu,
  ShellTopbar,
  ShellNotificationBell,
  ShellBottomNav,
  ShellBottomNavSheet,
  resolvePageTitle,
  useShellNav,
  useScrollVisibility,
} from '../../shared/shell'
import { IconButton } from '../../shared/components'
import {
  ALERT_TYPE_LABELS,
  isAlertTypeDisplayed,
} from '../../admin/utils/notificationDisplayPrefs'
import { userPicSrc } from '../../admin/utils/userPic'
import { ManagerScopeProvider, useManagerScope } from '../context/ManagerScopeContext'
import { usePanelScope } from '../hooks/usePanelScope'
import { managerPath } from '../utils/managerApi'
import {
  MANAGER_PREFERENCES_EVENT,
  readManagerNotificationPrefs,
} from '../utils/managerPreferences'
import {
  MANAGER_NAV_LABELS,
  buildManagerDesktopNav,
  buildManagerMobilePrimaryNav,
  buildManagerMobileMoreNav,
} from '../navItems'

const ROLE_LABEL = 'Operations Manager'
const EXPANDED_SIDEBAR_WIDTH = 248

const ManagerLayoutInner = () => {
  const location = useLocation()
  const navigate = useNavigate()
  const { logout, role, managerId: authManagerId, picUrl: authPicUrl } = useAuth()
  const { managerId } = useParams()
  const {
    managerName,
    managerPicUrl,
    permissions,
    loading: scopeLoading,
  } = useManagerScope()
  const { can } = usePanelScope()
  const [alerts, setAlerts] = useState([])
  const [displayPrefs, setDisplayPrefs] = useState({})
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
    if (role !== 'manager' || !authManagerId || !managerId) return
    if (String(authManagerId) !== String(managerId)) {
      navigate(`/manager/${authManagerId}/dashboard`, { replace: true })
    }
  }, [role, authManagerId, managerId, navigate])

  const filterByPermission = (items) => items.filter((item) => {
    if (!item.requires) return true
    if (scopeLoading) return false
    return can(item.requires)
  })

  const navItems = useMemo(() => {
    const base = `/manager/${managerId}`
    return filterByPermission(buildManagerDesktopNav(base))
  }, [managerId, scopeLoading, can])

  const mobilePrimaryNav = useMemo(() => {
    const base = `/manager/${managerId}`
    return filterByPermission(buildManagerMobilePrimaryNav(base))
  }, [managerId, scopeLoading, can])

  const mobileMoreNav = useMemo(() => {
    const base = `/manager/${managerId}`
    return filterByPermission(buildManagerMobileMoreNav(base))
  }, [managerId, scopeLoading, can])

  useEffect(() => {
    setMoreOpen(false)
  }, [location.pathname, isMobile])

  useEffect(() => {
    if (!managerId) return undefined
    if (scopeLoading) return undefined
    if (!permissions?.alerts_notifications) {
      setAlerts([])
      return undefined
    }
    let cancelled = false
    const fetchUnread = async () => {
      try {
        const res = await api.get(managerPath(managerId, '/alerts'), {
          params: { resolved: false, limit: 50 },
        })
        if (!cancelled) setAlerts(res.data || [])
      } catch {
        // No badge if this fails.
      }
    }
    fetchUnread()
    const interval = setInterval(fetchUnread, 15000)
    return () => { cancelled = true; clearInterval(interval) }
  }, [managerId, scopeLoading, permissions?.alerts_notifications])

  useEffect(() => {
    if (!managerId) return undefined
    let cancelled = false
    const applyLocal = () => {
      if (cancelled) return
      setDisplayPrefs(readManagerNotificationPrefs(managerId))
    }
    applyLocal()
    const loadRemote = async () => {
      try {
        const res = await api.get(`/api/managers/${managerId}/notification-prefs`)
        if (cancelled) return
        const prefs = res.data?.notification_prefs
        if (prefs && typeof prefs === 'object') setDisplayPrefs(prefs)
      } catch {
        applyLocal()
      }
    }
    loadRemote()
    const sync = (event) => {
      if (event?.detail?.managerId && String(event.detail.managerId) !== String(managerId)) return
      applyLocal()
    }
    window.addEventListener(MANAGER_PREFERENCES_EVENT, sync)
    window.addEventListener('storage', sync)
    return () => {
      cancelled = true
      window.removeEventListener(MANAGER_PREFERENCES_EVENT, sync)
      window.removeEventListener('storage', sync)
    }
  }, [managerId])

  const visibleAlerts = alerts.filter((alert) => isAlertTypeDisplayed(alert.alert_type, displayPrefs))

  const displayName = managerName || 'Manager'
  const avatarSrc = userPicSrc(managerPicUrl || authPicUrl)
  const settingsPath = `/manager/${managerId}/settings`
  const showLabels = expanded || isMobile
  const sidebarWidth = isMobile ? 280 : (expanded ? EXPANDED_SIDEBAR_WIDTH : 64)
  const pageTitle = /\/users\/\d+/.test(location.pathname)
    ? null
    : /\/drivers(\/|$)/.test(location.pathname)
      ? null
      : /\/vehicles\/\d+/.test(location.pathname)
        ? 'Vehicle Detail'
        : resolvePageTitle(location.pathname, [
        ...navItems,
        { to: `/manager/${managerId}/vehicles`, label: MANAGER_NAV_LABELS.vehicles },
        { to: `/manager/${managerId}/users`, label: MANAGER_NAV_LABELS.users },
        { to: `/manager/${managerId}/drivers`, label: MANAGER_NAV_LABELS.drivers },
      ])
  const isPlaybackRoute = /\/playback(\/|$)/.test(location.pathname)
  const hideRefreshOnMobile = isMobile && isPlaybackRoute

  const handleSearchSelect = (item) => {
    setSearch('')
    navigate(item.to)
  }

  const handleLogout = () => {
    try {
      localStorage.removeItem('ft.manager.lastWorkspaceId')
      localStorage.removeItem('ft.manager.lastLoginAt')
    } catch {
      // Ignore unavailable browser storage.
    }
    setSearch('')
    setBellOpen(false)
    setMoreOpen(false)
    logout('/login')
  }

  if (isMobile) {
    const moreItems = [
      ...mobileMoreNav,
      { label: 'Logout', icon: LogOut, onClick: handleLogout },
    ]
    const moreRouteActive = mobileMoreNav.some((item) => (
      location.pathname === item.to || location.pathname.startsWith(`${item.to}/`)
    ))

    return (
      <div className="ft-shell ft-shell--manager">
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
                roleLabel={ROLE_LABEL}
                avatarSrc={avatarSrc}
                settingsPath={settingsPath}
                onLogout={handleLogout}
              />
            )}
          />

          <main
            ref={contentRef}
            className="ft-shell-content"
            style={{ paddingBottom: 'calc(72px + env(safe-area-inset-bottom, 0px))' }}
          >
            <Outlet />
          </main>
        </div>

        <ShellBottomNav
          items={mobilePrimaryNav}
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
    <div className={`ft-shell ft-shell--manager${expanded && isMobile ? ' ft-shell--nav-open' : ''}`}>
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
          <ShellBrand portalLabel="Manager Portal" expanded={showLabels} />

          <nav className="ft-shell-nav" onClick={isMobile ? closeNav : undefined}>
            {navItems.map((item) => (
              <ShellNavItem
                key={item.to}
                to={item.to}
                label={item.label}
                icon={item.icon}
                expanded={showLabels}
              />
            ))}

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
            roleLabel={ROLE_LABEL}
            avatarSrc={avatarSrc}
            expanded={showLabels}
            showHelpCard={false}
            onLogout={handleLogout}
          />
        </aside>
      </div>

      <div className="ft-shell-main">
        <ShellTopbar
          expanded={expanded}
          onToggleNav={toggleExpanded}
          pageTitle={pageTitle}
          searchValue={search}
          onSearchChange={(e) => setSearch(e.target.value)}
          searchPlaceholder="Search manager pages…"
          searchItems={navItems}
          onSearchSelect={handleSearchSelect}
          onSearchClear={() => setSearch('')}
          actions={(
            <>
              {!hideRefreshOnMobile && (
                <IconButton
                  label="Refresh"
                  className="ft-shell-topbar-icon-btn"
                  onClick={() => window.location.reload()}
                >
                  <RefreshCw size={18} />
                </IconButton>
              )}

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
              roleLabel={ROLE_LABEL}
              avatarSrc={avatarSrc}
              settingsPath={settingsPath}
              onLogout={handleLogout}
            />
          )}
        />

        <main className="ft-shell-content">
          <Outlet />
        </main>
      </div>
    </div>
  )
}

const ManagerLayout = () => (
  <ManagerScopeProvider>
    <ManagerLayoutInner />
  </ManagerScopeProvider>
)

export default ManagerLayout
