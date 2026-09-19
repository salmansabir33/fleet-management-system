import { createContext, useCallback, useContext, useEffect, useState } from 'react'

// There's no auth yet, and a "user" only ever looks at one vehicle at a
// time — so instead of every page (Dashboard/My Vehicle/Trip Routes/
// Alerts) carrying its own device picker, the vehicle is chosen once on
// the picker page (/user/vehicles) and remembered here. Persisted to
// localStorage so it survives a refresh. When real auth lands, this is
// the one place that needs to change: derive deviceId from the logged
// -in user's assigned vehicle instead of localStorage.
const STORAGE_KEY = 'fms.selectedDeviceId'

const SelectedDeviceContext = createContext({
  deviceId: null,
  setDeviceId: () => {},
  clearDeviceId: () => {},
})

export const SelectedDeviceProvider = ({ children }) => {
  const [deviceId, setDeviceIdState] = useState(() => {
    const stored = localStorage.getItem(STORAGE_KEY)
    return stored || null
  })

  useEffect(() => {
    if (deviceId) localStorage.setItem(STORAGE_KEY, deviceId)
    else localStorage.removeItem(STORAGE_KEY)
  }, [deviceId])

  const setDeviceId = useCallback((id) => {
    setDeviceIdState(id != null ? String(id) : null)
  }, [])

  const clearDeviceId = useCallback(() => setDeviceIdState(null), [])

  return (
    <SelectedDeviceContext.Provider value={{ deviceId, setDeviceId, clearDeviceId }}>
      {children}
    </SelectedDeviceContext.Provider>
  )
}

export const useSelectedDevice = () => useContext(SelectedDeviceContext)
