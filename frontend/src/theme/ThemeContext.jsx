import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { applyCssVariables, buildTokens } from './buildTokens'
import {
  availableThemes,
  DEFAULT_THEME_ID,
  isValidThemeId,
} from './themes'
import { storageKeyFor, detectPortal } from './storage'

const ThemeContext = createContext(null)

const readStoredThemeId = (storageKey) => {
  try {
    const raw = window.localStorage.getItem(storageKey)
    if (isValidThemeId(raw)) return raw
  } catch {
    // private mode / blocked storage — fall through to default
  }
  return DEFAULT_THEME_ID
}

const writeStoredThemeId = (storageKey, themeId) => {
  try {
    window.localStorage.setItem(storageKey, themeId)
  } catch {
    // ignore persistence failures
  }
}

/**
 * Must sit inside BrowserRouter. Detects the active portal from the URL
 * so each of User / Admin / Manager keeps its own localStorage preference
 * under `fleettracker.theme.{portal}` (root pages use `fleettracker.theme`).
 */
export function ThemeProvider({ children }) {
  const { pathname } = useLocation()
  const portal = detectPortal(pathname)
  const storageKey = storageKeyFor(portal)

  const [themeId, setThemeIdState] = useState(() => readStoredThemeId(storageKey))

  useEffect(() => {
    setThemeIdState(readStoredThemeId(storageKey))
  }, [storageKey])

  const tokens = useMemo(() => buildTokens(themeId), [themeId])

  useEffect(() => {
    applyCssVariables(tokens)
  }, [tokens])

  const setTheme = useCallback((nextId) => {
    if (!isValidThemeId(nextId)) return
    setThemeIdState(nextId)
    writeStoredThemeId(storageKey, nextId)
  }, [storageKey])

  const value = useMemo(() => ({
    themeId,
    setTheme,
    availableThemes,
    tokens,
    portal,
  }), [themeId, setTheme, tokens, portal])

  return (
    <ThemeContext.Provider value={value}>
      {children}
    </ThemeContext.Provider>
  )
}

export function useTheme() {
  const ctx = useContext(ThemeContext)
  if (!ctx) {
    throw new Error('useTheme() must be used within a ThemeProvider')
  }
  return ctx
}
