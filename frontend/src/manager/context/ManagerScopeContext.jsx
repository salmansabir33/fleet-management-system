import { createContext, useContext, useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import api from '../../api'

// Mirrors SelectedDeviceContext / CurrentUserContext: identity comes
// from the URL (`/manager/:managerId/...`), not from login. Pages under
// ManagerLayout read managerId / permissions / workspace counts from here.
const ManagerScopeContext = createContext({
  managerId: null,
  managerName: null,
  managerPicUrl: null,
  permissions: {},
  assignedUserCount: null,
  totalVehicleCount: null,
  loading: false,
})

export { ManagerScopeContext }

export const ManagerScopeProvider = ({ children }) => {
  const { managerId } = useParams()
  const [managerName, setManagerName] = useState(null)
  const [managerPicUrl, setManagerPicUrl] = useState(null)
  const [permissions, setPermissions] = useState({})
  const [assignedUserCount, setAssignedUserCount] = useState(null)
  const [totalVehicleCount, setTotalVehicleCount] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!managerId) {
      setManagerName(null)
      setManagerPicUrl(null)
      setPermissions({})
      setAssignedUserCount(null)
      setTotalVehicleCount(null)
      setLoading(false)
      return undefined
    }

    let cancelled = false
    setLoading(true)

    const load = async () => {
      try {
        // Same existing /api/managers/:id call — also surfaces counts
        // already returned by ManagerOut (no extra request).
        const res = await api.get(`/api/managers/${managerId}`)
        if (cancelled) return
        const data = res.data || {}
        setManagerName(data.full_name || data.username || `Manager ${managerId}`)
        setManagerPicUrl(data.pic_url || null)
        setPermissions(data.permissions || {})
        setAssignedUserCount(
          data.assigned_user_count != null ? Number(data.assigned_user_count) : 0,
        )
        setTotalVehicleCount(
          data.total_vehicle_count != null ? Number(data.total_vehicle_count) : 0,
        )
      } catch (err) {
        console.error('Failed to load manager scope:', err)
        if (!cancelled) {
          setManagerName(null)
          setManagerPicUrl(null)
          setPermissions({})
          setAssignedUserCount(null)
          setTotalVehicleCount(null)
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    load()
    return () => { cancelled = true }
  }, [managerId])

  const value = {
    managerId: managerId != null ? String(managerId) : null,
    managerName,
    managerPicUrl,
    permissions,
    assignedUserCount,
    totalVehicleCount,
    loading,
  }

  return (
    <ManagerScopeContext.Provider value={value}>
      {children}
    </ManagerScopeContext.Provider>
  )
}

export const useManagerScope = () => useContext(ManagerScopeContext)
