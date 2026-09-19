import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import authApi, { AUTH_UNAUTHORIZED_EVENT } from './authApi'
import {
  clearAuth,
  readAuthState,
  readToken,
  writeAuthState,
  writeToken,
} from './authStorage'

const AuthContext = createContext({
  loading: true,
  isAuthenticated: false,
  role: null,
  userId: null,
  managerId: null,
  username: null,
  fullName: null,
  picUrl: null,
  login: async () => {},
  adminLogin: async () => {},
  logout: () => {},
  refreshMe: async () => {},
})

const persistSession = (data) => {
  writeToken(data.access_token)
  writeAuthState({
    role: data.role,
    userId: data.user_id ?? null,
    managerId: data.manager_id ?? null,
    username: data.username ?? null,
    fullName: data.full_name ?? null,
    picUrl: data.pic_url ?? null,
  })
}

const routeForRole = (role, managerId) => {
  if (role === 'admin') return '/admin/dashboard'
  if (role === 'manager' && managerId) return `/manager/${managerId}/dashboard`
  return '/user/dashboard'
}

/** Read JWT exp (ms). Does not verify signature — only used for refresh scheduling. */
const getJwtExpiryMs = (token) => {
  try {
    const payloadPart = token.split('.')[1]
    if (!payloadPart) return null
    const json = atob(payloadPart.replace(/-/g, '+').replace(/_/g, '/'))
    const payload = JSON.parse(json)
    return payload?.exp ? payload.exp * 1000 : null
  } catch {
    return null
  }
}

/** Refresh 5 minutes before expiry; never sooner than 30s from now. */
const REFRESH_BEFORE_MS = 5 * 60 * 1000
const REFRESH_MIN_DELAY_MS = 30 * 1000

export const AuthProvider = ({ children }) => {
  const navigate = useNavigate()
  const [loading, setLoading] = useState(true)
  const [session, setSession] = useState(() => readAuthState())

  const applySession = useCallback((next) => {
    setSession(next)
  }, [])

  const refreshMe = useCallback(async () => {
    const token = readToken()
    if (!token) {
      applySession(null)
      return null
    }
    try {
      const res = await authApi.get('/api/auth/me')
      const data = res.data || {}
      const next = {
        role: data.role,
        userId: data.user_id ?? null,
        managerId: data.manager_id ?? null,
        username: data.username ?? null,
        fullName: data.full_name ?? null,
        picUrl: data.pic_url ?? null,
      }
      writeAuthState(next)
      applySession(next)
      return next
    } catch (err) {
      // Only wipe the session on a real 401. Network/timeout/5xx keep the
      // existing session so a transient failure does not force logout.
      if (err?.response?.status === 401) {
        clearAuth()
        applySession(null)
        return null
      }
      return readAuthState()
    }
  }, [applySession])

  const logout = useCallback((redirectTo) => {
    clearAuth()
    applySession(null)
    if (redirectTo) navigate(redirectTo, { replace: true })
  }, [applySession, navigate])

  const login = useCallback(async (username, password) => {
    const res = await authApi.post('/api/auth/login', { username, password })
    persistSession(res.data)
    applySession(readAuthState())
    const dest = routeForRole(res.data.role, res.data.manager_id)
    navigate(dest, { replace: true })
    return res.data
  }, [applySession, navigate])

  const adminLogin = useCallback(async (username, password) => {
    const res = await authApi.post('/api/auth/admin/login', { username, password })
    persistSession(res.data)
    applySession(readAuthState())
    navigate('/admin/dashboard', { replace: true })
    return res.data
  }, [applySession, navigate])

  useEffect(() => {
    let cancelled = false
    const boot = async () => {
      setLoading(true)
      await refreshMe()
      if (!cancelled) setLoading(false)
    }
    boot()
    return () => { cancelled = true }
  }, [refreshMe])

  // Silently renew the access token shortly before JWT expiry so long-lived
  // tabs are not hard-logged out at the 8-hour cutoff.
  useEffect(() => {
    if (!session) return undefined
    const token = readToken()
    if (!token) return undefined
    const expMs = getJwtExpiryMs(token)
    if (!expMs) return undefined

    const delay = Math.max(expMs - Date.now() - REFRESH_BEFORE_MS, REFRESH_MIN_DELAY_MS)
    let cancelled = false
    const timer = setTimeout(async () => {
      try {
        const res = await authApi.post('/api/auth/refresh')
        if (cancelled) return
        persistSession(res.data)
        applySession(readAuthState())
      } catch {
        // Network/5xx: keep current token. Real 401 is handled by the interceptor.
      }
    }, delay)

    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [session, applySession])

  useEffect(() => {
    const onUnauthorized = (event) => {
      // Role is captured by the axios interceptor before clearAuth().
      const role = event?.detail?.role ?? null
      clearAuth()
      applySession(null)
      navigate(role === 'admin' ? '/admin/login' : '/login', { replace: true })
    }
    window.addEventListener(AUTH_UNAUTHORIZED_EVENT, onUnauthorized)
    return () => window.removeEventListener(AUTH_UNAUTHORIZED_EVENT, onUnauthorized)
  }, [applySession, navigate])

  const value = useMemo(() => ({
    loading,
    isAuthenticated: Boolean(readToken() && session),
    role: session?.role ?? null,
    userId: session?.userId ?? null,
    managerId: session?.managerId ?? null,
    username: session?.username ?? null,
    fullName: session?.fullName ?? null,
    picUrl: session?.picUrl ?? null,
    login,
    adminLogin,
    logout,
    refreshMe,
  }), [loading, session, login, adminLogin, logout, refreshMe])

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => useContext(AuthContext)

export { routeForRole }
