import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import api from '../../api'
import { EmptyState, LoadingState } from '../../shared/components'
import { MobilePageHeading } from '../../shared/shell'
import { adminNavLabel } from '../navItems'
import VehicleMap from '../../user/components/VehicleMap'
import { usePanelScope } from '../../manager/hooks/usePanelScope'
import { liveToMapVehicles } from '../utils/liveToMapVehicles'

const LIVE_POLL_MS = 15000

const AdminMap = () => {
  const { apiFor } = usePanelScope()
  const [live, setLive] = useState([])
  const [loading, setLoading] = useState(true)
  const inflightRef = useRef(false)

  const loadLive = useCallback(async () => {
    if (inflightRef.current) return
    inflightRef.current = true
    try {
      const res = await api.get(apiFor('/vehicles', '/api/live'))
      setLive(res.data.live || [])
    } catch (err) {
      console.error('Failed to load live map vehicles:', err)
    } finally {
      inflightRef.current = false
      setLoading(false)
    }
  }, [apiFor])

  useEffect(() => {
    loadLive()
    const tick = () => {
      if (typeof document !== 'undefined' && document.hidden) return
      loadLive()
    }
    const interval = setInterval(tick, LIVE_POLL_MS)
    const onVisible = () => {
      if (!document.hidden) loadLive()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      clearInterval(interval)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [loadLive])

  const liveList = useMemo(() => liveToMapVehicles(live), [live])

  if (loading) {
    return (
      <div className="ft-playback-fill" style={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        <MobilePageHeading inset>{adminNavLabel('/admin/map')}</MobilePageHeading>
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <LoadingState label="Loading map…" />
        </div>
      </div>
    )
  }

  if (live.length === 0) {
    return (
      <div className="ft-playback-fill" style={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        <MobilePageHeading inset>{adminNavLabel('/admin/map')}</MobilePageHeading>
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <EmptyState title="No vehicles" description="There are no vehicles to show on the map." />
        </div>
      </div>
    )
  }

  return (
    <div className="ft-playback-fill" style={{ minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      <MobilePageHeading inset>{adminNavLabel('/admin/map')}</MobilePageHeading>
      <div style={{ flex: 1, minHeight: 0 }}>
        <VehicleMap
          vehicles={liveList}
          height="100%"
          fitAllVehicles
          showLegend={false}
          showMobileVehicleList
        />
      </div>
    </div>
  )
}

export default AdminMap
