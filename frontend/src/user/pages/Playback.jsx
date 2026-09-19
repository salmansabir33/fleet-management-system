import { lazy, Suspense, useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { Navigate, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { ArrowLeft, ChevronDown } from 'lucide-react'
import api from '../../api'
import { useTheme } from '../../theme'
import { hexToRgba } from '../../shared/utils'
import {
  Card,
  Button,
  Badge,
  EmptyState,
  LoadingState,
  Dropdown,
  DropdownItem,
} from '../../shared/components'
import { MobilePageHeading } from '../../shared/shell'
import { userNavLabel } from '../navItems'
import { adminNavLabel } from '../../admin/navItems'
import DateRangeFilter from '../components/DateRangeFilter'
import PlaybackBar from '../components/PlaybackBar'
import { useSelectedDevice } from '../context/SelectedDeviceContext'
import { usePanelScope } from '../../manager/hooks/usePanelScope'
import { defaultDateFilterValue } from '../utils/dateFilter'
import { PERIOD_PRESETS, getPresetRange, customRangeToIso } from '../utils/playbackPeriod'
import {
  getCachedRoute,
  getCachedTrips,
  routeCacheKey,
  setCachedRoute,
  setCachedTrips,
  tripsCacheKey,
} from '../utils/playbackCache'
import { splitTripLegs } from '../utils/routeAnalysis'
import { utcDateToPktLocalString } from '../../utils/pktTime'

const PlaybackMap = lazy(() => import('../components/PlaybackMap'))

const FRAME_INTERVAL_MS = 700 // base time between playback steps at 1x
const PERIOD_OPTIONS = PERIOD_PRESETS.map((p) => ({ value: p.key, label: p.label }))

const normalizeRoutePoints = (rawRoute) => (
  (rawRoute || [])
    .filter((p) => p.latitude != null && p.longitude != null)
    .map((p) => ({
      ...p,
      // Pre-parse once for gap/leg analysis (same Instant as Date.parse).
      _fixMs: Date.parse(p.fixTime),
    }))
)

const formatPktTime = (isoString) => {
  if (!isoString) return '—'
  const local = utcDateToPktLocalString(new Date(isoString)) // "YYYY-MM-DDTHH:MM"
  const [datePart, timePart] = local.split('T')
  return `${datePart} ${timePart} PKT`
}

const Playback = () => {
  const { deviceId: paramDeviceId } = useParams()
  const { deviceId: selectedDeviceId } = useSelectedDevice()
  const { basePath } = usePanelScope()
  const { tokens } = useTheme()
  const location = useLocation()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()

  // Route param wins (Admin/Manager replay a specific map vehicle).
  // User /user/playback has no param and keeps using SelectedDeviceContext.
  // Do not fall back to that context outside /user — it is leftover from
  // the User vehicle picker and would replay the wrong device.
  const isUserShell = location.pathname.startsWith('/user')
  const deviceId = paramDeviceId || (isUserShell ? selectedDeviceId : null)

  const [mode, setMode] = useState('period') // 'period' | 'trip'
  const [presetKey, setPresetKey] = useState('today')
  const [dateFilter, setDateFilter] = useState(defaultDateFilterValue)

  const [trips, setTrips] = useState([])
  const [tripsLoading, setTripsLoading] = useState(false)
  const [tripsError, setTripsError] = useState(null)

  const view = searchParams.get('view') === 'replay' ? 'playback' : 'setup'
  const setView = (next) => {
    setSearchParams((current) => {
      const nextParams = new URLSearchParams(current)
      if (next === 'playback') nextParams.set('view', 'replay')
      else nextParams.delete('view')
      return nextParams
    }, { replace: next !== 'playback' })
  }

  const [route, setRoute] = useState([])
  const [routeLabel, setRouteLabel] = useState('')
  const [loadingRoute, setLoadingRoute] = useState(false)
  const [loadingTripId, setLoadingTripId] = useState(null)
  const [routeError, setRouteError] = useState(null)

  // Geofence for the currently-selected trip (null in period mode, or if
  // the trip's geofence couldn't be resolved) — feeds the Outward/Inward
  // leg splitter, which needs the geofence center to measure
  // distance-from-home over the route.
  const [tripGeofence, setTripGeofence] = useState(null)
  const [selectedLegKey, setSelectedLegKey] = useState('full')

  const [currentIndex, setCurrentIndex] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [speedMultiplier, setSpeedMultiplier] = useState(1)
  const timerRef = useRef(null)

  const resolveRange = () => (
    presetKey === 'custom' ? customRangeToIso(dateFilter) : getPresetRange(presetKey)
  )

  const applyRouteResult = (points, label, geofence) => {
    setRoute(points)
    setRouteLabel(label)
    setCurrentIndex(0)
    setPlaying(false)
    setSelectedLegKey('full')
    setTripGeofence(geofence ?? null)
    setView('playback')
  }

  const fetchRoute = async (fromIso, toIso, label, geofenceId, maxPoints) => {
    setLoadingRoute(true)
    setRouteError(null)
    const cacheKey = routeCacheKey(deviceId, fromIso, toIso, maxPoints)
    try {
      const cached = getCachedRoute(cacheKey)
      if (cached) {
        applyRouteResult(cached.points, label, cached.geofence)
        // Refresh geofence in background if trip needs it and cache had none
        // — keep UX instant on cache hit; legs fill when ready.
        if (geofenceId != null && cached.geofence == null) {
          api.get(`/api/geofences/${geofenceId}`)
            .then((res) => {
              setTripGeofence(res.data)
              setCachedRoute(cacheKey, { points: cached.points, geofence: res.data })
            })
            .catch((err) => {
              console.error('Failed to load trip geofence:', err)
            })
        }
        return
      }

      // Start geofence in parallel with /api/route so trip open isn't
      // blocked on a second round-trip after the heavy route fetch.
      const geofencePromise = geofenceId != null
        ? api.get(`/api/geofences/${geofenceId}`)
          .then((res) => res.data)
          .catch((err) => {
            console.error('Failed to load trip geofence:', err)
            return null
          })
        : Promise.resolve(null)

      const res = await api.get(`/api/route/${deviceId}`, {
        params: {
          from_time: fromIso,
          to_time: toIso,
          ...(maxPoints != null ? { max_points: maxPoints } : {}),
        },
      })
      // Filter once, here, so currentIndex means the same thing everywhere
      // downstream (slider, stats row, PlaybackMap's marker) — a point
      // missing coordinates would otherwise desync the index between a
      // filtered and an unfiltered view of the same array.
      const points = normalizeRoutePoints(res.data?.route)
      // Open the map as soon as the route is ready; legs fill in when
      // the parallel geofence request finishes.
      applyRouteResult(points, label, null)

      const geofence = await geofencePromise
      setTripGeofence(geofence)
      setCachedRoute(cacheKey, { points, geofence })
    } catch (err) {
      console.error('Failed to load route:', err)
      setRouteError('Could not load the route for this range. Please try again.')
    } finally {
      setLoadingRoute(false)
      setLoadingTripId(null)
    }
  }

  const handleShowPeriod = () => {
    const { fromIso, toIso } = resolveRange()
    const preset = PERIOD_PRESETS.find((p) => p.key === presetKey)
    setLoadingTripId(null)
    // Longer periods need fewer points on the wire; map still looks continuous.
    const spanDays = Math.max(0, (Date.parse(toIso) - Date.parse(fromIso)) / 86400000)
    const maxPoints = spanDays > 20 ? 3500 : spanDays > 7 ? 4000 : 5000
    fetchRoute(fromIso, toIso, preset?.label || 'Replay', undefined, maxPoints)
  }

  const handleShowTrips = async () => {
    const { fromIso, toIso } = resolveRange()
    setTripsLoading(true)
    setTripsError(null)
    setLoadingTripId(null)
    const cacheKey = tripsCacheKey(deviceId, fromIso, toIso)
    try {
      const cached = getCachedTrips(cacheKey)
      if (cached) {
        setTrips(cached)
        return
      }
      const res = await api.get(`/api/trips/${deviceId}`, {
        params: { start: fromIso, end: toIso, lite: true },
      })
      const list = res.data || []
      setCachedTrips(cacheKey, list)
      setTrips(list)
    } catch (err) {
      console.error('Failed to load trips:', err)
      setTripsError('Could not load trips for this range. Please try again.')
    } finally {
      setTripsLoading(false)
    }
  }

  const handleSelectTrip = (trip) => {
    if (loadingRoute) return
    // trip.start_time / trip.end_time already come back 'Z'-suffixed from
    // the backend's own serializer (schemas.py TripOut._serialize_utc) —
    // do NOT append another 'Z' here, or new Date() gets "...00ZZ" and
    // silently fails to parse (this was the "Invalid Date" / blank map bug).
    const fromIso = trip.start_time
    const toIso = trip.end_time || `${new Date().toISOString().slice(0, 19)}Z`
    setLoadingTripId(trip.id)
    // Cap below the old 15k default — long trips still look fine and open faster.
    fetchRoute(fromIso, toIso, `Trip #${trip.trip_number}`, trip.geofence_id, 10000)
  }

  const handleBackToSetup = () => {
    setPlaying(false)
    setView('setup')
  }

  // Outward/Inward legs for the current route, loop-aware — see
  // utils/routeAnalysis.js for the turning-point algorithm. Empty in
  // period mode (no tripGeofence) or if the trip never really left
  // (nothing to split).
  const legs = useMemo(() => splitTripLegs(route, tripGeofence), [route, tripGeofence])

  const legRange = useMemo(() => {
    if (selectedLegKey === 'full') return null
    const leg = legs.find((l) => l.direction === selectedLegKey)
    return leg ? { startIdx: leg.startIdx, endIdx: leg.endIdx } : null
  }, [selectedLegKey, legs])

  const minIndex = legRange ? legRange.startIdx : 0
  const maxIndex = legRange ? legRange.endIdx : Math.max(0, route.length - 1)

  // Playback engine — steps currentIndex forward on a timer while playing,
  // scaled by speedMultiplier. Stops itself at the last point of whatever
  // range is currently active (whole route, or just the selected leg).
  useEffect(() => {
    if (!playing) {
      if (timerRef.current) clearInterval(timerRef.current)
      return
    }
    timerRef.current = setInterval(() => {
      setCurrentIndex((i) => {
        if (i >= maxIndex) {
          setPlaying(false)
          return i
        }
        return i + 1
      })
    }, FRAME_INTERVAL_MS / speedMultiplier)
    return () => clearInterval(timerRef.current)
  }, [playing, speedMultiplier, maxIndex])

  const currentPoint = route[currentIndex]

  const togglePlay = useCallback(() => {
    if (currentIndex >= maxIndex) setCurrentIndex(minIndex)
    setPlaying((p) => !p)
  }, [currentIndex, maxIndex, minIndex])
  const stepBack = useCallback(() => {
    setPlaying(false)
    setCurrentIndex((i) => Math.max(minIndex, i - 1))
  }, [minIndex])
  const stepForward = useCallback(() => {
    setPlaying(false)
    setCurrentIndex((i) => Math.min(maxIndex, i + 1))
  }, [maxIndex])
  const onSeek = useCallback((e) => {
    setPlaying(false)
    setCurrentIndex(Number(e.target.value))
  }, [])
  const onSetSpeed = useCallback((speed) => setSpeedMultiplier(speed), [])

  const timestampLabel = currentPoint?.fixTime ? formatPktTime(currentPoint.fixTime) : '—'
  const pointLabel = route.length > 0 ? `${currentIndex + 1}/${route.length}` : '0/0'
  const playbackBar = (
    <PlaybackBar
      minIndex={minIndex}
      maxIndex={maxIndex}
      currentIndex={Math.min(Math.max(currentIndex, minIndex), maxIndex)}
      onSeek={onSeek}
      playing={playing}
      onTogglePlay={togglePlay}
      onStepBack={stepBack}
      onStepForward={stepForward}
      speedMultiplier={speedMultiplier}
      onSetSpeed={onSetSpeed}
      timestampLabel={timestampLabel}
      pointLabel={pointLabel}
      disabled={route.length === 0}
    />
  )

  if (!deviceId) {
    if (isUserShell) {
      return (
        <EmptyState
          title="No vehicle assigned"
          description="This user does not have a vehicle yet."
        />
      )
    }
    return <Navigate to={`${basePath}/playback`} replace />
  }

  return (
    <div
      className={view === 'playback' ? 'ft-playback-fill' : undefined}
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        minHeight: 0,
        gap: view === 'playback' ? 0 : 12,
      }}
    >
      <MobilePageHeading inset={view === 'playback'}>
        {isUserShell ? userNavLabel('/user/playback') : adminNavLabel('/admin/playback')}
      </MobilePageHeading>
      {view === 'setup' && !isUserShell && (
        <div style={{ flexShrink: 0 }}>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => navigate(`${basePath}/playback`)}
          >
            <ArrowLeft size={16} />
            Vehicles
          </Button>
        </div>
      )}

      {view === 'setup' && (
        <Card>
          <div style={{
            display: 'flex',
            gap: 4,
            background: tokens.background,
            borderRadius: tokens.radius.sm,
            padding: 4,
            marginBottom: 16,
            width: 'fit-content',
          }}
          >
            <button
              type="button"
              onClick={() => setMode('period')}
              style={modeBtnStyle(tokens, mode === 'period')}
            >
              By Period
            </button>
            <button
              type="button"
              onClick={() => setMode('trip')}
              style={modeBtnStyle(tokens, mode === 'trip')}
            >
              By Trip
            </button>
          </div>

          <PlaybackSelect
            label="Period"
            value={presetKey}
            onChange={setPresetKey}
            options={PERIOD_OPTIONS}
            style={{ marginBottom: 14, maxWidth: 280, width: '100%' }}
          />

          {presetKey === 'custom' && (
            <DateRangeFilter value={dateFilter} onChange={setDateFilter} />
          )}

          {mode === 'period' ? (
            <>
              <Button onClick={handleShowPeriod} loading={loadingRoute} disabled={loadingRoute}>
                {loadingRoute ? 'Loading…' : 'Show'}
              </Button>
              {routeError && (
                <div style={{ marginTop: 10, fontSize: 13, color: tokens.semantic.danger }}>
                  {routeError}
                </div>
              )}
            </>
          ) : (
            <>
              <Button
                onClick={handleShowTrips}
                loading={tripsLoading}
                disabled={tripsLoading || loadingRoute}
              >
                {tripsLoading ? 'Loading…' : 'Show trips'}
              </Button>
              {tripsError && (
                <div style={{ marginTop: 10, fontSize: 13, color: tokens.semantic.danger }}>
                  {tripsError}
                </div>
              )}

              {tripsLoading && <LoadingState label="Loading trips…" style={{ marginTop: 16 }} />}

              {loadingTripId != null && (
                <LoadingState
                  label="Loading trip route…"
                  style={{ marginTop: 16 }}
                />
              )}

              {routeError && mode === 'trip' && (
                <div style={{ marginTop: 10, fontSize: 13, color: tokens.semantic.danger }}>
                  {routeError}
                </div>
              )}

              {trips.length > 0 && (
                <div
                  style={{
                    marginTop: 16,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 6,
                    opacity: loadingTripId != null ? 0.72 : 1,
                    pointerEvents: loadingTripId != null ? 'none' : 'auto',
                  }}
                  aria-busy={loadingTripId != null || undefined}
                >
                  {trips.map((trip) => {
                    const isLoadingThis = loadingTripId === trip.id
                    return (
                      <button
                        key={trip.id}
                        type="button"
                        disabled={loadingRoute}
                        aria-busy={isLoadingThis || undefined}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 16,
                          padding: '10px 14px',
                          borderRadius: tokens.radius.sm,
                          border: `1px solid ${isLoadingThis ? tokens.primary : tokens.border}`,
                          background: isLoadingThis ? tokens.primarySoft : tokens.surface,
                          cursor: loadingRoute ? 'wait' : 'pointer',
                          textAlign: 'left',
                          fontSize: 13,
                          fontFamily: 'inherit',
                        }}
                        onClick={() => handleSelectTrip(trip)}
                      >
                        <span style={{ fontWeight: 700, color: tokens.primary, width: 32 }}>
                          #{trip.trip_number}
                        </span>
                        <span style={{ color: tokens.text, flex: 1, minWidth: 0 }}>
                          {trip.start_time ? new Date(trip.start_time).toLocaleString() : '—'}
                        </span>
                        <span style={{ color: tokens.textMuted, width: 80, flexShrink: 0 }}>
                          {trip.distance_km != null ? `${trip.distance_km.toFixed(1)} km` : '—'}
                        </span>
                        {isLoadingThis ? (
                          <span
                            className="ft-spinner"
                            style={{
                              width: 16,
                              height: 16,
                              flexShrink: 0,
                              borderColor: tokens.primary,
                              borderRightColor: 'transparent',
                            }}
                            aria-hidden
                          />
                        ) : (
                          <Badge
                            color={trip.status === 'completed' ? tokens.semantic.success : tokens.semantic.warning}
                            background={hexToRgba(
                              trip.status === 'completed' ? tokens.semantic.success : tokens.semantic.warning,
                              0.14,
                            )}
                          >
                            {trip.status === 'completed' ? 'Completed' : 'In progress'}
                          </Badge>
                        )}
                      </button>
                    )
                  })}
                </div>
              )}
              {!tripsLoading && !loadingTripId && trips.length === 0 && !tripsError && (
                <EmptyState
                  title="No trips loaded"
                  description='Select a period and click "Show trips".'
                  style={{ marginTop: 16, padding: '16px 0' }}
                />
              )}
            </>
          )}
        </Card>
      )}

      {view === 'playback' && (
        <div style={{
          flex: 1,
          minHeight: 0,
          display: 'flex',
          flexDirection: 'column',
        }}
        >
          {!isUserShell && (
            <div
              className="ft-playback-toolbar"
              style={{
                flexShrink: 0,
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '10px 12px',
                borderBottom: `1px solid ${tokens.border}`,
                background: tokens.surface,
              }}
            >
              <Button
                variant="secondary"
                size="sm"
                onClick={handleBackToSetup}
              >
                <ArrowLeft size={16} />
                Back
              </Button>
            </div>
          )}

          <Card
            style={{
              padding: 0,
              flex: 1,
              minHeight: 0,
              overflow: 'hidden',
              border: 'none',
              boxShadow: 'none',
              borderRadius: 0,
              position: 'relative',
            }}
          >
            {isUserShell && (
              <button
                type="button"
                className="ft-playback-map-back"
                aria-label="Back"
                onClick={handleBackToSetup}
              >
                <ArrowLeft size={18} />
              </button>
            )}
            <Suspense fallback={<LoadingState label="Loading map…" style={{ height: '100%' }} />}>
              <PlaybackMap
                route={route}
                currentIndex={currentIndex}
                height="100%"
                followPoint
                legRange={legRange}
                controls={playbackBar}
              />
            </Suspense>
          </Card>
        </div>
      )}
    </div>
  )
}

