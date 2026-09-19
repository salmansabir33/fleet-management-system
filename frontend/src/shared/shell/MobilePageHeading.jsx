import { useEffect, useState } from 'react'

const MOBILE_MQ = '(max-width: 820px)'

function useIsMobile() {
  const [isMobile, setIsMobile] = useState(() => (
    typeof window !== 'undefined' ? window.matchMedia(MOBILE_MQ).matches : false
  ))

  useEffect(() => {
    const mq = window.matchMedia(MOBILE_MQ)
    const sync = () => setIsMobile(mq.matches)
    sync()
    mq.addEventListener('change', sync)
    return () => mq.removeEventListener('change', sync)
  }, [])

  return isMobile
}

/**
 * Mobile-only page title matching Drivers `.ad-title`.
 * Renders nothing on desktop (desktop titles stay in the topbar).
 */
export function MobilePageHeading({ children, inset = false }) {
  const isMobile = useIsMobile()
  if (!isMobile || children == null || children === '') return null

  return (
    <h1
      className={`ft-mobile-page-heading${inset ? ' ft-mobile-page-heading--inset' : ''}`}
    >
      {children}
    </h1>
  )
}
