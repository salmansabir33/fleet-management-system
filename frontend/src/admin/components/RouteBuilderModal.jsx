import { useEffect, useMemo, useRef, useState, Fragment } from 'react'
import { Route as RouteIcon, Check, RefreshCw } from 'lucide-react'
import { CircleMarker, MapContainer, Marker, Polyline, TileLayer, Tooltip, useMap, useMapEvents } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import api from '../../api'
import { Modal, Input, Button, Tabs } from '../../shared/components'
import { useTheme } from '../../theme'
import { usePanelScope } from '../../manager/hooks/usePanelScope'

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

const waypointIcon = (index) => L.divIcon({
  className: '',
  html: `
    <div style="
      width:24px;height:24px;border-radius:50%;
      background:var(--ft-primary);color:var(--ft-surface);
      display:flex;align-items:center;justify-content:center;
      border:2px solid var(--ft-surface);box-shadow:var(--ft-shadow-md);
      font-size:11px;font-weight:700;
    ">${index + 1}</div>
  `,
  iconSize: [24, 24],
  iconAnchor: [12, 12],
})

const ghostIcon = L.divIcon({
  className: '',
  html: `
    <div style="
      width:14px;height:14px;border-radius:50%;
      background:var(--ft-surface);border:2px solid var(--ft-primary);
      box-shadow:var(--ft-shadow-sm);
    "></div>
  `,
  iconSize: [14, 14],
  iconAnchor: [7, 7],
})

const escapeHtml = (value) => String(value)
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')

const liveLabelIcon = (name) => L.divIcon({
  className: 'route-live-label',
  html: `
    <div style="
      font-size:10px;font-weight:600;color:var(--ft-text-muted);
      white-space:nowrap;line-height:1.2;
      padding:1px 5px;border-radius:3px;
      background:color-mix(in srgb, var(--ft-surface) 88%, transparent);
      box-shadow:var(--ft-shadow-xs);
    ">${escapeHtml(name)}</div>
  `,
  iconSize: [0, 0],
  iconAnchor: [-8, 6],
})

const nearestPathIndex = (point, path) => {
  let bestIndex = 0
  let bestDistance = Infinity
  const origin = L.latLng(point.lat, point.lon)
  path.forEach((candidate, index) => {
    const distance = origin.distanceTo(L.latLng(candidate.lat, candidate.lon))
    if (distance < bestDistance) {
      bestDistance = distance
      bestIndex = index
    }
  })
  return bestIndex
}

const minDistanceToStretch = (latlng, path, startIndex, endIndex) => {
  let start = Math.min(startIndex, endIndex)
  let end = Math.max(startIndex, endIndex)
  if (start === end) {
    end = Math.min(path.length - 1, start + 1)
  }
  let best = Infinity
  for (let index = start; index <= end; index += 1) {
    const distance = latlng.distanceTo(L.latLng(path[index].lat, path[index].lon))
    if (distance < best) best = distance
  }
  return best
}

const findInsertIndex = (latlng, waypoints, previewPath) => {
  if (waypoints.length < 2 || previewPath.length < 2) return 1

  const waypointPathIndexes = waypoints.map((point) => nearestPathIndex(point, previewPath))
  let bestPair = 0
  let bestDistance = Infinity
  for (let pair = 0; pair < waypoints.length - 1; pair += 1) {
    const distance = minDistanceToStretch(
      latlng,
      previewPath,
      waypointPathIndexes[pair],
      waypointPathIndexes[pair + 1],
    )
    if (distance < bestDistance) {
      bestDistance = distance
      bestPair = pair
    }
  }
  return bestPair + 1
}

const ClickCapture = ({ onAddPoint, suppressRef }) => {
  useMapEvents({
    click(e) {
      if (suppressRef.current) {
        suppressRef.current = false
        return
      }
      onAddPoint({ lat: e.latlng.lat, lon: e.latlng.lng })
    },
  })
  return null
}

const InitialFit = ({ points }) => {
  const map = useMap()
  const doneRef = useRef(false)

  useEffect(() => {
    if (doneRef.current || !points || points.length < 1) return
    const bounds = L.latLngBounds(points.map((point) => [point.lat, point.lon]))
    doneRef.current = true
    map.invalidateSize()
    if (points.length === 1) {
      map.setView([points[0].lat, points[0].lon], 13)
    } else {
      map.fitBounds(bounds, { padding: [36, 36] })
    }
  }, [map, points])

  return null
}

