import { useCallback, useEffect, useMemo, useState } from 'react'
import api from '../../api'
import { EmptyState, LoadingState } from '../../shared/components'
import { MobilePageHeading } from '../../shared/shell'
import { userNavLabel } from '../navItems'
import VehicleMap from '../components/VehicleMap'
import { useSelectedDevice } from '../context/SelectedDeviceContext'
import { deriveVehicleStatus } from '../utils/vehicleStatus'

const LIVE_POLL_MS = 10000

const UserMap = () => {
  const { deviceId } = useSelectedDevice()
  const [liveItem, setLiveItem] = useState(null)
  const [loading, setLoading] = useState(true)

  const loadLive = useCallback(async () => {
    if (!deviceId) return null
    const liveRes = await api.get('/api/live', {
      params: { compact: true, db_id: deviceId },
    })
    const rows = liveRes.data.live || []
    return rows.find((v) => String(v.db_id) === String(deviceId)) || null
  }, [deviceId])

  useEffect(() => {
    if (!deviceId) {
      setLiveItem(null)
      setLoading(false)
      return undefined
    }

    let cancelled = false
    setLoading(true)

    const bootstrap = async () => {
      try {
        const match = await loadLive()
        if (!cancelled) setLiveItem(match)
      } catch (err) {
        console.error('Failed to load user map vehicle:', err)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    bootstrap()

    const interval = setInterval(async () => {
      try {
        const match = await loadLive()
        if (!cancelled) setLiveItem(match)
      } catch (err) {
        console.error('Failed to refresh user map vehicle:', err)
      }
    }, LIVE_POLL_MS)

    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [deviceId, loadLive])

  const mapVehicles = useMemo(() => {
    if (!liveItem || !deviceId) return []
    const attrs = liveItem.position?.attributes || {}
    return [{
      id: deviceId,
      name: liveItem.device?.name || 'Vehicle',
      lat: liveItem.position?.latitude,
      lon: liveItem.position?.longitude,
      status: deriveVehicleStatus(liveItem),
      speedKmh: liveItem.position?.speed_kmh,
      ignition: attrs.ignition,
      batteryLevel: attrs.batteryLevel,
      lastUpdate: liveItem.position?.fixTime || liveItem.position?.deviceTime,
      heading: liveItem.position?.course,
      vehicleType: liveItem.vehicle_type,
    }]
  }, [liveItem, deviceId])

  if (!deviceId) {
    return (
      <div className="ft-playback-fill" style={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        <MobilePageHeading inset>{userNavLabel('/user/map')}</MobilePageHeading>
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <EmptyState
            title="No vehicle assigned"
            description="This user does not have a vehicle yet."
          />
        </div>
      </div>
    )
  }

  if (loading && !liveItem) {
    return (
      <div className="ft-playback-fill" style={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        <MobilePageHeading inset>{userNavLabel('/user/map')}</MobilePageHeading>
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <LoadingState label="Loading map…" />
        </div>
      </div>
    )
  }

  if (!liveItem) {
    return (
      <div className="ft-playback-fill" style={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        <MobilePageHeading inset>{userNavLabel('/user/map')}</MobilePageHeading>
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <EmptyState title="No vehicle data" description="Live position is not available for this vehicle." />
        </div>
      </div>
    )
  }

  return (
    <div className="ft-playback-fill" style={{ minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      <MobilePageHeading inset>{userNavLabel('/user/map')}</MobilePageHeading>
      <div style={{ flex: 1, minHeight: 0 }}>
        <VehicleMap vehicles={mapVehicles} height="100%" />
      </div>
    </div>
  )
}

export default UserMap
