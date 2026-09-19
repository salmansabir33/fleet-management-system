import { useCallback, useEffect, useRef, useState } from 'react'

const MOBILE_MQ = '(max-width: 820px)'

/**
 * Shared sidebar expand/collapse for portal shells.
 * Desktop: hover-expand + menu toggle.
 * Mobile: drawer overlay (no hover), closes on route change / backdrop.
 */
export function useShellNav({ pathname } = {}) {
  const [expanded, setExpanded] = useState(false)
  const [isMobile, setIsMobile] = useState(() => (
    typeof window !== 'undefined' ? window.matchMedia(MOBILE_MQ).matches : false
  ))
  const collapseTimer = useRef(null)

  useEffect(() => {
    const mq = window.matchMedia(MOBILE_MQ)
    const sync = () => setIsMobile(mq.matches)
    sync()
    mq.addEventListener('change', sync)
    return () => mq.removeEventListener('change', sync)
  }, [])

  useEffect(() => () => {
    if (collapseTimer.current) clearTimeout(collapseTimer.current)
  }, [])

  useEffect(() => {
    if (isMobile) setExpanded(false)
  }, [pathname, isMobile])

  const handleSidebarEnter = useCallback(() => {
    if (isMobile) return
    if (collapseTimer.current) {
      clearTimeout(collapseTimer.current)
      collapseTimer.current = null
    }
    setExpanded(true)
  }, [isMobile])

  const handleSidebarLeave = useCallback(() => {
    if (isMobile) return
    collapseTimer.current = setTimeout(() => setExpanded(false), 200)
  }, [isMobile])

  const toggleExpanded = useCallback(() => {
    setExpanded((value) => !value)
  }, [])

  const closeNav = useCallback(() => {
    setExpanded(false)
  }, [])

  return {
    expanded,
    isMobile,
    setExpanded,
    toggleExpanded,
    closeNav,
    handleSidebarEnter,
    handleSidebarLeave,
  }
}
