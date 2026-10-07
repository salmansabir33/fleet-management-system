import { Fragment, memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Plus, Route as RouteIcon, Pencil, Trash2, GripVertical, X, MoreVertical, Map } from 'lucide-react'
import { MapContainer, Marker, Polyline, TileLayer, Tooltip, useMap } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import api from '../../api'
import RouteBuilderModal from '../components/RouteBuilderModal'
import { useTheme } from '../../theme'
import {
  Card,
  Button,
  IconButton,
  FilterBar,
  Input,
  Badge,
  Dropdown,
  DropdownItem,
  LoadingState,
  EmptyState,
  ConfirmDialog,
} from '../../shared/components'
import { MobilePageHeading } from '../../shared/shell'
import { adminNavLabel } from '../navItems'
import { usePanelScope } from '../../manager/hooks/usePanelScope'
import { useSaAdminListParams } from '../hooks/useSaAdminListParams'
import AdminFilterBar from '../components/AdminFilterBar'
import '../styles/admin-routes.css'

const MAPTILER_KEY = import.meta.env.VITE_MAPTILER_KEY
const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN

const TILE_URL = MAPTILER_KEY
  ? `https://api.maptiler.com/maps/streets-v4/{z}/{x}/{y}.png?key=${MAPTILER_KEY}`
  : MAPBOX_TOKEN
    ? `https://api.mapbox.com/styles/v1/mapbox/streets-v12/tiles/{z}/{x}/{y}@2x?access_token=${MAPBOX_TOKEN}`
    : 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png'

const TILE_ATTRIBUTION = MAPTILER_KEY
  ? '&copy; <a href="https://www.maptiler.com/copyright/" target="_blank">MapTiler</a> &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
  : MAPBOX_TOKEN
    ? '&copy; <a href="https://www.mapbox.com/about/maps/">Mapbox</a> &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
    : '&copy; <a href="https://carto.com/attributions">CARTO</a> &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'

const TILE_EXTRA_PROPS = MAPTILER_KEY ? { tileSize: 512, zoomOffset: -1 } : {}
const DEFAULT_CENTER = [31.4504, 73.135]

const RANGE_OPTIONS = [
  { key: 'today', label: 'Today' },
  { key: 'week', label: 'This Week' },
  { key: 'month', label: 'This Month' },
  { key: 'date', label: 'Date' },
  { key: 'range', label: 'Date Range' },
]

const fitRouteBounds = (points) => {
  if (!points.length) return null
  return L.latLngBounds(points.map((point) => [point.lat, point.lon]))
}

const computeBearing = (pointA, pointB) => {
  const lat1 = (pointA.lat * Math.PI) / 180
  const lat2 = (pointB.lat * Math.PI) / 180
  const dLon = ((pointB.lon - pointA.lon) * Math.PI) / 180
  const y = Math.sin(dLon) * Math.cos(lat2)
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon)
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360
}

const TRIP_COLORS = [
  '#2563eb', // blue
  '#9333ea', // purple
  '#10b981', // green
  '#ec4899', // pink
  '#8b5cf6', // violet
  '#06b6d4', // cyan
  '#f97316', // orange
  '#6366f1', // indigo
]
const colorForTrip = (tripId) => TRIP_COLORS[tripId % TRIP_COLORS.length]

// Backend polls Traccar every 5s; 60s+ silence indicates signal loss, not jitter.
const GAP_THRESHOLD_MS = 60 * 1000

const splitPathAtGaps = (path) => {
  if (!path || path.length === 0) return []
  if (path.length === 1) return [{ points: path, isGap: false }]

  const segments = []
  let current = [path[0]]

  for (let i = 1; i < path.length; i += 1) {
    const prev = path[i - 1]
    const curr = path[i]
    const prevTime = prev.fix_time ? new Date(prev.fix_time).getTime() : null
    const currTime = curr.fix_time ? new Date(curr.fix_time).getTime() : null

    if (
      prevTime != null
      && currTime != null
      && currTime - prevTime >= GAP_THRESHOLD_MS
    ) {
      if (current.length >= 1) {
        segments.push({ points: [...current], isGap: false })
      }
      segments.push({
        points: [prev, curr],
        isGap: true,
        gapMs: currTime - prevTime,
      })
      current = [curr]
    } else {
      current.push(curr)
    }
  }

  if (current.length >= 1) {
    segments.push({ points: current, isGap: false })
  }

  return segments
}

const pathToPositions = (points) => points.map((point) => [point.lat, point.lon])

const formatGapMinutes = (gapMs) => {
  const minutes = Math.max(1, Math.round(gapMs / 60000))
  return minutes === 1 ? '1 minute' : `${minutes} minutes`
}

const pathSliceMeters = (points) => {
  let meters = 0
  for (let i = 1; i < points.length; i += 1) {
    meters += L.latLng(points[i - 1].lat, points[i - 1].lon)
      .distanceTo(L.latLng(points[i].lat, points[i].lon))
  }
  return meters
}

const onRouteAtIndex = (segments, index) => {
  if (!Array.isArray(segments) || segments.length === 0) return true
  for (let i = 0; i < segments.length; i += 1) {
    const seg = segments[i]
    if (index >= seg.start_index && index <= seg.end_index) return !!seg.on_route
  }
  return true
}

const splitByRouteStatus = (points, statusSegments) => {
  if (!points || points.length === 0) return []
  const runs = []
  let runStart = 0
  let current = onRouteAtIndex(statusSegments, points[0]._i)
  for (let i = 1; i < points.length; i += 1) {
    const flag = onRouteAtIndex(statusSegments, points[i]._i)
    if (flag !== current) {
      const prevPoints = points.slice(runStart, i)
      if (prevPoints.length >= 2) {
        runs.push({ on_route: current, points: prevPoints })
      }
      runStart = i - 1
      current = flag
    }
  }
  runs.push({ on_route: current, points: points.slice(runStart) })
  return runs
}

