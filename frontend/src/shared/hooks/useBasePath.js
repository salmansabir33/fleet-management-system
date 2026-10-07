import { useLocation } from 'react-router-dom'

/** Join base (/admin, /super-admin, /manager/1) with a path segment. */
export function withBase(base, path) {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`
  const normalizedBase = String(base || '').replace(/\/$/, '')
  return `${normalizedBase}${normalizedPath}`
}

/** Derive shell base path from the current URL. */
export function resolveBasePath(pathname) {
  if (!pathname) return '/admin'
  if (pathname.startsWith('/manager/')) {
    const parts = pathname.split('/').filter(Boolean)
    if (parts.length >= 2) return `/manager/${parts[1]}`
  }
  if (pathname.startsWith('/super-admin')) return '/super-admin'
  if (pathname.startsWith('/admin')) return '/admin'
  return '/admin'
}

export function useBasePath() {
  const { pathname } = useLocation()
  return resolveBasePath(pathname)
}
