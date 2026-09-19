import axios from 'axios'
import { clearAuth, readAuthState, readToken } from './auth/authStorage'

const resolveApiBaseUrl = () => {
  if (typeof window === 'undefined') return 'http://localhost:8000'
  const { hostname } = window.location
  if (hostname === 'localhost' || hostname === '127.0.0.1') {
    return 'http://localhost:8000'
  }
  // Phone / LAN: same origin, Vite proxies /api and /uploads to the backend.
  return ''
}

export const API_BASE_URL = resolveApiBaseUrl()

const api = axios.create({
  baseURL: API_BASE_URL,
})

api.interceptors.request.use((config) => {
  const token = readToken()
  if (token) {
    config.headers.Authorization = `Bearer ${token}`
  }
  return config
})

api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      // Capture role before wipe so redirect can choose the right login page.
      const role = readAuthState()?.role ?? null
      clearAuth()
      window.dispatchEvent(new CustomEvent('ft:auth-unauthorized', { detail: { role } }))
    }
    return Promise.reject(error)
  },
)

export default api
