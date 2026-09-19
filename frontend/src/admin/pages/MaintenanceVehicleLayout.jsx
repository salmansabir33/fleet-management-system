import { useCallback, useEffect, useMemo, useState } from 'react'
import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import { ArrowLeft, FileText, Wrench } from 'lucide-react'
import api from '../../api'
import { useMaintenanceNavItems } from '../../user/hooks/useMaintenanceNavItems'
import { useMaintenanceVehicleId } from '../../user/hooks/useMaintenanceVehicleId'
import { MAINTENANCE_NAV_LABELS } from '../../shared/shell/maintenanceNavItems'
import { usePanelScope } from '../../manager/hooks/usePanelScope'
import VehicleHeroArt from '../../user/components/VehicleHeroArt'
import { vehiclePhotoSrc } from '../../user/utils/vehiclePhoto'
import {
  fetchMaintenanceStatus,
  getCachedMaintenanceStatus,
  invalidateMaintenanceStatus,
} from '../../user/utils/maintenanceStatusCache'
import {
  fetchMaintenanceRecords,
  getCachedMaintenanceRecords,
  invalidateMaintenanceRecords,
} from '../../user/utils/maintenanceRecordsCache'
import '../styles/admin-maintenance-detail.css'

const MOBILE_MQ = '(max-width: 820px)'

const VehicleChip = ({ vehicle, deviceId }) => (
  <div className="mr-vehicle-chip">
    <VehicleHeroArt
      vehicleType={vehicle?.vehicleType}
      size="thumb"
      src={vehicle?.photo}
    />
    <div>
      <div className="mr-vehicle-chip-name">
        {vehicle?.name || `Vehicle #${deviceId}`}
      </div>
      <div className="mr-vehicle-chip-meta">
        {vehicle?.plate || 'No plate number'}
        {vehicle?.vehicleType ? ` · ${vehicle.vehicleType}` : ''}
      </div>
    </div>
  </div>
)