const InvalidateOnShow = ({ active }) => {
  const map = useMap()
  useEffect(() => {
    if (!active) return undefined
    const timer = window.setTimeout(() => map.invalidateSize(), 60)
    return () => window.clearTimeout(timer)
  }, [active, map])
  return null
}

const MOBILE_PANES = [
  { id: 'map', label: 'Map' },
  { id: 'details', label: 'Details' },
]

const PathBendLayer = ({ previewPath, waypoints, onInsert, suppressClickRef }) => {
  const map = useMap()
  const { tokens } = useTheme()
  const mapAccent = tokens.mapAccent
  const [ghost, setGhost] = useState(null)
  const dragRef = useRef(null)
  const waypointsRef = useRef(waypoints)
  const previewPathRef = useRef(previewPath)
  const onInsertRef = useRef(onInsert)

  waypointsRef.current = waypoints
  previewPathRef.current = previewPath
  onInsertRef.current = onInsert

  useEffect(() => {
    const finish = (latlng) => {
      const drag = dragRef.current
      if (!drag) return
      dragRef.current = null
      map.dragging.enable()
      map.getContainer().style.cursor = ''
      setGhost(null)
      if (!latlng) return
      onInsertRef.current(drag.insertAt, { lat: latlng.lat, lon: latlng.lng })
    }

    const onMapMouseMove = (e) => {
      if (!dragRef.current) return
      setGhost({ lat: e.latlng.lat, lon: e.latlng.lng })
    }

    const onWindowMouseUp = (event) => {
      if (!dragRef.current) return
      finish(map.mouseEventToLatLng(event))
    }

    map.on('mousemove', onMapMouseMove)
    window.addEventListener('mouseup', onWindowMouseUp)
    return () => {
      map.off('mousemove', onMapMouseMove)
      window.removeEventListener('mouseup', onWindowMouseUp)
      if (dragRef.current) {
        dragRef.current = null
        map.dragging.enable()
      }
    }
  }, [map])

  const positions = previewPath.map((point) => [point.lat, point.lon])

  const startBend = (e) => {
    if (e.originalEvent) L.DomEvent.stop(e.originalEvent)
    suppressClickRef.current = true
    const insertAt = findInsertIndex(e.latlng, waypointsRef.current, previewPathRef.current)
    dragRef.current = { insertAt }
    map.dragging.disable()
    map.getContainer().style.cursor = 'grabbing'
    setGhost({ lat: e.latlng.lat, lon: e.latlng.lng })
  }

  return (
    <>
      <Polyline
        positions={positions}
        pathOptions={{ color: mapAccent, weight: 5, opacity: 0.9 }}
        interactive={false}
      />
      <Polyline
        positions={positions}
        pathOptions={{ color: mapAccent, weight: 16, opacity: 0, className: 'route-preview-path' }}
        eventHandlers={{
          mousedown: startBend,
          click: (e) => { if (e.originalEvent) L.DomEvent.stop(e.originalEvent) },
          mouseover: () => {
            if (!dragRef.current) map.getContainer().style.cursor = 'grab'
          },
          mouseout: () => {
            if (!dragRef.current) map.getContainer().style.cursor = ''
          },
        }}
      />
      {ghost && (
        <Marker position={[ghost.lat, ghost.lon]} icon={ghostIcon} interactive={false} />
      )}
    </>
  )
}

