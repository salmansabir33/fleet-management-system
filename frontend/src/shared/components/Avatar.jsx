import { useEffect, useState } from 'react'
import { cx } from '../utils'

const SIZES = {
  sm: { box: 24, font: 10 },
  md: { box: 32, font: 12 },
  lg: { box: 40, font: 14 },
  xl: { box: 48, font: 16 },
  '2xl': { box: 80, font: 26 },
}

const initials = (name) => {
  if (!name) return '?'
  const parts = String(name).trim().split(/\s+/).filter(Boolean)
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

export function Avatar({ name, src, size = 'md', className, style }) {
  const dim = SIZES[size] || SIZES.md
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    setFailed(false)
  }, [src])

  const showPhoto = Boolean(src) && !failed

  return (
    <span
      className={cx('ft-avatar', className)}
      style={{ width: dim.box, height: dim.box, fontSize: dim.font, ...style }}
      aria-label={name}
    >
      {showPhoto ? (
        <img src={src} alt="" onError={() => setFailed(true)} />
      ) : (
        initials(name)
      )}
    </span>
  )
}