const arrowIcon = (bearing, color) => L.divIcon({
  className: 'route-arrow-icon',
  html: `
    <div style="
      width:0;height:0;
      border-left:5px solid transparent;
      border-right:5px solid transparent;
      border-bottom:12px solid ${color};
      transform:rotate(${bearing}deg);
      filter:drop-shadow(0 1px 1px rgba(17,24,39,0.35));
    "></div>
  `,
  iconSize: [10, 12],
  iconAnchor: [5, 6],
})

const arrowPointsForPath = (points, color) => {
  if (!points || points.length < 2) return []
  const arrowCount = Math.min(12, Math.max(1, Math.round(points.length * 0.1)))
  const arrows = []
  for (let n = 0; n < arrowCount; n += 1) {
    const index = Math.min(points.length - 2, Math.floor((n * (points.length - 1)) / arrowCount))
    let next = index + 1
    while (next < points.length && points[next].lat === points[index].lat && points[next].lon === points[index].lon) {
      next += 1
    }
    if (next >= points.length) continue
    arrows.push({
      key: `${n}-${index}-${next}`,
      lat: points[index].lat,
      lon: points[index].lon,
      bearing: computeBearing(points[index], points[next]),
      color,
    })
  }
  return arrows
}

const FitToBounds = ({ bounds }) => {
  const map = useMap()
  const boundsRef = useRef(bounds)
  boundsRef.current = bounds
  const boundsKey = bounds ? bounds.toBBoxString() : ''

  useEffect(() => {
    map.invalidateSize()
    const current = boundsRef.current
    if (current) {
      map.fitBounds(current, { padding: [36, 36] })
    }
  }, [boundsKey, map])

  useEffect(() => {
    const apply = () => {
      map.invalidateSize()
      const current = boundsRef.current
      if (current) {
        map.fitBounds(current, { padding: [36, 36] })
      }
    }
    const timer = window.setTimeout(apply, 50)
    return () => window.clearTimeout(timer)
  }, [map])

  return null
}

const Filters = ({ value, onChange }) => (
  <div style={{ marginBottom: 12 }}>
    <FilterBar
      options={RANGE_OPTIONS}
      value={value.range}
      onChange={(key) => onChange((current) => ({ ...current, range: key }))}
    />
    <div
      className={value.range === 'range' ? 'ft-routes-date-range-fields' : undefined}
      style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}
    >
      {value.range === 'date' && (
        <Input
          type="date"
          value={value.date}
          onChange={(e) => onChange((current) => ({ ...current, date: e.target.value }))}
          style={{ maxWidth: 180 }}
        />
      )}
      {value.range === 'range' && (
        <>
          <Input
            type="date"
            value={value.start}
            onChange={(e) => onChange((current) => ({ ...current, start: e.target.value }))}
            style={{ maxWidth: 180 }}
          />
          <Input
            type="date"
            value={value.end}
            onChange={(e) => onChange((current) => ({ ...current, end: e.target.value }))}
            style={{ maxWidth: 180 }}
          />
        </>
      )}
    </div>
  </div>
)

const RouteMap = memo(({ routePath, tripDetails, isolatedTripId, onSelectTrip }) => {
  const { tokens } = useTheme()
  const routePositions = useMemo(
    () => routePath.map((point) => [point.lat, point.lon]),
    [routePath],
  )
  const visibleTripDetails = useMemo(
    () => (isolatedTripId
      ? tripDetails.filter((detail) => detail.trip_id === isolatedTripId)
      : tripDetails),
    [tripDetails, isolatedTripId],
  )

  const bounds = useMemo(() => {
    const allPoints = [
      ...routePath,
      ...visibleTripDetails.flatMap((detail) => detail.actual_path || []),
    ]
    return fitRouteBounds(allPoints)
  }, [routePath, visibleTripDetails])

  return (
    <div style={{ flex: 1, minHeight: 0 }}>
      <MapContainer
        center={DEFAULT_CENTER}
        zoom={13}
        style={{ width: '100%', height: '100%', background: tokens.background }}
        scrollWheelZoom
        whenReady={(event) => event?.target?.invalidateSize?.()}
      >
        <TileLayer
          attribution={TILE_ATTRIBUTION}
          url={TILE_URL}
          subdomains="abcd"
          maxZoom={19}
          {...TILE_EXTRA_PROPS}
        />
        <FitToBounds bounds={bounds} />

        {routePositions.length > 1 && (
          <>
            <Polyline
              positions={routePositions}
              pathOptions={{ color: '#ffffff', weight: 7, opacity: 0.85 }}
            />
            <Polyline
              positions={routePositions}
              pathOptions={{ color: tokens.primary, weight: 3, opacity: 0.9, dashArray: '10, 8' }}
            >
              <Tooltip sticky>Defined route</Tooltip>
            </Polyline>
          </>
        )}

        {visibleTripDetails.map((detail) => {
          const fullPath = detail.actual_path || []
          const indexedPath = fullPath.map((point, index) => ({ ...point, _i: index }))
          const baseColor = colorForTrip(detail.trip_id)
          const tripLabel = `Trip #${detail.trip_id} · ${detail.trip_date}`
          const selectTrip = () => onSelectTrip?.(detail.trip_id)
          const statusSegments = detail.route_status_segments || []

          return (
            <Fragment key={detail.trip_id}>
              {splitPathAtGaps(indexedPath).flatMap((segment, index) => {
                if (segment.points.length < 2) return []
                const positions = pathToPositions(segment.points)
                if (segment.isGap) {
                  return (
                    <Polyline
                      key={`gap-${detail.trip_id}-${index}`}
                      positions={positions}
                      pathOptions={{
                        color: tokens.text,
                        weight: 2,
                        opacity: 0.7,
                        dashArray: '4, 6',
                      }}
                      eventHandlers={{ click: selectTrip }}
                    >
                      <Tooltip sticky>{`GPS signal gap (~${formatGapMinutes(segment.gapMs)})`}</Tooltip>
                    </Polyline>
                  )
                }
                return splitByRouteStatus(segment.points, statusSegments).flatMap((run, runIndex) => {
                  if (run.points.length < 2) return []
                  // Two GPS points stacked on the same spot render as a round
                  // blob at polyline weight 4–5 — skip geographically degenerate runs.
                  if (pathSliceMeters(run.points) < 15) return []
                  const runPositions = pathToPositions(run.points)
                  if (run.on_route) {
                    return (
                      <Fragment key={`on-${detail.trip_id}-${index}-${runIndex}`}>
                        <Polyline
                          positions={runPositions}
                          pathOptions={{ color: '#1e293b', weight: 6, opacity: 0.35 }}
                        />
                        <Polyline
                          positions={runPositions}
                          pathOptions={{ color: baseColor, weight: 4, opacity: 0.92 }}
                          eventHandlers={{ click: selectTrip }}
                        >
                          <Tooltip sticky>{tripLabel} · On route</Tooltip>
                        </Polyline>
                      </Fragment>
                    )
                  }
                  return (
                    <Polyline
                      key={`off-${detail.trip_id}-${index}-${runIndex}`}
                      positions={runPositions}
                      pathOptions={{ color: tokens.semantic.danger, weight: 5, opacity: 0.95 }}
                      eventHandlers={{ click: selectTrip }}
                    >
                      <Tooltip sticky>Deviation segment</Tooltip>
                    </Polyline>
                  )
                })
              })}
              {isolatedTripId === detail.trip_id && arrowPointsForPath(fullPath, baseColor).map((arrow) => (
                <Marker
                  key={`arrow-${detail.trip_id}-${arrow.key}`}
                  position={[arrow.lat, arrow.lon]}
                  icon={arrowIcon(arrow.bearing, arrow.color)}
                  interactive={false}
                  keyboard={false}
                  pane="overlayPane"
                />
              ))}
            </Fragment>
          )
        })}
      </MapContainer>
    </div>
  )
})
RouteMap.displayName = 'RouteMap'

