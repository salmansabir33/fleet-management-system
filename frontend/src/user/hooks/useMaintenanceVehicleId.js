import { useMemo } from 'react'
import { useLocation, useParams } from 'react-router-dom'
import { useSelectedDevice } from '../context/SelectedDeviceContext'
import { usePanelScope } from '../../manager/hooks/usePanelScope'

// Resolves the vehicle the Maintenance pages should operate on.
// Admin/Manager pass :vehicleId in the URL; the User portal has no such
// param and keeps using SelectedDeviceContext. Route param always wins
// so a leftover user-picker id in localStorage cannot leak into
// Admin/Manager (same rule Playback.jsx already follows).
export const useMaintenanceVehicleId = () => {
  const { vehicleId: paramVehicleId } = useParams()
  const { deviceId: selectedDeviceId } = useSelectedDevice()
  const { basePath } = usePanelScope()
  const location = useLocation()

  const isUserShell = location.pathname.startsWith('/user')
  const deviceId = paramVehicleId || (isUserShell ? selectedDeviceId : null)

  const paths = useMemo(() => {
    if (isUserShell) {
      return {
        index: '/user/maintenance',
        baseline: '/user/maintenance/baseline',
        entry: '/user/maintenance/entry',
        report: '/user/maintenance/report',
        picker: '/user/dashboard',
      }
    }
    const root = paramVehicleId
      ? `${basePath}/maintenance/${paramVehicleId}`
      : `${basePath}/maintenance`
    return {
      index: root,
      baseline: `${root}/baseline`,
      entry: `${root}/entry`,
      report: `${root}/report`,
      picker: `${basePath}/maintenance`,
    }
  }, [isUserShell, basePath, paramVehicleId])

  return { deviceId, paths, isUserShell }
}
