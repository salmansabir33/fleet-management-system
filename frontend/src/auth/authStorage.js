const TOKEN_KEY = 'ft.auth.token'
const AUTH_STATE_KEY = 'ft.auth.state'
const ACTING_ADMIN_KEYS = ['ft.actingAdminId', 'ft.actingAdminLabel']

/** sessionStorage clears on tab close; persist auth in localStorage until logout. */
const migrateFromSession = (key) => {
  try {
    if (localStorage.getItem(key) != null) return
    const fromSession = sessionStorage.getItem(key)
    if (fromSession == null) return
    localStorage.setItem(key, fromSession)
    sessionStorage.removeItem(key)
  } catch {
    // ignore
  }
}

migrateFromSession(TOKEN_KEY)
migrateFromSession(AUTH_STATE_KEY)
ACTING_ADMIN_KEYS.forEach(migrateFromSession)

export const readToken = () => {
  try {
    return localStorage.getItem(TOKEN_KEY)
  } catch {
    return null
  }
}

export const writeToken = (token) => {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token)
    else localStorage.removeItem(TOKEN_KEY)
    sessionStorage.removeItem(TOKEN_KEY)
  } catch {
    // ignore
  }
}

export const readAuthState = () => {
  try {
    const raw = localStorage.getItem(AUTH_STATE_KEY)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

export const writeAuthState = (state) => {
  try {
    if (state) localStorage.setItem(AUTH_STATE_KEY, JSON.stringify(state))
    else localStorage.removeItem(AUTH_STATE_KEY)
    sessionStorage.removeItem(AUTH_STATE_KEY)
  } catch {
    // ignore
  }
}

export const clearAuth = () => {
  writeToken(null)
  writeAuthState(null)
  try {
    for (const key of ACTING_ADMIN_KEYS) {
      localStorage.removeItem(key)
      sessionStorage.removeItem(key)
    }
  } catch {
    // ignore
  }
}
