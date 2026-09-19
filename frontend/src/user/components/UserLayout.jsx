import { useEffect, useMemo, useState, useCallback, useRef } from 'react'
import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import { Wrench, Settings, LogOut, RefreshCw } from 'lucide-react'
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
import { IconButton, Card, EmptyState, LoadingState } from '../../shared/components'
import { userPicSrc } from '../../admin/utils/userPic'
import { useCurrentUser } from '../context/CurrentUserContext'
import { useSelectedDevice } from '../context/SelectedDeviceContext'
import {
  ALERT_TYPE_LABELS,
  isAlertTypeDisplayed,
} from '../../admin/utils/notificationDisplayPrefs'
import {
  USER_NAV_ITEMS as NAV_ITEMS,
  USER_PAGE_TITLE_ITEMS as PAGE_TITLE_ITEMS,
  USER_MOBILE_PRIMARY_NAV,
  USER_MOBILE_MORE_NAV,
} from '../navItems'

const ROLE_LABEL = 'Vehicle Owner'
const EXPANDED_SIDEBAR_WIDTH = 248

const UserLayout = () => {
  const {
    name,
    user,
    loading: userLoading,
    can,
    notificationPrefs,
  } = useCurrentUser()
  const { logout } = useAuth()
  const { deviceId, setDeviceId, clearDeviceId } = useSelectedDevice()
  const location = useLocation()
  const navigate = useNavigate()
  const [alerts, setAlerts] = useState([])
  const [enabledTypes, setEnabledTypes] = useState(null)
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

  const visibleNavItems = useMemo(
    () => NAV_ITEMS.filter((item) => !item.requires || can(item.requires)),
    [can],
  )
  const canMaintenance = can('maintenance')
  const canAlerts = can('alerts_notifications')

  const mobilePrimaryNav = useMemo(
    () => USER_MOBILE_PRIMARY_NAV.filter((item) => !item.requires || can(item.requires)),
    [can],
  )

  const mobileMoreNav = useMemo(
    () => USER_MOBILE_MORE_NAV.filter((item) => !item.requires || can(item.requires)),
    [can],
  )

  useEffect(() => {
    setMoreOpen(false)
  }, [location.pathname, isMobile])

  useEffect(() => {
    if (!user) return
    const vehicleId = user.vehicles?.[0]?.id
    if (vehicleId != null) setDeviceId(vehicleId)
    else clearDeviceId()
  }, [user, setDeviceId, clearDeviceId])

  const handleLogout = () => {
    setMoreOpen(false)
    logout('/login')
  }

  useEffect(() => {
    if (!canAlerts) return undefined
    let cancelled = false
    const loadTypes = async () => {
      try {
        const res = await api.get('/api/settings/alert-types')
        if (cancelled) return
        const enabled = {}
        for (const row of res.data || []) {
          enabled[row.alert_type] = row.is_enabled !== false
        }
        setEnabledTypes(enabled)
      } catch {
        if (!cancelled) setEnabledTypes({})
      }
    }
    loadTypes()
    return () => { cancelled = true }
  }, [canAlerts])

  useEffect(() => {
    if (!canAlerts || !deviceId) {
      setAlerts([])
      return undefined
    }
    let cancelled = false
    const fetchUnread = async () => {
      try {
        const res = await api.get('/api/alerts', {
          params: { resolved: false, limit: 50, device_id: deviceId },
        })
        if (!cancelled) setAlerts(res.data || [])
      } catch {
        if (!cancelled) setAlerts([])
      }
    }
    fetchUnread()
    const interval = setInterval(fetchUnread, 15000)
    return () => { cancelled = true; clearInterval(interval) }
  }, [canAlerts, deviceId])

  const visibleAlerts = useMemo(
    () => alerts.filter((alert) => {
      if (enabledTypes && enabledTypes[alert.alert_type] === false) return false
      return isAlertTypeDisplayed(alert.alert_type, notificationPrefs)
    }),
    [alerts, enabledTypes, notificationPrefs],
  )

  const closeBell = useCallback(() => setBellOpen(false), [])

  const displayName = name || 'User'
  const avatarSrc = userPicSrc(user?.pic_url)
  const maintenanceActive = location.pathname.startsWith('/user/maintenance')
  const showLabels = expanded || isMobile
  const sidebarWidth = isMobile ? 280 : (expanded ? EXPANDED_SIDEBAR_WIDTH : 64)
  const pageTitle = resolvePageTitle(location.pathname, PAGE_TITLE_ITEMS)
  const isPlaybackRoute = location.pathname.startsWith('/user/playback')
  const isPlaybackReplay = isPlaybackRoute
    && new URLSearchParams(location.search).get('view') === 'replay'

  if (isMobile) {
    const moreItems = [
      ...mobileMoreNav,
      { label: 'Logout', icon: LogOut, onClick: handleLogout },
    ]
    const moreRouteActive = mobileMoreNav.some((item) => (
      location.pathname === item.to || location.pathname.startsWith(`${item.to}/`)
    ))

    return (
      <div className="ft-shell ft-shell--user">
        <div className="ft-shell-main">
          <ShellTopbar
            mobileMinimal
            scrollVisible={chromeVisible}
            actions={(
              canAlerts ? (
                <ShellNotificationBell
                  alerts={visibleAlerts}
                  alertTypeLabels={ALERT_TYPE_LABELS}
                  open={bellOpen}
                  onToggle={() => setBellOpen((open) => !open)}
                  onClose={closeBell}
                />
              ) : null
            )}
            profileMenu={(
              <ProfileMenu
                name={displayName}
                roleLabel={ROLE_LABEL}
                avatarSrc={avatarSrc}
              />
            )}
          />

          <main
            ref={contentRef}
            className="ft-shell-content"
            style={{ paddingBottom: 'calc(72px + env(safe-area-inset-bottom, 0px))' }}
          >
            {userLoading ? (
              <Card><LoadingState label="Loading user…" /></Card>
            ) : !user ? (
              <Card>
                <EmptyState
                  title="Select a user"
                  description="Pick a vehicle owner above to open the user portal. Grants and notification prefs from Settings apply to that person."
                />
              </Card>
            ) : (
              <Outlet key={user.id} />
            )}
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
    <div className={`ft-shell ft-shell--user${expanded && isMobile ? ' ft-shell--nav-open' : ''}`}>
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
          <ShellBrand portalLabel="User Portal" expanded={showLabels} />

          <nav className="ft-shell-nav" onClick={isMobile ? closeNav : undefined}>
            {visibleNavItems.map(({ requires, ...item }) => (
              <ShellNavItem key={item.to} {...item} expanded={showLabels} />
            ))}

            {canMaintenance && (
              <ShellNavItem
                to="/user/maintenance"
                label="Maintenance"
                icon={Wrench}
                expanded={showLabels}
                active={maintenanceActive}
              />
            )}

            <div className="ft-shell-nav-bottom">
              <ShellNavItem
                to="/user/settings"
                label="Settings"
                icon={Settings}
                expanded={showLabels}
              />
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
          onBack={isPlaybackReplay && !isMobile ? () => navigate('/user/playback', { replace: true }) : undefined}
          searchValue={search}
          onSearchChange={(e) => setSearch(e.target.value)}
          searchPlaceholder="Search"
          actions={(
            <>
              {!isPlaybackRoute && (
                <IconButton
                  label="Refresh"
                  className="ft-shell-topbar-icon-btn"
                  onClick={() => window.location.reload()}
                >
                  <RefreshCw size={18} />
                </IconButton>
              )}

              {canAlerts && (
                <ShellNotificationBell
                  alerts={visibleAlerts}
                  alertTypeLabels={ALERT_TYPE_LABELS}
                  open={bellOpen}
                  onToggle={() => setBellOpen((open) => !open)}
                  onClose={closeBell}
                />
              )}
            </>
          )}
          profileMenu={(
            <ProfileMenu
              name={displayName}
              roleLabel={ROLE_LABEL}
              avatarSrc={avatarSrc}
            />
          )}
        />

        <main className="ft-shell-content">
          {userLoading ? (
            <Card><LoadingState label="Loading user…" /></Card>
          ) : !user ? (
            <Card>
              <EmptyState
                title="Select a user"
                description="Pick a vehicle owner above to open the user portal. Grants and notification prefs from Settings apply to that person."
              />
            </Card>
          ) : (
            <Outlet key={user.id} />
          )}
        </main>
      </div>
    </div>
  )
}

export default UserLayout
