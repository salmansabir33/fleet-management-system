import { useRef, useState } from 'react'

export function Tooltip({ content, children, delay = 280 }) {
  const [open, setOpen] = useState(false)
  const timer = useRef(null)

  const show = () => {
    clearTimeout(timer.current)
    timer.current = setTimeout(() => setOpen(true), delay)
  }
  const hide = () => {
    clearTimeout(timer.current)
    setOpen(false)
  }

  if (!content) return children

  return (
    <span
      className="ft-tooltip-wrap"
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
    >
      {children}
      {open && (
        <span className="ft-tooltip" role="tooltip">{content}</span>
      )}
    </span>
  )
}
