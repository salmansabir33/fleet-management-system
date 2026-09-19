import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Bell } from 'lucide-react'
import { IconButton } from '../components'

const MOBILE_MQ = '(max-width: 820px)'

const timeAgo = (iso) => {
  if (!iso) return ''
  const diffMs = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diffMs / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins} min ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs} hr ago`
  return `${Math.floor(hrs / 24)} d ago`
}

const readIsMobile = () => (
  typeof window !== 'undefined' && window.matchMedia(MOBILE_MQ).matches
)

export function ShellNotificationBell({
  alerts = [],
  alertTypeLabels = {},
  open,
  onToggle,
  onClose,
}) {
  const bellRef = useRef(null)
  const panelRef = useRef(null)
  const [isMobile, setIsMobile] = useState(readIsMobile)
  const [panelTop, setPanelTop] = useState('64px')

  useEffect(() => {
    const media = window.matchMedia(MOBILE_MQ)
    const sync = () => setIsMobile(media.matches)
    sync()
    media.addEventListener('change', sync)
    return () => media.removeEventListener('change', sync)
  }, [])

  useLayoutEffect(() => {
    if (!open || !isMobile || !bellRef.current) return undefined

    const placePanel = () => {
      const rect = bellRef.current.getBoundingClientRect()
      const top = Math.min(rect.bottom + 10, window.innerHeight - 120)
      setPanelTop(`${Math.round(top)}px`)
    }

    placePanel()
    window.addEventListener('resize', placePanel)
    window.addEventListener('scroll', placePanel, true)
    return () => {
      window.removeEventListener('resize', placePanel)
      window.removeEventListener('scroll', placePanel, true)
    }
  }, [open, isMobile])

  useEffect(() => {
    if (!open) return undefined
    const onPointerDown = (event) => {
      const target = event.target
      const inBell = bellRef.current?.contains(target)
      const inPanel = panelRef.current?.contains(target)
      if (!inBell && !inPanel) onClose?.()
    }
    const onKeyDown = (event) => {
      if (event.key === 'Escape') onClose?.()
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open, onClose])

  const unreadCount = alerts.length

  const panel = open ? (
    <>
      {isMobile && (
        <button
          type="button"
          className="ft-shell-bell-scrim"
          aria-label="Close notifications"
          onClick={onClose}
        />
      )}
      <div
        ref={panelRef}
        className={`ft-shell-bell-dropdown${isMobile ? ' ft-shell-bell-dropdown--mobile' : ''}`}
        style={isMobile ? { top: panelTop } : undefined}
        role="dialog"
        aria-label="Notifications"
      >
        <div className="ft-shell-bell-header">
          <span>Notifications</span>
          {unreadCount > 0 && (
            <span className="ft-shell-bell-header-count">{unreadCount}</span>
          )}
        </div>
        {alerts.length === 0 ? (
          <div className="ft-shell-bell-empty">No alerts to show.</div>
        ) : (
          <div className="ft-shell-bell-list">
            {alerts.map((alert) => (
              <div key={alert.id} className="ft-shell-bell-item">
                <div className="ft-shell-bell-item-type">
                  {alertTypeLabels[alert.alert_type] || alert.alert_type}
                </div>
                <div className="ft-shell-bell-item-message">{alert.message}</div>
                <div className="ft-shell-bell-item-meta">
                  {alert.device_name || 'Unknown device'}
                  {alert.triggered_at ? ` · ${timeAgo(alert.triggered_at)}` : ''}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  ) : null

  return (
    <div className="ft-shell-icon-wrap" ref={bellRef}>
      <IconButton
        label="Notifications"
        className="ft-shell-topbar-icon-btn"
        onClick={onToggle}
      >
        <Bell size={18} />
      </IconButton>
      {unreadCount > 0 && (
        <span className="ft-shell-count-badge">
          {unreadCount > 99 ? '99+' : unreadCount}
        </span>
      )}
      {open && (isMobile ? createPortal(panel, document.body) : panel)}
    </div>
  )
}