const MaintenanceVehicleLayout = () => {
  const navigate = useNavigate()
  const location = useLocation()
  const { items, paths, deviceId, setHasBaseline } = useMaintenanceNavItems()
  const { isUserShell } = useMaintenanceVehicleId()
  const { apiFor } = usePanelScope()

  const [vehicle, setVehicle] = useState(null)
  const [isMobile, setIsMobile] = useState(() => (
    typeof window !== 'undefined' ? window.matchMedia(MOBILE_MQ).matches : false
  ))
  const [status, setStatus] = useState(() => (
    deviceId ? getCachedMaintenanceStatus(deviceId) : null
  ))
  const [statusLoading, setStatusLoading] = useState(() => (
    Boolean(deviceId) && !getCachedMaintenanceStatus(deviceId)
  ))
  const [records, setRecords] = useState(() => {
    const cached = deviceId ? getCachedMaintenanceRecords(deviceId) : null
    return cached?.records || []
  })
  const [recordsLoading, setRecordsLoading] = useState(() => (
    Boolean(deviceId) && !getCachedMaintenanceRecords(deviceId)
  ))
  const [refreshToken, setRefreshToken] = useState(0)

  useEffect(() => {
    const mq = window.matchMedia(MOBILE_MQ)
    const sync = () => setIsMobile(mq.matches)
    sync()
    mq.addEventListener('change', sync)
    return () => mq.removeEventListener('change', sync)
  }, [])

  // Drop stale vehicle/status/records immediately when switching devices.
  useEffect(() => {
    if (!deviceId) {
      setVehicle(null)
      setStatus(null)
      setRecords([])
      setStatusLoading(false)
      setRecordsLoading(false)
      return
    }
    const cachedStatus = getCachedMaintenanceStatus(deviceId)
    const cachedRecords = getCachedMaintenanceRecords(deviceId)
    setStatus(cachedStatus)
    setRecords(cachedRecords?.records || [])
    setStatusLoading(!cachedStatus)
    setRecordsLoading(!cachedRecords)
    setVehicle(null)
  }, [deviceId])

  const loadShared = useCallback(async ({ force = false } = {}) => {
    if (!deviceId) {
      setVehicle(null)
      setStatus(null)
      setRecords([])
      setStatusLoading(false)
      setRecordsLoading(false)
      return
    }

    const hasCachedStatus = !force && getCachedMaintenanceStatus(deviceId)
    const hasCachedRecords = !force && getCachedMaintenanceRecords(deviceId)
    if (!hasCachedStatus) setStatusLoading(true)
    if (!hasCachedRecords) setRecordsLoading(true)

    try {
      const [deviceRes, liveRes, statusRes, recordsRes] = await Promise.all([
        api.get(`/api/fleet/devices/${deviceId}`),
        isUserShell
          ? Promise.resolve({ data: { live: [] } })
          : api.get(apiFor('/vehicles', '/api/live')).catch(() => ({ data: { live: [] } })),
        fetchMaintenanceStatus(deviceId, { force }),
        fetchMaintenanceRecords(deviceId, { force }),
      ])
      const liveMatch = (liveRes.data.live || []).find(
        (row) => String(row.db_id) === String(deviceId),
      )
      setVehicle({
        name: deviceRes.data?.name || liveMatch?.device?.name || `Vehicle #${deviceId}`,
        plate: deviceRes.data?.plate_number || null,
        vehicleType: deviceRes.data?.vehicle_type || liveMatch?.vehicle_type || null,
        photo: vehiclePhotoSrc(liveMatch) || vehiclePhotoSrc(deviceRes.data),
      })
      setStatus(statusRes.data)
      setHasBaseline(Boolean(statusRes.data?.has_baseline))
      setRecords(recordsRes.data?.records || [])
    } catch (err) {
      console.error('Failed to load maintenance layout data:', err)
      setVehicle((prev) => prev || { name: `Vehicle #${deviceId}` })
      if (force || !getCachedMaintenanceStatus(deviceId)) {
        setStatus(null)
        setHasBaseline(null)
      }
      if (force || !getCachedMaintenanceRecords(deviceId)) {
        setRecords([])
      }
    } finally {
      setStatusLoading(false)
      setRecordsLoading(false)
    }
  }, [apiFor, deviceId, isUserShell, setHasBaseline])

  useEffect(() => {
    loadShared()
  }, [loadShared, refreshToken])

  const refreshMaintenance = useCallback(() => {
    invalidateMaintenanceStatus(deviceId)
    invalidateMaintenanceRecords(deviceId)
    setRefreshToken((n) => n + 1)
  }, [deviceId])

  const outletContext = useMemo(() => ({
    refreshToken,
    refreshMaintenance,
    status,
    statusLoading,
    vehicle,
    records,
    recordsLoading,
  }), [
    refreshToken,
    refreshMaintenance,
    status,
    statusLoading,
    vehicle,
    records,
    recordsLoading,
  ])

  const hasBaselineTab = items.some((item) => item.to === paths.baseline)
  const actionItems = items.filter((item) => {
    if (item.to === paths.report || item.to === paths.baseline) return true
    if (item.to === paths.entry) return !hasBaselineTab
    return false
  })

  const isActive = (to) => (
    location.pathname === to || location.pathname === `${to}/`
  )

  const isReportPage = isActive(paths.report)
  const isEntryPage = isActive(paths.entry)
  const isBaselinePage = isActive(paths.baseline)

  const vehicleScope = isUserShell ? 'your vehicle' : 'the selected vehicle'

  const headerCopy = isReportPage
    ? {
      title: 'Maintenance Report',
      subtitle: `Historical maintenance records for ${vehicleScope}`,
    }
    : isEntryPage
      ? {
        title: 'Add Maintenance',
        subtitle: `Record a service visit for ${vehicleScope}`,
      }
      : isBaselinePage
        ? {
          title: 'Baseline Setup',
          subtitle: 'Set the starting point for maintenance tracking on this vehicle',
        }
        : {
          title: 'Maintenance Overview',
          subtitle: `Component status, service history, and cost for ${vehicleScope}`,
        }

  const headerActions = isReportPage
    ? actionItems.filter((item) => item.to !== paths.report)
    : actionItems

  return (
    <div className="md-page">
      {!isUserShell && (
        <button
          type="button"
          className="md-back"
          aria-label="Back to vehicles"
          onClick={() => navigate(paths.picker)}
        >
          <ArrowLeft size={15} />
          {!isMobile && 'Back to vehicles'}
        </button>
      )}

      <div className="md-header">
        <div className="md-header-info">
          <h1 className="md-title md-title--static">{headerCopy.title}</h1>
          <p className="md-subtitle">{headerCopy.subtitle}</p>
          <VehicleChip vehicle={vehicle} deviceId={deviceId} />
        </div>

        <div className="md-header-actions">
          {headerActions.map((item) => {
            const active = isActive(item.to)
            const Icon = item.to === paths.report ? FileText : Wrench
            return (
              <button
                key={item.to}
                type="button"
                className={`md-action-btn${active ? ' md-action-btn--active' : ''}`}
                onClick={() => navigate(item.to)}
              >
                <Icon size={14} />
                {item.label === MAINTENANCE_NAV_LABELS.baseline
                  ? 'Set Baseline'
                  : item.label}
              </button>
            )
          })}

          {isReportPage && (
            <button
              type="button"
              className="md-action-btn md-action-btn--primary"
              onClick={() => window.print()}
            >
              <FileText size={14} />
              Generate Report
            </button>
          )}
        </div>
      </div>

      <Outlet context={outletContext} />
    </div>
  )
}

export default MaintenanceVehicleLayout
