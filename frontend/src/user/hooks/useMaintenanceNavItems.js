import { useEffect, useMemo, useState } from 'react'
import {
  buildMaintenanceNavItems,
} from '../../shared/shell/maintenanceNavItems'
import { useMaintenanceVehicleId } from './useMaintenanceVehicleId'
import {
  fetchMaintenanceStatus,
  getCachedMaintenanceStatus,
} from '../utils/maintenanceStatusCache'

// Shared by MaintenanceVehicleLayout (in-page tabs) and
// MaintenanceShellNav (Admin/Manager sidebar). Hides Baseline Setup
// only after status.has_baseline is confirmed true — while loading or
// on error the tab stays visible so a vehicle without a baseline never
// loses its setup entry.
//
// Layout may set hasBaseline after its shared status fetch; shell nav
// still hydrates from the shared status cache so we don't double-hit
// the network when both mount.
export const useMaintenanceNavItems = () => {
  const { deviceId, paths } = useMaintenanceVehicleId()
  const [hasBaseline, setHasBaseline] = useState(null)

  useEffect(() => {
    setHasBaseline(null)
  }, [deviceId])

  useEffect(() => {
    if (!deviceId) return undefined

    const cached = getCachedMaintenanceStatus(deviceId)
    if (cached) {
      setHasBaseline(Boolean(cached.has_baseline))
      return undefined
    }

    let cancelled = false
    fetchMaintenanceStatus(deviceId)
      .then((res) => {
        if (!cancelled) setHasBaseline(Boolean(res.data.has_baseline))
      })
      .catch(() => {
        if (!cancelled) setHasBaseline(null)
      })
    return () => { cancelled = true }
  }, [deviceId])

  const items = useMemo(
    () => buildMaintenanceNavItems(paths, hasBaseline === true),
    [paths, hasBaseline],
  )

  return { items, hasBaseline, setHasBaseline, deviceId, paths }
}
