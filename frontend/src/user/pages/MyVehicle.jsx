import {
  lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState,
} from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Route as RouteIcon, Settings, Clock, Wrench, PlayCircle,
} from 'lucide-react'
import api from '../../api'
import { useTheme } from '../../theme'
import {
  Card,
  StatusBadge,
  Button,
  EmptyState,
  LoadingState,
} from '../../shared/components'
import { MobilePageHeading } from '../../shared/shell'
import { userNavLabel } from '../navItems'
import VehicleHeroArt from '../components/VehicleHeroArt'
import { vehiclePhotoSrc } from '../utils/vehiclePhoto'
import { useSelectedDevice } from '../context/SelectedDeviceContext'
import { deriveVehicleStatus } from '../utils/vehicleStatus'
import { formatBattery, fmtNum } from '../utils/dashboardHelpers'
import '../styles/my-vehicle.css'

const VehicleMap = lazy(() => import('../components/VehicleMap'))
const SetParametersModal = lazy(() => import('../components/SetParametersModal'))
const LineChartCard = lazy(() =>
  import('../../shared/components/LineChartCard').then((mod) => ({ default: mod.LineChartCard })),
)

const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const UNAVAILABLE_LOCATION = 'Current location unavailable'
const LIVE_POLL_MS = 10000
const REPORT_POLL_MS = 30000
const TREND_POLL_MS = 60000

const weekdayFromIso = (iso) => {
  if (!iso) return null
  const d = new Date(`${iso}T00:00:00`)
  if (Number.isNaN(d.getTime())) return null
  return d.getDay()
}

const shortLocationName = (address) => {
  if (!address || address === UNAVAILABLE_LOCATION) return ''
  const parts = address.split(',').map((part) => part.trim()).filter(Boolean)
  const withoutPostal = parts.filter((part) => !/^\d{4,}$/.test(part))
  const pool = withoutPostal.length ? withoutPostal : parts
  if (pool.length >= 2) return pool[pool.length - 2]
  return pool[0] || ''
}

const gpsOdometerKm = (liveItem) => {
  const attrs = liveItem?.position?.attributes || {}
  const raw = liveItem?.position?.total_distance ?? attrs.totalDistance
  const n = Number(raw)
  if (!Number.isFinite(n) || n <= 0) return null
  return n / 1000
}

const deviceFromLive = (liveItem, deviceId) => {
  if (!liveItem) return null
  return {
    id: deviceId,
    name: liveItem.device?.name || 'Vehicle',
    vehicle_type: liveItem.vehicle_type || liveItem.device?.vehicle_type,
    plate_number: liveItem.plate_number || liveItem.device?.plate_number,
    pic_url: liveItem.pic_url || liveItem.device?.pic_url,
  }
}

const MapFallback = () => (
  <div className="ft-my-vehicle-map-fallback" aria-hidden>
    <LoadingState label="Loading map…" />
  </div>
)

const ChartFallback = () => (
  <Card className="ft-my-vehicle-grid__fuel ft-my-vehicle-fuel" title="Recent Fuel Efficiency">
    <LoadingState label="Loading chart…" />
  </Card>
)

