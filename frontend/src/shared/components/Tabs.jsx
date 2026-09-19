import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { cx } from '../utils'

export function Tabs({ items, value, onChange, className, style }) {
  const listRef = useRef(null)
  const [indicator, setIndicator] = useState({ left: 4, width: 0 })

  useLayoutEffect(() => {
    const list = listRef.current
    if (!list) return
    const active = list.querySelector('[data-active="true"]')
    if (!active) return
    setIndicator({
      left: active.offsetLeft,
      width: active.offsetWidth,
    })
  }, [value, items])

  useEffect(() => {
    const list = listRef.current
    if (!list) return undefined
    const onResize = () => {
      const active = list.querySelector('[data-active="true"]')
      if (!active) return
      setIndicator({ left: active.offsetLeft, width: active.offsetWidth })
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [value])

  return (
    <div ref={listRef} className={cx('ft-tabs', className)} style={style} role="tablist">
      <span
        className="ft-tabs-indicator"
        style={{ left: indicator.left, width: indicator.width }}
      />
      {items.map((item, index) => {
        const active = item.id === value
        return (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={active}
            tabIndex={active ? 0 : -1}
            data-active={active ? 'true' : 'false'}
            className={cx('ft-tab', active && 'ft-tab--active')}
            onClick={() => onChange?.(item.id)}
            onKeyDown={(event) => {
              if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return
              event.preventDefault()
              if (!items.length) return
              const delta = event.key === 'ArrowRight' ? 1 : -1
              const next = (index + delta + items.length) % items.length
              onChange?.(items[next].id)
              const tabs = listRef.current?.querySelectorAll('[role="tab"]')
              tabs?.[next]?.focus()
            }}
          >
            {item.label}
          </button>
        )
      })}
    </div>
  )
}