function PlaybackSelect({
  label,
  value,
  onChange,
  options,
  id,
  style,
  triggerStyle,
  fullWidth = true,
}) {
  const autoId = useId()
  const triggerId = id || autoId
  const selected = options.find((option) => option.value === value)
  return (
    <div className="ft-field" style={style}>
      {label && (
        <label className="ft-field-label" htmlFor={triggerId}>{label}</label>
      )}
      <Dropdown
        className={fullWidth ? 'ft-dropdown--block' : undefined}
        menuClassName="ft-dropdown-menu--stretch"
        trigger={(
          <button
            type="button"
            id={triggerId}
            className="ft-control ft-select-trigger"
            style={triggerStyle}
          >
            <span className="ft-select-trigger-label">{selected?.label ?? ''}</span>
            <ChevronDown size={16} className="ft-select-chevron" aria-hidden />
          </button>
        )}
      >
        {options.map((option) => (
          <DropdownItem
            key={option.value}
            className={option.value === value ? 'ft-dropdown-item--active' : undefined}
            onClick={() => onChange(option.value)}
          >
            {option.label}
          </DropdownItem>
        ))}
      </Dropdown>
    </div>
  )
}

function modeBtnStyle(tokens, active) {
  return {
    padding: '7px 16px',
    borderRadius: 6,
    border: 'none',
    background: active ? tokens.primary : 'transparent',
    fontSize: 13,
    fontWeight: 600,
    color: active ? '#fff' : tokens.textMuted,
    cursor: 'pointer',
    fontFamily: 'inherit',
  }
}

export default Playback