const MyVehicle = () => {
  const { deviceId } = useSelectedDevice()
  const { tokens } = useTheme()
  const navigate = useNavigate()
  const [report, setReport] = useState(null)
  const [liveItem, setLiveItem] = useState(null)
  const [trend, setTrend] = useState([])
  const [loading, setLoading] = useState(true)
  const [showParamsModal, setShowParamsModal] = useState(false)
  const [mapVisible, setMapVisible] = useState(false)
  const mapHostRef = useRef(null)
  const reportTick = useRef(0)
  const trendTick = useRef(0)

  const loadLive = useCallback(async () => {
    const liveRes = await api.get('/api/live', {
      params: { compact: true, db_id: deviceId },
    })
    const rows = liveRes.data.live || []
    return rows.find((v) => String(v.db_id) === String(deviceId)) || null
  }, [deviceId])

  const loadReport = useCallback(async () => {
    const reportRes = await api.get(`/api/vehicle-report/${deviceId}`, {
      params: { summary: true },
    })
    return reportRes.data
  }, [deviceId])

  const loadTrend = useCallback(async () => {
    const trendRes = await api.get(`/api/vehicle-report/${deviceId}/trend`, {
      params: { days: 7 },
    })
    return trendRes.data.points || []
  }, [deviceId])

  useEffect(() => {
    if (!deviceId) return undefined
    let cancelled = false
    reportTick.current = 0
    trendTick.current = 0
    setLoading(true)
    setMapVisible(false)
    setReport(null)
    setLiveItem(null)
    setTrend([])

    const bootstrap = async () => {
      try {
        // Live is the fast path — paint as soon as it arrives.
        const liveMatch = await loadLive()
        if (cancelled) return
        setLiveItem(liveMatch)
        setLoading(false)

        // Report + trend fill in after first paint (don't block UI).
        const reportData = await loadReport()
        if (cancelled) return
        setReport(reportData)

        loadTrend()
          .then((points) => {
            if (!cancelled) setTrend(points)
          })
          .catch((err) => console.error('Failed to load fuel trend:', err))
      } catch (err) {
        console.error('Failed to load vehicle report:', err)
        if (!cancelled) setLoading(false)
      }
    }
    bootstrap()

    // Warm heavy chunks after first paint so map/chart open instantly later.
    const warm = window.setTimeout(() => {
      import('../components/VehicleMap')
      import('../../shared/components/LineChartCard')
    }, 100)

    const interval = setInterval(async () => {
      reportTick.current += LIVE_POLL_MS
      trendTick.current += LIVE_POLL_MS
      try {
        const jobs = [loadLive().then((match) => {
          if (!cancelled) setLiveItem(match)
        })]
        if (reportTick.current >= REPORT_POLL_MS) {
          reportTick.current = 0
          jobs.push(loadReport().then((data) => {
            if (!cancelled) setReport(data)
          }))
        }
        if (trendTick.current >= TREND_POLL_MS) {
          trendTick.current = 0
          jobs.push(loadTrend().then((points) => {
            if (!cancelled) setTrend(points)
          }))
        }
        await Promise.all(jobs)
      } catch (err) {
        console.error('Failed to refresh vehicle page:', err)
      }
    }, LIVE_POLL_MS)

    return () => {
      cancelled = true
      clearInterval(interval)
      window.clearTimeout(warm)
    }
  }, [deviceId, loadLive, loadReport, loadTrend])

  useEffect(() => {
    if (loading || mapVisible) return undefined
    const el = mapHostRef.current
    if (!el) return undefined
    if (typeof IntersectionObserver === 'undefined') {
      setMapVisible(true)
      return undefined
    }
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setMapVisible(true)
          io.disconnect()
        }
      },
      { rootMargin: '240px' },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [loading, liveItem, report, mapVisible])

  const refreshAfterParams = useCallback(async () => {
    try {
      const [reportData, liveMatch] = await Promise.all([loadReport(), loadLive()])
      setReport(reportData)
      setLiveItem(liveMatch)
    } catch (err) {
      console.error('Failed to reload after parameters save:', err)
    }
  }, [loadReport, loadLive])

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

  const fuelChartData = useMemo(() => {
    const byDay = [0, 0, 0, 0, 0, 0, 0]
    for (const point of trend || []) {
      const idx = weekdayFromIso(point.date)
      if (idx == null) continue
      if (point.distance_km > 0 && point.fuel_liters != null && point.fuel_liters > 0) {
        byDay[idx] = point.distance_km / point.fuel_liters
      } else {
        byDay[idx] = Number(point.distance_km) || 0
      }
    }
    return WEEKDAY_LABELS.map((label, i) => ({ label, value: byDay[i] }))
  }, [trend])

  const address = liveItem?.position?.address || UNAVAILABLE_LOCATION
  const locationLabel = shortLocationName(liveItem?.position?.address)
  const photoSrc = useMemo(
    () => vehiclePhotoSrc(liveItem) || vehiclePhotoSrc(report?.device),
    [liveItem, report],
  )
  const device = report?.device || deviceFromLive(liveItem, deviceId)

  const goToTrips = useCallback(() => navigate('/user/trip-routes'), [navigate])
  const goToPlayback = useCallback(() => navigate('/user/playback'), [navigate])
  const goToMaintenance = useCallback(() => navigate('/user/maintenance'), [navigate])

  if (!deviceId) {
    return (
      <EmptyState
        title="No vehicle assigned"
        description="This user does not have a vehicle yet."
      />
    )
  }
  if (loading && !liveItem && !report) return <LoadingState label="Loading vehicle…" />
  if (!device) return <EmptyState title="No vehicle selected." />

  const metrics = report?.report
  const status = liveItem ? deriveVehicleStatus(liveItem) : 'offline'
  const attrs = liveItem?.position?.attributes || {}
  const odometerKm = gpsOdometerKm(liveItem)
  const odometerDisplay = odometerKm != null
    ? `${fmtNum(odometerKm, odometerKm >= 100 ? 0 : 1)} km`
    : metrics?.db_total_distance != null
      ? `${fmtNum(metrics.db_total_distance, 1)} km (today)`
      : '—'
  const batteryDisplay = formatBattery(attrs.batteryLevel)

  return (
    <div className="ft-page-stack ft-page-stack--fill ft-my-vehicle">
      <MobilePageHeading>{userNavLabel('/user/my-vehicle')}</MobilePageHeading>
      {showParamsModal && report?.device && (
        <Suspense fallback={null}>
          <SetParametersModal
            device={report.device}
            deviceId={deviceId}
            onClose={() => setShowParamsModal(false)}
            onSaved={refreshAfterParams}
          />
        </Suspense>
      )}

      <div className="ft-my-vehicle-grid">
        <Card className="ft-my-vehicle-grid__profile" style={{ display: 'flex', flexDirection: 'column' }}>
          <div className="ft-my-vehicle-profile">
            <div className="ft-my-vehicle-photo">
              <VehicleHeroArt
                size="showcase"
                vehicleType={device.vehicle_type}
                plate={device.plate_number}
                src={photoSrc}
              />
            </div>
            <div>
              <div className="ft-my-vehicle-profile__name">{device.name}</div>
              <div className="ft-my-vehicle-stats">
                <div className="ft-my-vehicle-stat">
                  <span className="ft-my-vehicle-stat-label">Current Location</span>
                  <span className="ft-my-vehicle-stat-value" title={address}>
                    {locationLabel || address}
                  </span>
                </div>
                <div className="ft-my-vehicle-stat">
                  <span className="ft-my-vehicle-stat-label">Odometer</span>
                  <span className="ft-my-vehicle-stat-value">{odometerDisplay}</span>
                </div>
                <div className="ft-my-vehicle-stat">
                  <span className="ft-my-vehicle-stat-label">Status</span>
                  <StatusBadge status={status} />
                </div>
              </div>
            </div>
            <div className="ft-my-vehicle-profile__actions">
              <Button className="ft-my-vehicle-cta" onClick={goToTrips}>
                <RouteIcon size={15} />
                View Trip History
              </Button>
              <Button
                variant="secondary"
                className="ft-my-vehicle-cta ft-my-vehicle-cta--soft"
                onClick={() => setShowParamsModal(true)}
                disabled={!report?.device}
              >
                <Settings size={15} />
                Parameters
              </Button>
            </div>
          </div>
        </Card>

        <Card
          className="ft-my-vehicle-grid__map"
          style={{ padding: 12, display: 'flex', flexDirection: 'column' }}
        >
          <div className="ft-my-vehicle-map">
            <div className="ft-my-vehicle-map__canvas" ref={mapHostRef}>
              <span className="ft-my-vehicle-map-chip">Current Location</span>
              {mapVisible ? (
                <Suspense fallback={<MapFallback />}>
                  <VehicleMap
                    vehicles={mapVehicles}
                    height="100%"
                    followId={deviceId}
                    zoomPosition="bottomright"
                  />
                </Suspense>
              ) : (
                <MapFallback />
              )}
            </div>
            <div className="ft-my-vehicle-map-actions">
              <button
                type="button"
                className="ft-my-vehicle-map-action"
                onClick={goToPlayback}
                title="Live Playback"
              >
                <span className="ft-my-vehicle-map-action-icon"><PlayCircle size={18} /></span>
                <span className="ft-my-vehicle-map-action-label">Playback</span>
              </button>
              <button
                type="button"
                className="ft-my-vehicle-map-action"
                onClick={goToTrips}
                title="Trips"
              >
                <span className="ft-my-vehicle-map-action-icon"><RouteIcon size={18} /></span>
                <span className="ft-my-vehicle-map-action-label">Trips</span>
              </button>
              <button
                type="button"
                className="ft-my-vehicle-map-action"
                onClick={goToMaintenance}
                title="Maintenance"
              >
                <span className="ft-my-vehicle-map-action-icon"><Wrench size={18} /></span>
                <span className="ft-my-vehicle-map-action-label">Maintenance</span>
              </button>
            </div>
          </div>
        </Card>

        <Card id="vehicle-vitals" title="Vehicle Vitals" className="ft-my-vehicle-grid__vitals">
          <div className="ft-my-vehicle-vitals">
            <div className="ft-my-vehicle-vitals__rows">
              <VitalRow
                icon={PlayCircle}
                label="Battery"
                value={batteryDisplay}
                tokens={tokens}
              />
              <VitalRow
                icon={RouteIcon}
                label="Odometer"
                value={odometerDisplay}
                tokens={tokens}
              />
              <VitalRow
                icon={Clock}
                label="Status"
                value={<StatusBadge status={status} />}
                tokens={tokens}
              />
            </div>
          </div>
        </Card>

        <Suspense fallback={<ChartFallback />}>
          <LineChartCard
            className="ft-my-vehicle-grid__fuel ft-my-vehicle-fuel"
            title="Recent Fuel Efficiency"
            data={fuelChartData}
            xKey="label"
            yKey="value"
            yFormatter={(v) => `${fmtNum(v, 1)}`}
            height={180}
            showDots={false}
          />
        </Suspense>
      </div>
    </div>
  )
}

function VitalRow({ icon: Icon, label, value, tokens }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
      <div style={{
        width: 36,
        height: 36,
        borderRadius: '50%',
        background: tokens.primarySoft,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
      }}
      >
        <Icon size={18} color={tokens.primary} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 11, fontWeight: 600, color: tokens.textMuted, textTransform: 'uppercase' }}>
          {label}
        </div>
        <div style={{ fontSize: 14, fontWeight: 700, color: tokens.text, marginTop: 2 }}>
          {value}
        </div>
      </div>
    </div>
  )
}

export default MyVehicle
