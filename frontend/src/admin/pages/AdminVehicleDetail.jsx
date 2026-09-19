import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { ArrowLeft, FileText } from 'lucide-react'
import api from '../../api'
import { useTheme } from '../../theme'
import {
  LoadingState,
  EmptyState,
  Avatar,
  StatusBadge,
} from '../../shared/components'
import { deriveVehicleStatus, isVehicleOnline } from '../../user/utils/vehicleStatus'
import { vehiclePhotoSrc } from '../../user/utils/vehiclePhoto'
import { usePanelScope } from '../../manager/hooks/usePanelScope'
import '../styles/admin-vehicle-detail.css'

const VehicleMap = lazy(() => import('../../user/components/VehicleMap'))
const SetParametersModal = lazy(() => import('../../user/components/SetParametersModal'))

const LIVE_POLL_MS = 15000
const REPORT_POLL_MS = 90000
const RECENT_TRIPS_LIMIT = 8
const MOBILE_MQ = '(max-width: 820px)'

const maskVin = (vin) => {
  if (!vin) return null
  const s = String(vin)
  if (s.length <= 8) return s
  return `...${s.slice(-11)}`
}

const DetailField = ({ label, value, children }) => (
  <div className="vd-field">
    <span className="vd-field-label">{label}</span>
    {children || <span className="vd-field-value">{value ?? '—'}</span>}
  </div>
)