const RouteBuilderModal = ({ onClose, onSaved, editRouteId }) => {
  const { tokens } = useTheme()
  const { isManager, apiFor, can } = usePanelScope()
  const isEdit = editRouteId != null
  const [name, setName] = useState('')
  const [directionLabel, setDirectionLabel] = useState('')
  const [toleranceMeters, setToleranceMeters] = useState(400)
  const [waypoints, setWaypoints] = useState([])
  const [previewPath, setPreviewPath] = useState([])
  const [livePositions, setLivePositions] = useState([])
  const [devices, setDevices] = useState([])
  const [currentRouteByDevice, setCurrentRouteByDevice] = useState({})
  const [selectedDeviceIds, setSelectedDeviceIds] = useState([])
  const [loadingDevices, setLoadingDevices] = useState(true)
  const [loadingRoute, setLoadingRoute] = useState(Boolean(editRouteId))
  const [previewing, setPreviewing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [recalculating, setRecalculating] = useState(false)
  const [recalcError, setRecalcError] = useState(null)
  const [error, setError] = useState(null)
  const [mobilePane, setMobilePane] = useState('map')
  const waypointsRef = useRef(waypoints)
  const previewSeqRef = useRef(0)
  const suppressMapClickRef = useRef(false)
  const originalAssignedIdsRef = useRef([])
  waypointsRef.current = waypoints

  useEffect(() => {
    let cancelled = false
    const loadDevices = async () => {
      try {
        if (isManager) {
          if (!can('live_tracking')) {
            if (!cancelled) setDevices([])
            return
          }
          // Manager vehicles live-feed → normalize to DeviceOut-ish shape
          // (same pattern as AssignVehicleModal).
          const res = await api.get(apiFor('/vehicles', '/api/fleet/devices'))
          const live = res.data.live || []
          if (!cancelled) {
            setDevices(live
              .filter((item) => item.db_id != null)
              .map((item) => ({
                id: item.db_id,
                name: item.device?.name,
                plate_number: item.plate_number,
              })))
          }
        } else {
          const res = await api.get('/api/fleet/devices')
          if (!cancelled) setDevices(res.data || [])
        }
      } catch {
        if (!cancelled) setError('Failed to load vehicles for assignment.')
      } finally {
        if (!cancelled) setLoadingDevices(false)
      }
    }
    loadDevices()
    return () => { cancelled = true }
  }, [isManager, apiFor, can])

  useEffect(() => {
    let cancelled = false
    const loadCurrentAssignments = async () => {
      try {
        const res = await api.get(apiFor('/routes', '/api/routes'))
        if (cancelled) return
        const map = {}
        for (const route of res.data || []) {
          for (const vehicle of route.assigned_vehicles || []) {
            map[Number(vehicle.id)] = { routeId: route.id, routeName: route.name }
          }
        }
        setCurrentRouteByDevice(map)
      } catch {
        if (!cancelled) setCurrentRouteByDevice({})
      }
    }
    loadCurrentAssignments()
    return () => { cancelled = true }
  }, [apiFor])

  useEffect(() => {
    if (!editRouteId) return undefined
    let cancelled = false
    const loadRoute = async () => {
      setLoadingRoute(true)
      try {
        const res = await api.get(apiFor(`/routes/${editRouteId}`, `/api/routes/${editRouteId}`))
        if (cancelled) return
        const route = res.data
        setName(route.name || '')
        setDirectionLabel(route.direction_label || '')
        setToleranceMeters(route.tolerance_meters ?? 400)
        const points = route.waypoints || []
        waypointsRef.current = points
        setWaypoints(points)
        setPreviewPath(route.path || [])
        const assignedIds = (route.assigned_vehicles || []).map((vehicle) => Number(vehicle.id))
        originalAssignedIdsRef.current = assignedIds
        setSelectedDeviceIds(assignedIds)
      } catch (err) {
        if (!cancelled) setError(err.response?.data?.detail || 'Failed to load route.')
      } finally {
        if (!cancelled) setLoadingRoute(false)
      }
    }
    loadRoute()
    return () => { cancelled = true }
  }, [editRouteId, apiFor])

  useEffect(() => {
    let cancelled = false
    const loadLive = async () => {
      if (!can('live_tracking')) {
        setLivePositions([])
        return
      }
      try {
        const res = await api.get(apiFor('/vehicles', '/api/live'))
        if (cancelled) return
        const items = res.data?.live || []
        setLivePositions(
          items
            .filter((item) => item.position?.latitude != null && item.position?.longitude != null)
            .map((item, index) => ({
              id: item.db_id ?? item.device?.id ?? `live-${index}`,
              name: item.device?.name || 'Vehicle',
              lat: item.position.latitude,
              lon: item.position.longitude,
            }))
        )
      } catch {
        // Reference layer only — a failed fetch should not block route building.
      }
    }
    loadLive()
    return () => { cancelled = true }
  }, [apiFor, can])

  const toggleDevice = (deviceId) => {
    const id = Number(deviceId)
    setSelectedDeviceIds((current) => (
      current.some((item) => Number(item) === id)
        ? current.filter((item) => Number(item) !== id)
        : [...current, id]
    ))
  }

  const previewRouteFor = async (points) => {
    if (points.length < 2) {
      setError('Place at least a start point and an end point on the map.')
      return
    }
    const seq = ++previewSeqRef.current
    setPreviewing(true)
    setError(null)
    try {
      const res = await api.post(apiFor('/routes/preview', '/api/routes/preview'), {
        name: name || 'Preview Route',
        direction_label: directionLabel || null,
        tolerance_meters: Number(toleranceMeters) || 400,
        waypoints: points,
      })
      if (seq !== previewSeqRef.current) return
      setPreviewPath(res.data.path || [])
    } catch (err) {
      if (seq !== previewSeqRef.current) return
      setError(err.response?.data?.detail || 'Failed to preview route.')
    } finally {
      if (seq === previewSeqRef.current) setPreviewing(false)
    }
  }

  const commitWaypoints = (next, { preview = false, clearPreview = false } = {}) => {
    waypointsRef.current = next
    setWaypoints(next)
    if (clearPreview) setPreviewPath([])
    if (preview) previewRouteFor(next)
  }

  const addPoint = (point) => {
    commitWaypoints([...waypointsRef.current, point], { clearPreview: true })
  }

  const updateWaypoint = (index, point) => {
    commitWaypoints(
      waypointsRef.current.map((item, itemIndex) => (itemIndex === index ? point : item)),
      { preview: true },
    )
  }

  const insertWaypoint = (index, point) => {
    const current = waypointsRef.current
    commitWaypoints(
      [...current.slice(0, index), point, ...current.slice(index)],
      { preview: true },
    )
  }

  const removeLastPoint = () => {
    commitWaypoints(waypointsRef.current.slice(0, -1), { clearPreview: true })
  }

  const previewRoute = () => {
    previewRouteFor(waypointsRef.current)
  }

  const saveRoute = async () => {
    if (!name.trim()) {
      setError('Route name is required.')
      setMobilePane('details')
      return
    }
    if (waypoints.length < 2) {
      setError('Place at least a start point and an end point on the map.')
      setMobilePane('map')
      return
    }

    setSaving(true)
    setError(null)
    try {
      const payload = {
        name: name.trim(),
        direction_label: directionLabel.trim() || null,
        tolerance_meters: Number(toleranceMeters) || 400,
        waypoints,
      }

      if (isEdit) {
        await api.patch(apiFor(`/routes/${editRouteId}`, `/api/routes/${editRouteId}`), payload)
        const original = new Set(originalAssignedIdsRef.current.map(Number))
        const next = new Set(selectedDeviceIds.map(Number))
        for (const deviceId of next) {
          if (!original.has(deviceId)) {
            await api.post(
              apiFor(`/routes/${editRouteId}/vehicles`, `/api/routes/${editRouteId}/vehicles`),
              { device_id: deviceId },
            )
          }
        }
        for (const deviceId of original) {
          if (!next.has(deviceId)) {
            await api.delete(
              apiFor(
                `/routes/${editRouteId}/vehicles/${deviceId}`,
                `/api/routes/${editRouteId}/vehicles/${deviceId}`,
              ),
            )
          }
        }
        onSaved?.(editRouteId)
      } else {
        const res = await api.post(apiFor('/routes', '/api/routes'), payload)
        const route = res.data
        for (const deviceId of selectedDeviceIds) {
          await api.post(
            apiFor(`/routes/${route.id}/vehicles`, `/api/routes/${route.id}/vehicles`),
            { device_id: deviceId },
          )
        }
        onSaved?.(route.id)
      }
      onClose()
    } catch (err) {
      setError(err.response?.data?.detail || (isEdit ? 'Failed to update route.' : 'Failed to save route.'))
    } finally {
      setSaving(false)
    }
  }

  const recalculateMatches = async () => {
    if (!isEdit) return
    setRecalculating(true)
    setRecalcError(null)
    try {
      await api.post(
        apiFor(`/routes/${editRouteId}/recalculate`, `/api/routes/${editRouteId}/recalculate`),
      )
      onSaved?.(editRouteId)
    } catch (err) {
      setRecalcError(err.response?.data?.detail || 'Failed to recalculate matches.')
    } finally {
      setRecalculating(false)
    }
  }

  const center = useMemo(() => (
    waypoints[0] ? [waypoints[0].lat, waypoints[0].lon] : DEFAULT_CENTER
  ), [waypoints])

  return (
    <>
      <style>
        {`
          .route-builder-modal { max-width: 1220px !important; height: 90vh; }
          .route-builder-modal > div:nth-child(2) {
            padding: 0 !important;
            overflow: hidden !important;
            display: flex;
            flex-direction: column;
            min-height: 0;
            flex: 1;
          }
          .route-builder-layout {
            flex: 1;
            min-height: 0;
            display: grid;
            grid-template-columns: 340px 1fr;
          }
          .route-builder-form {
            border-right: 1px solid var(--ft-border);
            padding: 20px;
            overflow-y: auto;
            min-height: 0;
          }
          .route-builder-map {
            display: flex;
            flex-direction: column;
            min-height: 0;
          }
          .route-builder-help {
            margin: 0 20px 12px;
            font-size: 13px;
            color: var(--ft-text-secondary);
          }
          .route-builder-error {
            margin: 0 20px 12px;
            padding: 10px 12px;
            border-radius: 8px;
            font-size: 13px;
          }
          .route-builder-point-actions {
            display: flex;
            gap: 10px;
            margin-bottom: 10px;
          }
          .route-builder-vehicles {
            border: 1px solid var(--ft-border);
            border-radius: 10px;
            overflow: auto;
            max-height: 240px;
          }
          .route-builder-map-hint {
            padding: 10px 14px;
            border-top: 1px solid var(--ft-border);
            font-size: 12px;
            color: var(--ft-text-secondary);
          }
          .route-builder-mobile-tabs {
            display: none;
          }
          .route-builder-map-toolbar {
            display: none;
          }
          .route-builder-recalc {
            display: flex;
            flex-direction: column;
            align-items: flex-start;
            gap: 4px;
            margin-right: auto;
          }
          .route-preview-path {
            cursor: grab !important;
          }
          .route-live-label {
            background: none !important;
            border: none !important;
          }
          @media (prefers-reduced-motion: no-preference) {
            @keyframes route-recalc-spin {
              from { transform: rotate(0deg); }
              to { transform: rotate(360deg); }
            }
          }
          @media (max-width: 640px) {
            .route-builder-modal {
              width: 100% !important;
              max-width: 100% !important;
              height: min(92vh, 100%) !important;
              max-height: min(92vh, 100%) !important;
              border-radius: 16px 16px 12px 12px !important;
            }
            .route-builder-modal > div:first-child {
              padding: 12px 14px 0 !important;
            }
            .route-builder-modal > div:first-child h3 {
              font-size: 16px !important;
            }
            .route-builder-modal > div:last-child {
              flex-direction: column;
              align-items: stretch;
              gap: 8px;
              padding: 12px 12px 14px !important;
            }
            .route-builder-modal > div:last-child .ft-btn {
              width: 100%;
              justify-content: center;
            }
            .route-builder-recalc {
              width: 100%;
              margin-right: 0;
              order: 3;
            }
            .route-builder-recalc .ft-btn {
              width: 100%;
              justify-content: center;
            }
            .route-builder-mobile-tabs {
              display: block;
              padding: 8px 12px 0;
              flex-shrink: 0;
            }
            .route-builder-mobile-tabs .ft-tabs {
              width: 100%;
            }
            .route-builder-help {
              display: none;
            }
            .route-builder-error {
              margin: 0 12px 8px;
              padding: 8px 10px;
              font-size: 12px;
            }
            .route-builder-layout {
              grid-template-columns: 1fr;
              grid-template-rows: minmax(0, 1fr);
            }
            .route-builder-layout--map .route-builder-form {
              display: none;
            }
            .route-builder-layout--details .route-builder-map {
              display: none;
            }
            .route-builder-map {
              order: 0;
              border-bottom: none;
              min-height: 0;
            }
            .route-builder-map-hint {
              display: none;
            }
            .route-builder-map-toolbar {
              display: flex;
              flex-wrap: wrap;
              align-items: center;
              gap: 8px;
              padding: 8px 12px;
              border-top: 1px solid var(--ft-border);
              flex-shrink: 0;
            }
            .route-builder-map-toolbar .ft-btn {
              flex: 1 1 auto;
              justify-content: center;
              min-height: 36px;
            }
            .route-builder-map-status {
              width: 100%;
              font-size: 11px;
              color: var(--ft-text-secondary);
            }
            .route-builder-form {
              border-right: none;
              padding: 12px;
            }
            .route-builder-point-actions {
              flex-direction: column;
              gap: 8px;
            }
            .route-builder-point-actions .ft-btn {
              width: 100%;
              justify-content: center;
            }
            .route-builder-vehicles {
              max-height: none;
            }
          }
        `}
      </style>
      <Modal
        open
        onClose={onClose}
        title={isEdit ? 'Edit Route' : 'Add Route'}
        size="lg"
        className="route-builder-modal"
        footer={(
          <>
            {isEdit && (
              <div className="route-builder-recalc">
                <Button
                  variant="secondary"
                  disabled={recalculating || saving || loadingRoute}
                  onClick={recalculateMatches}
                  loading={recalculating}
                >
                  <RefreshCw size={14} />
                  Recalculate matches
                </Button>
                {recalcError && (
                  <div style={{ fontSize: 11, color: tokens.semantic.danger }}>{recalcError}</div>
                )}
              </div>
            )}
            <Button variant="secondary" onClick={previewRoute} loading={previewing} disabled={saving}>
              Preview Path
            </Button>
            <Button onClick={saveRoute} loading={saving} disabled={loadingRoute}>
              <RouteIcon size={16} />
              {isEdit ? 'Save Changes' : 'Save Route'}
            </Button>
          </>
        )}
      >
        <div className="route-builder-mobile-tabs">
          <Tabs
            items={MOBILE_PANES}
            value={mobilePane}
            onChange={setMobilePane}
          />
        </div>

        <p className="route-builder-help">
          Click a start point, optional must-pass waypoints, and an end point. Drag the numbered markers, or grab the previewed path, to adjust before saving.
        </p>

        {error && (
          <div
            className="route-builder-error"
            style={{
              background: `${tokens.semantic.danger}18`,
              color: tokens.semantic.danger,
            }}
          >
            {error}
          </div>
        )}

        <div className={`route-builder-layout route-builder-layout--${mobilePane}`}>
          <div className="route-builder-form">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginBottom: 14 }}>
              <Input
                label="Name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Depot to Multan"
              />

              <Input
                label="Direction Label"
                value={directionLabel}
                onChange={(e) => setDirectionLabel(e.target.value)}
                placeholder="Depot → Multan"
              />

              <Input
                label="Tolerance (meters)"
                type="number"
                min="50"
                step="10"
                value={toleranceMeters}
                onChange={(e) => setToleranceMeters(e.target.value)}
              />
            </div>

            <div className="route-builder-point-actions">
              <Button variant="secondary" onClick={removeLastPoint} disabled={waypoints.length === 0}>
                Remove Last Point
              </Button>
              <Button
                variant="secondary"
                onClick={() => commitWaypoints([], { clearPreview: true })}
                disabled={waypoints.length === 0}
              >
                Clear
              </Button>
            </div>

            <div style={{ fontSize: 12, color: tokens.textSecondary, marginBottom: 16 }}>
              {loadingRoute
                ? 'Loading route...'
                : waypoints.length === 0
                  ? 'Click the map to place the route points.'
                  : `${waypoints.length} point(s) placed.`}
            </div>

            <div style={{ marginTop: 20 }}>
              <div style={{
                fontSize: 12,
                fontWeight: 700,
                color: tokens.textSecondary,
                textTransform: 'uppercase',
                letterSpacing: 0.3,
                marginBottom: 10,
              }}
              >
                Assign Vehicles
              </div>
              <div className="route-builder-vehicles">
                {loadingDevices ? (
                  <div style={{ padding: 16, fontSize: 13, color: tokens.textSecondary, textAlign: 'center' }}>
                    Loading vehicles...
                  </div>
                ) : devices.length === 0 ? (
                  <div style={{ padding: 16, fontSize: 13, color: tokens.textSecondary, textAlign: 'center' }}>
                    No vehicles available.
                  </div>
                ) : devices.map((device) => {
                  const selected = selectedDeviceIds.some((id) => Number(id) === Number(device.id))
                  const current = currentRouteByDevice[Number(device.id)]
                  const onOtherRoute = current && Number(current.routeId) !== Number(editRouteId)
                  return (
                    <button
                      key={device.id}
                      type="button"
                      onClick={() => toggleDevice(device.id)}
                      style={{
                        width: '100%',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: 10,
                        border: 'none',
                        borderBottom: `1px solid ${tokens.border}`,
                        background: selected ? `${tokens.primary}14` : tokens.surface,
                        cursor: 'pointer',
                        padding: '10px 12px',
                        textAlign: 'left',
                      }}
                    >
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 600, color: tokens.text }}>{device.name}</div>
                        <div style={{ fontSize: 11, color: tokens.textSecondary, marginTop: 2 }}>
                          {device.plate_number || 'No plate'}
                          {onOtherRoute ? ` · currently on ${current.routeName}` : ''}
                        </div>
                      </div>
                      {selected && <Check size={15} color={tokens.primary} />}
                    </button>
                  )
                })}
              </div>
            </div>
          </div>

          <div className="route-builder-map">
            <MapContainer
              center={center}
              zoom={13}
              style={{ flex: 1, width: '100%', minHeight: 0, background: '#eef1f5' }}
              scrollWheelZoom
            >
              <TileLayer
                attribution={TILE_ATTRIBUTION}
                url={TILE_URL}
                subdomains="abcd"
                maxZoom={19}
                {...TILE_EXTRA_PROPS}
              />
              <ClickCapture onAddPoint={addPoint} suppressRef={suppressMapClickRef} />
              <InvalidateOnShow active={mobilePane === 'map'} />
              {isEdit && !loadingRoute && (previewPath.length > 1 || waypoints.length > 0) && (
                <InitialFit points={previewPath.length > 1 ? previewPath : waypoints} />
              )}
              {livePositions.map((position) => (
                <Fragment key={`live-${position.id}`}>
                  <CircleMarker
                    center={[position.lat, position.lon]}
                    radius={5}
                    pathOptions={{
                      color: '#64748b',
                      fillColor: '#94a3b8',
                      fillOpacity: 0.9,
                      weight: 1,
                    }}
                    interactive={false}
                  />
                  <Marker
                    position={[position.lat, position.lon]}
                    icon={liveLabelIcon(position.name)}
                    interactive={false}
                    keyboard={false}
                  />
                </Fragment>
              ))}
              {previewPath.length > 1 && (
                <PathBendLayer
                  previewPath={previewPath}
                  waypoints={waypoints}
                  onInsert={insertWaypoint}
                  suppressClickRef={suppressMapClickRef}
                />
              )}
              {waypoints.map((point, index) => (
                <Marker
                  key={`${index}-${point.lat}-${point.lon}`}
                  position={[point.lat, point.lon]}
                  icon={waypointIcon(index)}
                  draggable
                  eventHandlers={{
                    dragend: (event) => {
                      const latlng = event.target.getLatLng()
                      updateWaypoint(index, { lat: latlng.lat, lon: latlng.lng })
                    },
                  }}
                >
                  <Tooltip direction="top" offset={[0, -12]}>
                    {index === 0 ? 'Start' : index === waypoints.length - 1 ? 'End' : `Waypoint ${index}`}
                  </Tooltip>
                </Marker>
              ))}
            </MapContainer>
            <div className="route-builder-map-toolbar">
              <div className="route-builder-map-status">
                {loadingRoute
                  ? 'Loading route...'
                  : waypoints.length === 0
                    ? 'Tap the map to place start and end points.'
                    : `${waypoints.length} point(s) placed.`}
              </div>
              <Button variant="secondary" onClick={removeLastPoint} disabled={waypoints.length === 0}>
                Remove Last Point
              </Button>
              <Button
                variant="secondary"
                onClick={() => commitWaypoints([], { clearPreview: true })}
                disabled={waypoints.length === 0}
              >
                Clear
              </Button>
            </div>
          </div>
        </div>
      </Modal>
    </>
  )
}

export default RouteBuilderModal
