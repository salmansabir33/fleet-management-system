import axios from 'axios'
import { API_BASE_URL } from '../api'
import { readActingAdminId } from './actingAdminStorage'
import { clearAuth, readAuthState, readToken } from './authStorage'

export const AUTH_UNAUTHORIZED_EVENT = 'ft:auth-unauthorized'

export const authApi = axios.create({
  baseURL: API_BASE_URL,
})

authApi.interceptors.request.use((config) => {
  const token = readToken()
  if (token) {
    config.headers.Authorization = `Bearer ${token}`
  }
  const authState = readAuthState()
  if (authState?.role === 'super_admin') {
    const actingAdminId = readActingAdminId()
    if (actingAdminId != null) {
      config.headers['X-Acting-Admin-Id'] = String(actingAdminId)
    }
  }
  return config
})

authApi.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      // Capture role before wipe so redirect can choose the right login page.
      // Only dispatch the event (single redirect path) — no separate logoutHandler.
      const role = readAuthState()?.role ?? null
      clearAuth()
      window.dispatchEvent(new CustomEvent(AUTH_UNAUTHORIZED_EVENT, { detail: { role } }))
    }
    return Promise.reject(error)
  },
)

export default authApi