const timeAgo = (isoOrDate) => {
  if (!isoOrDate) return '—'
  const diffMs = Date.now() - new Date(isoOrDate).getTime()
  const mins = Math.floor(diffMs / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins} min ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs} hr ago`
  return `${Math.floor(hrs / 24)} d ago`
}

const fmtTime = (iso) => (iso ? new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—')

const onlineLabel = (status) => {
  if (!isVehicleOnline(status)) return { label: 'Offline', pct: 0 }
  if (status === 'moving') return { label: 'Online', pct: 100 }
  if (status === 'idle') return { label: 'Online', pct: 75 }
  return { label: 'Online', pct: 90 }
}

const SEVERITY_DOT = { critical: 'critical', warning: 'warning', info: 'neutral' }

const MapFallback = () => (
  <div className="vd-map-fallback" aria-busy="true">Loading map…</div>
)

const AdminVehicleDetail = () => {
  const { deviceId } = useParams()
  const navigate = useNavigate()
  const { tokens } = useTheme()
  const { basePath, can, apiFor, isManager } = usePanelScope()
  const [report, setReport] = useState(null)
  const [liveItem, setLiveItem] = useState(null)
  const [recentAlerts, setRecentAlerts] = useState([])
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [showParamsModal, setShowParamsModal] = useState(false)
  const [isMobile, setIsMobile] = useState(() => (
    typeof window !== 'undefined' ? window.matchMedia(MOBILE_MQ).matches : false
  ))
  const cancelledRef = useRef(false)

  useEffect(() => {
    const mq = window.matchMedia(MOBILE_MQ)
    const sync = () => setIsMobile(mq.matches)
    sync()
    mq.addEventListener('change', sync)
    return () => mq.removeEventListener('change', sync)
  }, [])

  const liveUrl = apiFor('/vehicles', '/api/live')

  const findLiveMatch = useCallback((livePayload) => {
    const list = livePayload?.live || livePayload || []
    const rows = Array.isArray(list) ? list : []
    if (rows.length === 1 && String(rows[0]?.db_id) === String(deviceId)) return rows[0]
    return rows.find((v) => String(v.db_id) === String(deviceId)) || null
  }, [deviceId])

  const loadLive = useCallback(async () => {
    const liveRes = await api.get(liveUrl, {
      params: isManager
        ? { compact: true, device_id: deviceId }
        : { compact: true, db_id: deviceId },
    })
    return findLiveMatch(liveRes.data)
  }, [liveUrl, findLiveMatch, isManager, deviceId])

  const loadReport = useCallback(async () => {
    const reportRes = await api.get(`/api/vehicle-report/${deviceId}`)
    return reportRes.data
  }, [deviceId])

  const loadSecondary = useCallback(async () => {
    const canAlerts = !isManager || can('alerts_notifications')
    if (!canAlerts) {
      if (!cancelledRef.current) setRecentAlerts([])
      return
    }
    try {
      const alertsRes = await api.get(apiFor('/alerts', '/api/alerts'), {
        params: { device_id: deviceId, limit: 4 },
      })
      if (cancelledRef.current) return
      setRecentAlerts(alertsRes.data || [])
    } catch (err) {
      console.error('Failed to load vehicle alerts:', err)
      if (!cancelledRef.current) setRecentAlerts([])
    }
  }, [deviceId, isManager, can, apiFor])

  const loadCritical = useCallback(async ({ showSpinner } = { showSpinner: false }) => {
    if (showSpinner) setLoading(true)
    try {
      const [reportData, match] = await Promise.all([
        loadReport(),
        loadLive().catch(() => null),
      ])

      if (cancelledRef.current) return false

      if (isManager && !match) {
        setNotFound(true)
        setReport(null)
        setLiveItem(null)
        setRecentAlerts([])
        return false
      }

      setReport(reportData)
      setLiveItem(match)
      setNotFound(false)
      return true
    } catch (err) {
      console.error('Failed to load vehicle report:', err)
      if (!cancelledRef.current && err.response?.status === 404) setNotFound(true)
      return false
    } finally {
      if (!cancelledRef.current && showSpinner) setLoading(false)
    }
  }, [loadReport, loadLive, isManager])

  const refreshAll = useCallback(async () => {
    const ok = await loadCritical({ showSpinner: false })
    if (ok && !cancelledRef.current) await loadSecondary()
  }, [loadCritical, loadSecondary])

  useEffect(() => {
    if (!deviceId) return undefined
    cancelledRef.current = false
    setLoading(true)
    setNotFound(false)
    setRecentAlerts([])

    const boot = async () => {
      const ok = await loadCritical({ showSpinner: true })
      if (ok && !cancelledRef.current) {
        // Secondary data must not block first paint
        loadSecondary()
      }
    }
    boot()

    const liveTimer = setInterval(async () => {
      if (typeof document !== 'undefined' && document.hidden) return
      try {
        const match = await loadLive()
        if (!cancelledRef.current) setLiveItem(match)
      } catch (err) {
        console.error('Failed to refresh live position:', err)
      }
    }, LIVE_POLL_MS)

    const reportTimer = setInterval(() => {
      if (typeof document !== 'undefined' && document.hidden) return
      loadReport()
        .then((data) => {
          if (!cancelledRef.current) setReport(data)
        })
        .catch((err) => console.error('Failed to refresh vehicle report:', err))
    }, REPORT_POLL_MS)

    const onVisible = () => {
      if (document.hidden) return
      loadLive()
        .then((match) => {
          if (!cancelledRef.current) setLiveItem(match)
        })
        .catch(() => {})
    }
    document.addEventListener('visibilitychange', onVisible)

    return () => {
      cancelledRef.current = true
      clearInterval(liveTimer)
      clearInterval(reportTimer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [deviceId, loadCritical, loadSecondary, loadLive, loadReport])

  const mapVehicles = useMemo(() => {
    if (!liveItem) return []
    const attrs = liveItem.position?.attributes || {}
    return [{
      id: deviceId,
      name: liveItem.device.name,
      lat: liveItem.position?.latitude,
      lon: liveItem.position?.longitude,
      status: deriveVehicleStatus(liveItem),
      speedKmh: liveItem.position?.speed_kmh,
      distanceKm: report?.report?.db_total_distance,
      ignition: attrs.ignition,
      batteryLevel: attrs.batteryLevel,
      lastUpdate: liveItem.position?.fixTime || liveItem.position?.deviceTime,
      heading: liveItem.position?.course,
      vehicleType: report?.device?.vehicle_type || liveItem.vehicle_type,
    }]
  }, [liveItem, deviceId, report])

  const recentTrips = useMemo(() => {
    if (!report?.trips) return []
    return [...report.trips].reverse().slice(0, RECENT_TRIPS_LIMIT)
  }, [report])

  if (notFound) {
    return (
      <div className="vd-page">
        <button
          type="button"
          className="vd-back"
          aria-label="Back to Vehicles"
          onClick={() => navigate(`${basePath}/vehicles`)}
        >
          <ArrowLeft size={15} />
          {!isMobile && 'Back to Vehicles'}
        </button>
        <EmptyState title="Vehicle not found" />
      </div>
    )
  }
  if (loading && !report) return <LoadingState label="Loading vehicle…" />
  if (!report) return <EmptyState title="No data for this vehicle." />

  const { device, report: metrics, current_driver } = report
  const status = liveItem ? deriveVehicleStatus(liveItem) : 'offline'
  const vin = maskVin(liveItem?.device?.uniqueId) || maskVin(device.plate_number)
  const online = onlineLabel(status)
  const vehicleSrc = vehiclePhotoSrc(device) || vehiclePhotoSrc(liveItem)

  return (
    <div className="vd-page">
      <div className="vd-header">
        <div className="vd-header-info">
          <Avatar
            name={device.name}
            src={vehicleSrc}
            size="xl"
            style={{ width: 56, height: 56, fontSize: 18 }}
          />
          <div className="vd-header-copy">
            <h1 className="vd-title">{device.name}</h1>
            {vin && <p className="vd-subtitle">VIN: {vin}</p>}
          </div>
        </div>
        <div className="vd-header-actions">
          <button
            type="button"
            className="vd-back"
            aria-label="Back to Vehicles"
            onClick={() => navigate(`${basePath}/vehicles`)}
          >
            <ArrowLeft size={15} />
            {!isMobile && 'Back to Vehicles'}
          </button>
          {can('vehicle_management') && (
            <button type="button" className="vd-customize-btn" onClick={() => setShowParamsModal(true)}>
              Set Parameters
            </button>
          )}
        </div>
      </div>

      {showParamsModal && (
        <Suspense fallback={null}>
          <SetParametersModal
            device={device}
            deviceId={deviceId}
            onClose={() => setShowParamsModal(false)}
            onSaved={refreshAll}
          />
        </Suspense>
      )}

      <div className="vd-layout">
        <div className="vd-main">
          <div className="vd-map-card">
            <div className="vd-map-inner">
              <Suspense fallback={<MapFallback />}>
                <VehicleMap
                  vehicles={mapVehicles}
                  height={340}
                  followId={deviceId}
                />
              </Suspense>
            </div>
          </div>

          <div className="vd-details-panel">
            <div className="vd-details-col">
              <h3 className="vd-section-title">Vehicle Details</h3>
              <div className="vd-fields">
                <DetailField
                  label="Vehicle"
                  value={`${device.name}${vin ? `, VIN ${vin}` : ''}`}
                />
                <DetailField label="Type" value={device.vehicle_type} />
                <DetailField label="Fuel" value={device.fuel_type_name} />
                <DetailField label="Geofence" value={device.primary_geofence_name} />
                <DetailField
                  label="Last seen"
                  value={device.last_seen_at ? new Date(device.last_seen_at).toLocaleString() : null}
                />
                <DetailField
                  label="Owner"
                  value={device.owner_full_name || device.owner_username}
                />
                <DetailField
                  label="Driver"
                  value={current_driver?.name || 'Not assigned'}
                />
              </div>
            </div>

            <div className="vd-details-col">
              <h3 className="vd-section-title">Technical Specs</h3>
              <div className="vd-fields">
                <DetailField
                  label="Speed limit"
                  value={device.speed_limit_kmh ? `${device.speed_limit_kmh} km/h` : 'Fleet default'}
                />
                <DetailField
                  label="Fuel avg (running)"
                  value={device.fuel_avg_running ? `${device.fuel_avg_running} km/L` : null}
                />
                <DetailField
                  label="Fuel avg (idle)"
                  value={device.fuel_avg_idle ? `${device.fuel_avg_idle} L/hr` : null}
                />
                <DetailField label="Status">
                  <span className="vd-status-pills">
                    <StatusBadge status={status} connection />
                    {isVehicleOnline(status) && <StatusBadge status={status} />}
                  </span>
                </DetailField>
                <DetailField
                  label="Distance today"
                  value={metrics ? `${metrics.db_total_distance} km` : '—'}
                />
                <DetailField
                  label="Fuel used today"
                  value={metrics?.db_total_fuel_liters != null
                    ? `${metrics.db_total_fuel_liters} L`
                    : (metrics?.fuel_message || '—')}
                />
                <DetailField
                  label="Fuel cost today"
                  value={metrics?.db_total_fuel_cost_pkr != null
                    ? `PKR ${metrics.db_total_fuel_cost_pkr}`
                    : (metrics?.price_message || '—')}
                />
                {current_driver?.phone_number && (
                  <DetailField label="Driver phone" value={current_driver.phone_number} />
                )}
              </div>
            </div>
          </div>
        </div>

        <div className="vd-sidebar">
          <div className="vd-status-card">
            <h3 className="vd-status-title">Recent Activity</h3>
            <div className="vd-dot-timeline">
              <div className="vd-dot-timeline-item">
                <div className={`vd-dot ${online.pct > 0 ? 'vd-dot--online' : 'vd-dot--neutral'}`} />
                <div className="vd-dot-body">
                  <div className="vd-dot-label">
                    {online.label}
                    {online.pct > 0 ? ` (${online.pct}%)` : ''}
                  </div>
                  <div className="vd-dot-time">
                    last
                    {' '}
                    {timeAgo(device.last_seen_at)}
                  </div>
                </div>
              </div>

              {recentAlerts.length === 0 ? (
                <div className="vd-dot-timeline-item">
                  <div className="vd-dot vd-dot--neutral" />
                  <div className="vd-dot-body">
                    <div className="vd-dot-label">No recent alerts</div>
                    <div className="vd-dot-time">All clear</div>
                  </div>
                </div>
              ) : (
                recentAlerts.map((a) => (
                  <div key={a.id} className="vd-dot-timeline-item">
                    <div className={`vd-dot vd-dot--${SEVERITY_DOT[a.severity] || 'neutral'}`} />
                    <div className="vd-dot-body">
                      <div className="vd-dot-label">{a.message || a.alert_type}</div>
                      <div className="vd-dot-time">{timeAgo(a.triggered_at)}</div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="vd-activity-panel">
            <h3 className="vd-activity-panel-title">Recent Trips</h3>
            {recentTrips.length === 0 ? (
              <EmptyState title="No trips recorded yet." style={{ padding: '8px 0' }} />
            ) : (
              <div className="vd-icon-timeline">
                {recentTrips.map((t) => (
                  <div key={t.id} className="vd-icon-timeline-item">
                    <div className="vd-icon-timeline-icon">
                      <FileText size={15} color={tokens.primary} />
                    </div>
                    <div className="vd-icon-timeline-body">
                      <div className="vd-icon-timeline-title">
                        {t.geofence_name || 'Trip'}
                        {' '}
                        #
                        {t.trip_number}
                        {t.distance_km != null ? ` · ${t.distance_km} km` : ''}
                      </div>
                      <div className="vd-icon-timeline-meta">
                        {fmtTime(t.start_time)}
                        {' '}
                        –
                        {' '}
                        {t.end_time ? fmtTime(t.end_time) : 'ongoing'}
                        {' '}
                        ·
                        {' '}
                        {timeAgo(t.start_time)}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

export default AdminVehicleDetail
