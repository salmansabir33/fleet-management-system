const TOKEN_KEY = 'ft.auth.token'
const AUTH_STATE_KEY = 'ft.auth.state'

export const readToken = () => {
  try {
    return sessionStorage.getItem(TOKEN_KEY)
  } catch {
    return null
  }
}

export const writeToken = (token) => {
  try {
    if (token) sessionStorage.setItem(TOKEN_KEY, token)
    else sessionStorage.removeItem(TOKEN_KEY)
  } catch {
    // ignore
  }
}

export const readAuthState = () => {
  try {
    const raw = sessionStorage.getItem(AUTH_STATE_KEY)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

export const writeAuthState = (state) => {
  try {
    if (state) sessionStorage.setItem(AUTH_STATE_KEY, JSON.stringify(state))
    else sessionStorage.removeItem(AUTH_STATE_KEY)
  } catch {
    // ignore
  }
}

export const clearAuth = () => {
  writeToken(null)
  writeAuthState(null)
  try {
    sessionStorage.removeItem('ft.actingAdminId')
    sessionStorage.removeItem('ft.actingAdminLabel')
  } catch {
    // ignore
  }
}