const buildRangeParams = (filters) => {
  const params = { range: filters.range }
  if (filters.range === 'date' && filters.date) params.date = filters.date
  if (filters.range === 'range') {
    if (filters.start) params.start = filters.start
    if (filters.end) params.end = filters.end
  }
  return params
}

const otherVehicleKey = (routeId) => `${routeId}:other`

const RoutesPage = () => {
  const { tokens } = useTheme()
  const { apiFor, can, isManager } = usePanelScope()
  const saListParams = useSaAdminListParams()
  const canManageRoutes = can('route_management')
  const [routes, setRoutes] = useState([])
  const [loading, setLoading] = useState(true)
  const [expandedRouteId, setExpandedRouteId] = useState(null)
  const [routeDetails, setRouteDetails] = useState({})
  const [routeVehicles, setRouteVehicles] = useState({})
  const [routeOtherTrips, setRouteOtherTrips] = useState({})
  const [routeTrips, setRouteTrips] = useState({})
  const [tripDetails, setTripDetails] = useState({})
  const [selectedVehicleKey, setSelectedVehicleKey] = useState(null)
  const [isolatedTripId, setIsolatedTripId] = useState(null)
  const [loadingTripId, setLoadingTripId] = useState(null)
  const [showBuilder, setShowBuilder] = useState(false)
  const [editRouteId, setEditRouteId] = useState(null)
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [deleteLoading, setDeleteLoading] = useState(false)
  const [deleteError, setDeleteError] = useState(null)
  const [filtersByRoute, setFiltersByRoute] = useState({})
  const [detailsPanelVisible, setDetailsPanelVisible] = useState(true)
  const [floatPos, setFloatPos] = useState(null)
  const [dragging, setDragging] = useState(false)
  const [isMobileLayout, setIsMobileLayout] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(max-width: 900px)').matches,
  )
  const [mobileMapOpen, setMobileMapOpen] = useState(false)
  const mapPanelRef = useRef(null)
  const floatPanelRef = useRef(null)
  const dragOffsetRef = useRef({ x: 0, y: 0 })
  const tripDetailsRef = useRef(tripDetails)
  const vehicleLoadSeqRef = useRef(0)
  tripDetailsRef.current = tripDetails

  const styles = useMemo(() => makeRouteStyles(tokens), [tokens])

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 900px)')
    const update = () => {
      const mobile = mq.matches
      setIsMobileLayout(mobile)
      if (!mobile) setMobileMapOpen(false)
    }
    update()
    mq.addEventListener('change', update)
    return () => mq.removeEventListener('change', update)
  }, [])

  useEffect(() => {
    if (!mobileMapOpen) return undefined
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [mobileMapOpen])

  const routeFilter = (routeId) => (
    filtersByRoute[routeId] || {
      range: 'today',
      date: new Date().toISOString().slice(0, 10),
      start: new Date().toISOString().slice(0, 10),
      end: new Date().toISOString().slice(0, 10),
    }
  )

  const loadRoutes = useCallback(async () => {
    setLoading(true)
    try {
      const res = await api.get(apiFor('/routes', '/api/routes'), { params: saListParams })
      setRoutes(res.data || [])
    } catch (err) {
      console.error('Failed to load routes:', err)
    } finally {
      setLoading(false)
    }
  }, [apiFor, saListParams])

  useEffect(() => {
    loadRoutes()
  }, [loadRoutes])

  const loadRouteDetail = useCallback(async (routeId) => {
    const res = await api.get(apiFor(`/routes/${routeId}`, `/api/routes/${routeId}`))
    setRouteDetails((current) => ({ ...current, [routeId]: res.data }))
    return res.data
  }, [apiFor])

  const loadRouteVehicles = useCallback(async (routeId, filters) => {
    const params = buildRangeParams(filters)
    const [vehiclesRes, otherRes] = await Promise.all([
      api.get(
        apiFor(`/routes/${routeId}/vehicles`, `/api/routes/${routeId}/vehicles`),
        { params },
      ),
      api.get(
        apiFor(`/routes/${routeId}/other-trips`, `/api/routes/${routeId}/other-trips`),
        { params },
      ),
    ])
    setRouteVehicles((current) => ({ ...current, [routeId]: vehiclesRes.data || [] }))
    setRouteOtherTrips((current) => ({ ...current, [routeId]: otherRes.data || [] }))
    return vehiclesRes.data || []
  }, [apiFor])

  const expandRoute = async (routeId) => {
    const nextExpanded = expandedRouteId === routeId ? null : routeId
    setExpandedRouteId(nextExpanded)
    setSelectedVehicleKey(null)
    setIsolatedTripId(null)
    setLoadingTripId(null)
    setFloatPos(null)
    if (nextExpanded == null) {
      setMobileMapOpen(false)
      return
    }

    const filters = routeFilter(routeId)
    try {
      await Promise.all([
        routeDetails[routeId] ? Promise.resolve() : loadRouteDetail(routeId),
        loadRouteVehicles(routeId, filters),
      ])
    } catch (err) {
      console.error('Failed to expand route:', err)
    }
  }

  const updateRouteFilter = async (routeId, updater) => {
    const current = routeFilter(routeId)
    const next = typeof updater === 'function' ? updater(current) : updater
    setFiltersByRoute((value) => ({ ...value, [routeId]: next }))
    setSelectedVehicleKey(null)
    setIsolatedTripId(null)
    setLoadingTripId(null)
    await loadRouteVehicles(routeId, next)
  }

  const ensureTripDetail = useCallback(async (routeId, vehicleKey, tripId) => {
    const cached = (tripDetailsRef.current[vehicleKey] || []).find((detail) => detail.trip_id === tripId)
    if (cached) return cached

    setLoadingTripId(tripId)
    try {
      const res = await api.get(
        apiFor(`/trips/${tripId}/route-detail`, `/api/trips/${tripId}/route-detail`),
        { params: { route_id: routeId, max_points: 4000 } },
      )
      const detail = res.data
      setTripDetails((current) => {
        const list = current[vehicleKey] || []
        if (list.some((row) => row.trip_id === tripId)) return current
        return { ...current, [vehicleKey]: [...list, detail] }
      })
      return detail
    } finally {
      setLoadingTripId((current) => (current === tripId ? null : current))
    }
  }, [apiFor])

  const selectVehicle = async (routeId, deviceId) => {
    const filters = routeFilter(routeId)
    const vehicleKey = `${routeId}:${deviceId}`
    const seq = ++vehicleLoadSeqRef.current
    setSelectedVehicleKey(vehicleKey)
    setIsolatedTripId(null)
    setLoadingTripId(null)
    setFloatPos(null)
    try {
      if (!routeDetails[routeId]) await loadRouteDetail(routeId)
      if (seq !== vehicleLoadSeqRef.current) return

      const tripListRes = await api.get(
        apiFor(
          `/routes/${routeId}/vehicles/${deviceId}/trips`,
          `/api/routes/${routeId}/vehicles/${deviceId}/trips`,
        ),
        { params: buildRangeParams(filters) },
      )
      if (seq !== vehicleLoadSeqRef.current) return

      const trips = tripListRes.data || []
      setRouteTrips((current) => ({ ...current, [vehicleKey]: trips }))

      // Load only the newest trip path first — fetching every trip's full
      // GPS trail was the main click lag on this page.
      if (trips.length === 0) return
      const firstTripId = trips[0].trip_id
      setIsolatedTripId(firstTripId)
      setDetailsPanelVisible(true)
      await ensureTripDetail(routeId, vehicleKey, firstTripId)
    } catch (err) {
      console.error('Failed to load route trips:', err)
    }
  }

  const selectedTripDetails = selectedVehicleKey ? (tripDetails[selectedVehicleKey] || []) : []
  const visibleRouteId = selectedVehicleKey ? Number(selectedVehicleKey.split(':')[0]) : expandedRouteId
  const activeRouteDetail = visibleRouteId ? routeDetails[visibleRouteId] : null
  const activeTripDetail = isolatedTripId
    ? selectedTripDetails.find((detail) => detail.trip_id === isolatedTripId) || null
    : null

  const isolateTrip = async (tripId) => {
    if (isolatedTripId === tripId) {
      setIsolatedTripId(null)
      return
    }
    setIsolatedTripId(tripId)
    setDetailsPanelVisible(true)
    setFloatPos(null)
    if (!selectedVehicleKey) return
    const routeId = Number(selectedVehicleKey.split(':')[0])
    try {
      await ensureTripDetail(routeId, selectedVehicleKey, tripId)
    } catch (err) {
      console.error('Failed to load trip route detail:', err)
    }
  }

  const selectOtherTrip = async (routeId, trip) => {
    const vehicleKey = otherVehicleKey(routeId)
    const seq = ++vehicleLoadSeqRef.current
    if (selectedVehicleKey === vehicleKey && isolatedTripId === trip.trip_id) {
      setIsolatedTripId(null)
      return
    }
    setSelectedVehicleKey(vehicleKey)
    setIsolatedTripId(trip.trip_id)
    setLoadingTripId(null)
    setFloatPos(null)
    setDetailsPanelVisible(true)
    try {
      if (!routeDetails[routeId]) await loadRouteDetail(routeId)
      if (seq !== vehicleLoadSeqRef.current) return
      await ensureTripDetail(routeId, vehicleKey, trip.trip_id)
    } catch (err) {
      console.error('Failed to load other trip route detail:', err)
    }
  }

  useEffect(() => {
    if (!dragging) return
    const pointerFromEvent = (event) => {
      const touch = event.touches?.[0] || event.changedTouches?.[0]
      if (touch) return { x: touch.clientX, y: touch.clientY }
      return { x: event.clientX, y: event.clientY }
    }
    const onMove = (event) => {
      const panel = floatPanelRef.current
      if (!panel) return
      const pointer = pointerFromEvent(event)
      const panelRect = panel.getBoundingClientRect()
      let left = pointer.x - dragOffsetRef.current.x
      let top = pointer.y - dragOffsetRef.current.y
      const maxLeft = Math.max(0, window.innerWidth - panelRect.width)
      const maxTop = Math.max(0, window.innerHeight - panelRect.height)
      left = Math.min(Math.max(0, left), maxLeft)
      top = Math.min(Math.max(0, top), maxTop)
      setFloatPos({ left, top })
      if (event.cancelable) event.preventDefault()
    }
    const onUp = () => setDragging(false)
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    window.addEventListener('touchmove', onMove, { passive: false })
    window.addEventListener('touchend', onUp)
    window.addEventListener('touchcancel', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      window.removeEventListener('touchmove', onMove)
      window.removeEventListener('touchend', onUp)
      window.removeEventListener('touchcancel', onUp)
    }
  }, [dragging])

  const onFloatHeaderPointerDown = (event) => {
    if (event.type === 'mousedown' && event.button !== 0) return
    if (event.target.closest('button')) return
    const panel = floatPanelRef.current
    if (!panel) return
    const touch = event.touches?.[0]
    const clientX = touch ? touch.clientX : event.clientX
    const clientY = touch ? touch.clientY : event.clientY
    const panelRect = panel.getBoundingClientRect()
    setFloatPos({
      left: panelRect.left,
      top: panelRect.top,
    })
    dragOffsetRef.current = {
      x: clientX - panelRect.left,
      y: clientY - panelRect.top,
    }
    setDragging(true)
    event.preventDefault()
  }

  const defaultFloatStyle = () => {
    const rect = mapPanelRef.current?.getBoundingClientRect()
    const isMobile = window.innerWidth <= 640
    const inset = isMobile ? 10 : 16
    if (!rect) return { top: inset, right: inset }
    return {
      top: rect.top + inset,
      right: window.innerWidth - rect.right + inset,
    }
  }

  const openCreate = () => {
    if (!canManageRoutes) return
    setEditRouteId(null)
    setShowBuilder(true)
  }

  const openEdit = (routeId) => {
    if (!canManageRoutes) return
    setEditRouteId(routeId)
    setShowBuilder(true)
  }

  const closeBuilder = () => {
    setShowBuilder(false)
    setEditRouteId(null)
  }

  const handleSavedRoute = async (routeId) => {
    await loadRoutes()
    if (editRouteId) {
      await loadRouteDetail(routeId)
      if (expandedRouteId === routeId) {
        await loadRouteVehicles(routeId, routeFilter(routeId))
      }
    } else {
      await expandRoute(routeId)
    }
  }

  const requestDeleteRoute = (route) => {
    if (!canManageRoutes) return
    setDeleteError(null)
    setDeleteTarget(route)
  }

  const cancelDeleteRoute = () => {
    if (deleteLoading) return
    setDeleteTarget(null)
    setDeleteError(null)
  }

  const confirmDeleteRoute = async () => {
    if (!canManageRoutes || !deleteTarget) return
    const route = deleteTarget
    setDeleteLoading(true)
    setDeleteError(null)
    try {
      await api.delete(apiFor(`/routes/${route.id}`, `/api/routes/${route.id}`))
      setRoutes((current) => current.filter((item) => item.id !== route.id))
      if (expandedRouteId === route.id) {
        setExpandedRouteId(null)
        setSelectedVehicleKey(null)
        setIsolatedTripId(null)
      } else if (selectedVehicleKey?.startsWith(`${route.id}:`)) {
        setSelectedVehicleKey(null)
        setIsolatedTripId(null)
      }
      setDeleteTarget(null)
    } catch (err) {
      setDeleteError(err.response?.data?.detail || 'Failed to delete route.')
    } finally {
      setDeleteLoading(false)
    }
  }

  const mapBody = activeRouteDetail ? (
    <>
      <RouteMap
        routePath={activeRouteDetail.path || []}
        tripDetails={selectedTripDetails}
        isolatedTripId={isolatedTripId}
        onSelectTrip={isolateTrip}
      />

      {loadingTripId && !activeTripDetail && (
        <div style={styles.mapHint}>Loading trip path…</div>
      )}

      {!activeTripDetail && !loadingTripId && (
        <div style={styles.mapHint}>
          {selectedTripDetails.length > 0
            ? 'Hover trip lines for context. Click a trip chip on the left to isolate it and highlight deviations.'
            : selectedVehicleKey
              ? 'Select a trip chip to overlay its path on the route.'
              : 'Select a vehicle from the left to overlay its matched trips on top of the route.'}
        </div>
      )}
    </>
  ) : (
    <EmptyState title="Select a route to inspect matches and draw it on the map." />
  )

  const mobileMapTitle = (
    routes.find((route) => route.id === visibleRouteId)?.name
    || activeRouteDetail?.name
    || 'Route map'
  )

  return (
    <div className="ft-page-stack ft-page-stack--fill ft-routes-page" style={styles.page}>
      <MobilePageHeading>{adminNavLabel('/admin/routes')}</MobilePageHeading>
      <AdminFilterBar />
      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title="Delete route?"
        message={[
          deleteTarget ? `Delete route "${deleteTarget.name}"? This cannot be undone.` : '',
          deleteError,
        ].filter(Boolean).join('\n\n')}
        confirmLabel="Delete"
        cancelLabel="Cancel"
        variant="danger"
        loading={deleteLoading}
        onConfirm={confirmDeleteRoute}
        onCancel={cancelDeleteRoute}
      />
      <style>
        {`
          .route-arrow-icon {
            background: none !important;
            border: none !important;
          }
          @media (max-width: 640px) {
            .route-trip-details {
              width: 168px !important;
              max-width: calc(100% - 20px) !important;
              border-radius: 10px !important;
              box-shadow: 0 6px 16px rgba(16,24,40,0.16) !important;
            }
            .route-trip-details__header {
              padding: 4px 6px !important;
              gap: 4px !important;
              touch-action: none;
              -webkit-user-select: none;
              user-select: none;
            }
            .route-trip-details__title {
              font-size: 10px !important;
              gap: 2px !important;
            }
            .route-trip-details__title svg {
              width: 10px !important;
              height: 10px !important;
            }
            .route-trip-details__panel {
              row-gap: 2px !important;
              column-gap: 4px !important;
              padding: 4px 6px 6px !important;
            }
            .route-trip-details__label {
              font-size: 8px !important;
              letter-spacing: 0.02em;
            }
            .route-trip-details__value {
              font-size: 10px !important;
              line-height: 1.2 !important;
            }
            .route-trip-details__close {
              width: 24px !important;
              height: 24px !important;
              min-width: 24px !important;
              min-height: 24px !important;
            }
            .route-trip-details__close svg {
              width: 10px !important;
              height: 10px !important;
            }
          }
        `}
      </style>
      <div
        className="ft-split-layout"
        style={{
          ...styles.body,
          ['--ft-split-aside']: isManager ? '320px' : '380px',
          ...(isManager && !isMobileLayout
            ? { gridTemplateColumns: 'minmax(0, 1fr) var(--ft-split-aside)' }
            : {}),
        }}
      >
        <Card
          className="ft-routes-list-panel"
          style={{ ...styles.listPanel, ...(isManager && !isMobileLayout ? { order: 2 } : {}) }}
        >
          <div
            style={{
              padding: '12px 14px',
              borderBottom: `1px solid ${tokens.border}`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 8,
            }}
          >
            <div style={{ fontSize: 13, fontWeight: 700, color: tokens.text }}>Routes</div>
            {canManageRoutes ? (
              <Button onClick={openCreate}>
                <Plus size={16} />
                Add Route
              </Button>
            ) : null}
          </div>
          {loading && routes.length === 0 ? (
            <LoadingState label="Loading routes…" />
          ) : routes.length === 0 ? (
            <EmptyState title="No routes yet" description="Create one to get started." />
          ) : (
            <div className="ft-routes-list-scroll" style={styles.list}>
              {routes.map((route) => {
                const expanded = expandedRouteId === route.id
                const vehicles = routeVehicles[route.id] || []
                const otherTrips = routeOtherTrips[route.id] || []
                const filters = routeFilter(route.id)
                const assignedVehicles = route.assigned_vehicles || []
                const detailReady = Boolean(routeDetails[route.id])
                const assignedSelected = Boolean(
                  selectedVehicleKey?.startsWith(`${route.id}:`)
                  && selectedVehicleKey !== otherVehicleKey(route.id),
                )
                return (
                  <div key={route.id} className="ft-admin-entity-card" style={styles.routeCard}>
                    <div style={styles.routeRow}>
                      <button type="button" style={styles.routeRowMain} onClick={() => expandRoute(route.id)}>
                        <div style={styles.routeIcon}>
                          <RouteIcon size={16} color={tokens.primary} />
                        </div>
                        <div style={{ flex: 1, minWidth: 0, textAlign: 'left' }}>
                          <div style={styles.routeName}>{route.name}</div>
                          {assignedVehicles.length >= 1 && assignedVehicles.length <= 2 && (
                            <div style={styles.vehiclePillRow}>
                              {assignedVehicles.map((vehicle) => (
                                <Badge key={vehicle.id} color={tokens.textMuted} background={tokens.background}>
                                  {vehicle.name} · {vehicle.driver_name || 'No driver'}
                                </Badge>
                              ))}
                            </div>
                          )}
                        </div>
                      </button>
                      {canManageRoutes && (
                        <div style={styles.routeRowActions}>
                          <Dropdown
                            align="right"
                            trigger={(
                              <IconButton label="Route actions" size="sm">
                                <MoreVertical size={14} />
                              </IconButton>
                            )}
                          >
                            <DropdownItem onClick={() => openEdit(route.id)}>
                              <Pencil size={13} />
                              Edit
                            </DropdownItem>
                            <DropdownItem danger onClick={() => requestDeleteRoute(route)}>
                              <Trash2 size={13} />
                              Delete
                            </DropdownItem>
                          </Dropdown>
                        </div>
                      )}
                    </div>

                    {expanded && (
                      <div style={styles.routeExpanded}>
                        <div style={styles.expandedHeader}>
                          <Filters value={filters} onChange={(updater) => updateRouteFilter(route.id, updater)} />
                        </div>
                        {vehicles.length === 0 && otherTrips.length === 0 ? (
                          <div style={styles.sectionEmpty}>No trips on this route in the selected window.</div>
                        ) : (
                          <>
                          {vehicles.length > 0 && (
                          <div style={styles.vehicleMatchList}>
                            {vehicles.map((vehicle) => {
                              const key = `${route.id}:${vehicle.device_id}`
                              const selected = selectedVehicleKey === key
                              return (
                                <button
                                  key={vehicle.device_id}
                                  type="button"
                                  style={{ ...styles.vehicleMatchRow, ...(selected ? styles.vehicleMatchRowActive : {}) }}
                                  onClick={() => selectVehicle(route.id, vehicle.device_id)}
                                >
                                  <div style={{ minWidth: 0 }}>
                                    <div style={styles.vehicleMatchName}>{vehicle.vehicle_name}</div>
                                    <div style={styles.vehicleMatchSub}>{vehicle.trip_count} matching trip(s)</div>
                                  </div>
                                </button>
                              )
                            })}
                          </div>
                          )}

                        {assignedSelected && (
                          <div style={styles.tripChipWrap}>
                            {(routeTrips[selectedVehicleKey] || []).map((trip) => (
                              <button
                                key={trip.trip_id}
                                type="button"
                                style={{
                                  ...styles.tripChip,
                                  ...(isolatedTripId === trip.trip_id ? styles.tripChipActive : {}),
                                }}
                                onClick={() => isolateTrip(trip.trip_id)}
                              >
                                Trip #{trip.trip_id} · {trip.date}
                              </button>
                            ))}
                          </div>
                        )}

                        {otherTrips.length > 0 && (
                          <div style={styles.otherTripsSection}>
                            <div style={styles.otherTripsHeading}>Other trips</div>
                            <div style={styles.otherTripChipWrap}>
                              {otherTrips.map((trip) => {
                                const selected = (
                                  selectedVehicleKey === otherVehicleKey(route.id)
                                  && isolatedTripId === trip.trip_id
                                )
                                return (
                                  <button
                                    key={trip.trip_id}
                                    type="button"
                                    style={{
                                      ...styles.tripChip,
                                      ...(selected ? styles.tripChipActive : {}),
                                    }}
                                    onClick={() => selectOtherTrip(route.id, trip)}
                                  >
                                    Trip #{trip.trip_id} · {trip.vehicle_name} · {trip.date}
                                  </button>
                                )
                              })}
                            </div>
                          </div>
                        )}
                          </>
                        )}

                        {isMobileLayout && detailReady && (
                          <Button
                            className="ft-routes-mobile-map-btn"
                            variant="secondary"
                            onClick={() => setMobileMapOpen(true)}
                          >
                            <Map size={16} />
                            View map
                          </Button>
                        )}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </Card>

        {!isMobileLayout && (
          <div
            ref={mapPanelRef}
            className="ft-routes-desktop-map"
            style={{
              minHeight: 0,
              height: '100%',
              display: 'flex',
              flexDirection: 'column',
              ...(isManager ? { order: 1 } : {}),
            }}
          >
            <Card style={{ ...styles.mapPanel, flex: 1, ...(isManager ? { minHeight: 'calc(100vh - 200px)' } : {}) }}>
              {mapBody}
            </Card>
          </div>
        )}
      </div>

      {mobileMapOpen && activeRouteDetail && createPortal(
        <div className="ft-routes-map-overlay" role="dialog" aria-modal="true" aria-label={mobileMapTitle}>
          <div className="ft-routes-map-overlay__bar">
            <div className="ft-routes-map-overlay__title">{mobileMapTitle}</div>
            <button
              type="button"
              className="ft-routes-map-overlay__close"
              onClick={() => setMobileMapOpen(false)}
              aria-label="Close map"
            >
              <X size={20} />
            </button>
          </div>
          <div className="ft-routes-map-overlay__map">
            <div style={{ ...styles.mapPanel, flex: 1, minHeight: 0, height: '100%', border: 'none', borderRadius: 0 }}>
              {mapBody}
            </div>
          </div>
        </div>,
        document.body,
      )}

      {activeTripDetail && detailsPanelVisible && !isMobileLayout && (
        <div
          ref={floatPanelRef}
          className="route-trip-details"
          style={{
            ...styles.metricsFloat,
            ...(floatPos
              ? { left: floatPos.left, top: floatPos.top, right: 'auto' }
              : defaultFloatStyle()),
          }}
        >
          <div
            className="route-trip-details__header"
            style={{
              ...styles.metricsFloatHeader,
              cursor: dragging ? 'grabbing' : 'grab',
              touchAction: 'none',
            }}
            onMouseDown={onFloatHeaderPointerDown}
            onTouchStart={onFloatHeaderPointerDown}
          >
            <span className="route-trip-details__title" style={styles.metricsFloatTitle}>
              <GripVertical size={12} />
              Trip details
            </span>
            <IconButton
              className="route-trip-details__close"
              label="Close"
              size="sm"
              onClick={() => setDetailsPanelVisible(false)}
            >
              <X size={12} />
            </IconButton>
          </div>
          <div className="route-trip-details__panel" style={styles.metricsPanel}>
            <div style={styles.metric}><span className="route-trip-details__label" style={styles.metricLabel}>Driver</span><span className="route-trip-details__value" style={styles.metricValue}>{activeTripDetail.driver_name || 'No driver'}</span></div>
            <div style={styles.metric}><span className="route-trip-details__label" style={styles.metricLabel}>Vehicle</span><span className="route-trip-details__value" style={styles.metricValue}>{activeTripDetail.vehicle_name}</span></div>
            <div style={styles.metric}><span className="route-trip-details__label" style={styles.metricLabel}>Distance</span><span className="route-trip-details__value" style={styles.metricValue}>{activeTripDetail.distance_km ?? '—'} km</span></div>
            <div style={styles.metric}><span className="route-trip-details__label" style={styles.metricLabel}>Speed</span><span className="route-trip-details__value" style={styles.metricValue}>{activeTripDetail.avg_speed_kmh ?? '—'} km/h</span></div>
            <div style={styles.metric}><span className="route-trip-details__label" style={styles.metricLabel}>Time</span><span className="route-trip-details__value" style={styles.metricValue}>{activeTripDetail.duration_min ?? '—'} min</span></div>
            <div style={styles.metric}><span className="route-trip-details__label" style={styles.metricLabel}>Fuel Avg</span><span className="route-trip-details__value" style={styles.metricValue}>{activeTripDetail.fuel_avg ?? '—'} L/km</span></div>
            <div style={styles.metric}><span className="route-trip-details__label" style={styles.metricLabel}>Fuel Cost</span><span className="route-trip-details__value" style={styles.metricValue}>{activeTripDetail.fuel_cost_pkr ?? '—'} PKR</span></div>
            <div style={styles.metric}><span className="route-trip-details__label" style={styles.metricLabel}>Price/L</span><span className="route-trip-details__value" style={styles.metricValue}>{activeTripDetail.price_per_liter_used ?? '—'} PKR</span></div>
          </div>
        </div>
      )}

      {showBuilder && canManageRoutes && (
        <RouteBuilderModal
          editRouteId={editRouteId}
          onClose={closeBuilder}
          onSaved={handleSavedRoute}
        />
      )}
    </div>
  )
}

const makeRouteStyles = (tokens) => ({
  page: {
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
    minHeight: 0,
    overflow: 'hidden',
    gap: 14,
  },
  body: {
    flex: 1,
    minHeight: 0,
    gap: 16,
  },
  listPanel: {
    padding: 0,
    overflow: 'hidden',
    display: 'flex',
    flexDirection: 'column',
    minHeight: 0,
  },
  list: {
    flex: 1,
    overflowY: 'auto',
    padding: 10,
  },
  routeCard: {
    border: `1px solid ${tokens.border}`,
    borderRadius: tokens.radius.md,
    overflow: 'hidden',
    background: tokens.surface,
    marginBottom: 10,
  },
  routeRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    background: tokens.surface,
  },
  routeRowMain: {
    flex: 1,
    minWidth: 0,
    border: 'none',
    background: 'transparent',
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    padding: '14px 8px 14px 14px',
    cursor: 'pointer',
  },
  routeRowActions: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    paddingRight: 12,
    flexShrink: 0,
  },
  routeIcon: {
    width: 34,
    height: 34,
    borderRadius: tokens.radius.sm,
    background: tokens.primarySoft,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  routeName: {
    fontSize: 14,
    fontWeight: 700,
    color: tokens.text,
  },
  vehiclePillRow: {
    display: 'flex',
    gap: 8,
    flexWrap: 'wrap',
    marginTop: 6,
  },
  routeExpanded: {
    borderTop: `1px solid ${tokens.border}`,
    padding: 12,
    background: tokens.background,
  },
  expandedHeader: {
    marginBottom: 4,
  },
  vehicleMatchList: {
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
  },
  vehicleMatchRow: {
    border: `1px solid ${tokens.border}`,
    borderRadius: tokens.radius.md,
    background: tokens.surface,
    padding: '10px 12px',
    cursor: 'pointer',
    textAlign: 'left',
  },
  vehicleMatchRowActive: {
    background: tokens.primarySoft,
    borderColor: tokens.primary,
  },
  vehicleMatchName: {
    fontSize: 13,
    fontWeight: 700,
    color: tokens.text,
  },
  vehicleMatchSub: {
    fontSize: 11,
    color: tokens.textMuted,
    marginTop: 2,
  },
  otherTripsSection: {
    marginTop: 12,
  },
  otherTripsHeading: {
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: '0.04em',
    textTransform: 'uppercase',
    color: tokens.textMuted,
    marginBottom: 8,
  },
  tripChipWrap: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 12,
  },
  otherTripChipWrap: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 8,
  },
  tripChip: {
    border: `1px solid ${tokens.border}`,
    background: tokens.surface,
    borderRadius: 999,
    padding: '6px 10px',
    fontSize: 11,
    fontWeight: 700,
    color: tokens.textMuted,
    cursor: 'pointer',
  },
  tripChipActive: {
    background: tokens.primary,
    borderColor: tokens.primary,
    color: '#fff',
  },
  mapPanel: {
    position: 'relative',
    padding: 0,
    overflow: 'hidden',
    display: 'flex',
    flexDirection: 'column',
    minHeight: 0,
  },
  metricsFloat: {
    position: 'fixed',
    width: 228,
    maxWidth: 'calc(100% - 32px)',
    maxHeight: 'calc(100% - 32px)',
    overflow: 'auto',
    background: tokens.surface,
    border: `1px solid ${tokens.border}`,
    borderRadius: tokens.radius.lg,
    boxShadow: '0 10px 28px rgba(16,24,40,0.18), 0 2px 8px rgba(16,24,40,0.10)',
    zIndex: 1000,
    boxSizing: 'border-box',
  },
  metricsFloatHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 6,
    padding: '7px 10px',
    borderBottom: `1px solid ${tokens.border}`,
    userSelect: 'none',
    position: 'sticky',
    top: 0,
    background: tokens.surface,
    zIndex: 1,
  },
  metricsFloatTitle: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 4,
    fontSize: 11,
    fontWeight: 700,
    color: tokens.text,
  },
  metricsPanel: {
    display: 'grid',
    gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
    rowGap: 4,
    columnGap: 2,
    padding: 6,
  },
  metric: {
    display: 'flex',
    flexDirection: 'column',
    gap: 0,
  },
  metricLabel: {
    fontSize: 9,
    color: tokens.textMuted,
    fontWeight: 700,
    textTransform: 'uppercase',
  },
  metricValue: {
    fontSize: 12,
    color: tokens.text,
    fontWeight: 600,
  },
  mapHint: {
    position: 'absolute',
    left: 16,
    right: 16,
    bottom: 16,
    padding: '10px 14px',
    background: tokens.surface,
    border: `1px solid ${tokens.border}`,
    borderRadius: tokens.radius.md,
    boxShadow: tokens.shadow.card,
    fontSize: 13,
    color: tokens.textMuted,
    zIndex: 4,
  },
  sectionEmpty: {
    fontSize: 12,
    color: tokens.textDisabled,
    padding: '6px 0',
  },
})

export default RoutesPage
