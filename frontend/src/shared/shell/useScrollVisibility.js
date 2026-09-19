import { useEffect, useRef, useState } from 'react'

const DEFAULT_TOP_THRESHOLD = 40

/**
 * Hide-on-scroll-down / reveal-on-scroll-up for mobile shell chrome.
 * Near the top of the scroll container, chrome stays visible.
 * Scroll listening is rAF-throttled to avoid per-event state churn.
 */
export function useScrollVisibility(
  scrollRef,
  { topThreshold = DEFAULT_TOP_THRESHOLD, enabled = true } = {},
) {
  const [visible, setVisible] = useState(true)
  const lastScrollTop = useRef(0)
  const rafId = useRef(null)
  const visibleRef = useRef(true)

  useEffect(() => {
    if (!enabled) {
      visibleRef.current = true
      setVisible(true)
      return undefined
    }

    const el = scrollRef?.current
    if (!el) return undefined

    lastScrollTop.current = el.scrollTop

    const flush = () => {
      rafId.current = null
      const scrollTop = el.scrollTop
      const prev = lastScrollTop.current
      lastScrollTop.current = scrollTop

      let next = visibleRef.current
      if (scrollTop <= topThreshold) {
        next = true
      } else if (scrollTop > prev) {
        next = false
      } else if (scrollTop < prev) {
        next = true
      }

      if (next !== visibleRef.current) {
        visibleRef.current = next
        setVisible(next)
      }
    }

    const onScroll = () => {
      if (rafId.current != null) return
      rafId.current = requestAnimationFrame(flush)
    }

    el.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      el.removeEventListener('scroll', onScroll)
      if (rafId.current != null) {
        cancelAnimationFrame(rafId.current)
        rafId.current = null
      }
    }
  }, [scrollRef, topThreshold, enabled])

  return visible
}
