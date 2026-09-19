export function cx(...parts) {
  return parts.filter(Boolean).join(' ')
}

export function hexToRgba(hex, alpha) {
  if (!hex) return `rgba(0,0,0,${alpha})`
  let h = String(hex).replace('#', '').trim()
  if (h.length === 3) h = h.split('').map((c) => c + c).join('')
  const r = parseInt(h.slice(0, 2), 16)
  const g = parseInt(h.slice(2, 4), 16)
  const b = parseInt(h.slice(4, 6), 16)
  if ([r, g, b].some((n) => Number.isNaN(n))) return `rgba(0,0,0,${alpha})`
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}
