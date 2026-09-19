import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import api from '../../api'
import { useAuth } from '../../auth/AuthContext'

const USER_BASIC_PERMISSIONS = new Set([
  'live_tracking',
  'trip_history',
  'alerts_notifications',
  'maintenance',
])

const CurrentUserContext = createContext({
  user: null,
  loading: true,
  name: 'User',
  role: 'user',
  can: () => false,
  notificationPrefs: {},
  updateNotificationPrefs: () => {},
})

export const CurrentUserProvider = ({ children }) => {
  const { userId, role: authRole, loading: authLoading } = useAuth()
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)

  const loadUser = useCallback(async (id) => {
    if (!id) {
      setUser(null)
      return
    }
    const res = await api.get(`/api/users/${id}`)
    setUser(res.data)
  }, [])

  const updateNotificationPrefs = useCallback((prefs) => {
    if (!prefs || typeof prefs !== 'object') return
    setUser((prev) => (prev ? { ...prev, notification_prefs: prefs } : prev))
  }, [])

  useEffect(() => {
    if (authLoading) return undefined
    let cancelled = false
    const boot = async () => {
      setLoading(true)
      try {
        if (authRole === 'user' || authRole === 'manager') {
          await loadUser(userId)
        } else {
          setUser(null)
        }
      } catch (err) {
        console.error('Failed to load current user:', err)
        if (!cancelled) setUser(null)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    boot()
    return () => { cancelled = true }
  }, [authLoading, authRole, userId, loadUser])

  const can = useCallback((key) => {
    if (authRole === 'admin') return true
    if (user?.permissions && key in user.permissions) {
      return Boolean(user.permissions[key])
    }
    return USER_BASIC_PERMISSIONS.has(key)
  }, [authRole, user])

  const value = useMemo(() => ({
    user,
    loading: authLoading || loading,
    name: user?.full_name || user?.username || 'User',
    role: authRole === 'manager' ? 'manager' : 'user',
    can,
    notificationPrefs: user?.notification_prefs || {},
    updateNotificationPrefs,
  }), [user, authLoading, loading, authRole, can, updateNotificationPrefs])

  return (
    <CurrentUserContext.Provider value={value}>
      {children}
    </CurrentUserContext.Provider>
  )
}

export const useCurrentUser = () => useContext(CurrentUserContext)
