import {
  cloneElement,
  isValidElement,
  Children,
  useEffect,
  useRef,
  useState,
} from 'react'
import { cx } from '../utils'

const DROPDOWN_MS = 140

function usePresence(open, durationMs = DROPDOWN_MS) {
  const [shown, setShown] = useState(open)
  const [exiting, setExiting] = useState(false)

  useEffect(() => {
    if (open) {
      setShown(true)
      setExiting(false)
      return undefined
    }
    if (!shown) return undefined
    setExiting(true)
    const timer = setTimeout(() => {
      setShown(false)
      setExiting(false)
    }, durationMs)
    return () => clearTimeout(timer)
  }, [open, shown, durationMs])

  return { shown, exiting }
}

export function Dropdown({ trigger, children, align = 'left', className, menuClassName }) {
  const [open, setOpen] = useState(false)
  const [entered, setEntered] = useState(false)
  const rootRef = useRef(null)
  const { shown, exiting } = usePresence(open, DROPDOWN_MS)

  useEffect(() => {
    if (!open) return undefined
    const onPointer = (event) => {
      if (rootRef.current && !rootRef.current.contains(event.target)) setOpen(false)
    }
    const onKey = (event) => {
      if (event.key !== 'Escape') return
      setOpen(false)
      const triggerEl = rootRef.current?.querySelector(
        'button, [href], [tabindex]:not([tabindex="-1"])',
      )
      triggerEl?.focus()
    }
    document.addEventListener('pointerdown', onPointer)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onPointer)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  useEffect(() => {
    if (shown && !exiting) {
      const frame = requestAnimationFrame(() => setEntered(true))
      return () => {
        cancelAnimationFrame(frame)
        setEntered(false)
      }
    }
    setEntered(false)
    return undefined
  }, [shown, exiting])

  const close = () => setOpen(false)

  const triggerNode = cloneElement(trigger, {
    onClick: (event) => {
      trigger.props.onClick?.(event)
      setOpen((value) => !value)
    },
    'aria-expanded': open,
    'aria-haspopup': 'menu',
  })

  const menu = typeof children === 'function'
    ? children(close)
    : Children.map(children, (child) => {
      if (!isValidElement(child)) return child
      return cloneElement(child, {
        onClick: (event) => {
          child.props.onClick?.(event)
          close()
        },
      })
    })

  return (
    <div ref={rootRef} className={cx('ft-dropdown', className)}>
      {triggerNode}
      {shown && (
        <div
          className={cx(
            'ft-dropdown-menu',
            `ft-dropdown-menu--${align}`,
            entered && !exiting && 'ft-dropdown-menu--open',
            exiting && 'ft-dropdown-menu--out',
            menuClassName,
          )}
          role="menu"
          aria-hidden={exiting}
        >
          {menu}
        </div>
      )}
    </div>
  )
}

export function DropdownItem({ children, onClick, danger, className, ...props }) {
  return (
    <button
      type="button"
      role="menuitem"
      className={cx('ft-dropdown-item', danger && 'ft-dropdown-item--danger', className)}
      onClick={onClick}
      {...props}
    >
      {children}
    </button>
  )
}
