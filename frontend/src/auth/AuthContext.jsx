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
import { clearAllScopedCaches } from '../shared/clearScopedCaches'
import { ACTING_ADMIN_CHANGED_EVENT } from './actingAdminEvents'

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
  if (role === 'super_admin') return '/super-admin/dashboard'
  if (role === 'admin') return '/admin/dashboard'
  if (role === 'manager' && managerId) return `/manager/${managerId}/dashboard`
  return '/user/dashboard'
}

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
    clearAllScopedCaches()
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
    const dest = routeForRole(res.data.role, res.data.manager_id)
    navigate(dest, { replace: true })
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

  // No proactive /api/auth/refresh timer. Session persistence is localStorage
  // + long-lived JWT (JWT_EXPIRE_MINUTES). A refresh scheduler previously
  // hammered the API when multiple tabs re-armed after each renew.

  useEffect(() => {
    const onActingAdminChanged = () => clearAllScopedCaches()
    window.addEventListener(ACTING_ADMIN_CHANGED_EVENT, onActingAdminChanged)
    return () => window.removeEventListener(ACTING_ADMIN_CHANGED_EVENT, onActingAdminChanged)
  }, [])

  useEffect(() => {
    const onUnauthorized = (event) => {
      // Role is captured by the axios interceptor before clearAuth().
      const role = event?.detail?.role ?? null
      clearAuth()
      applySession(null)
      navigate(role === 'admin' || role === 'super_admin' ? '/admin/login' : '/login', { replace: true })
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
