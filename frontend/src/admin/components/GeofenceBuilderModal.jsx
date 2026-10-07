import { useEffect, useMemo, useRef, useState } from 'react'
import { MapPin, Pencil, ChevronDown } from 'lucide-react'
import { Circle, MapContainer, Marker, TileLayer, Tooltip, useMap, useMapEvents } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import api from '../../api'
import { useAuth } from '../../auth/AuthContext'
import { readActingAdminId } from '../../auth/actingAdminStorage'
import SuperAdminFleetSelect from './SuperAdminFleetSelect'
import { Modal, Input, Button, Tabs, Dropdown, DropdownItem } from '../../shared/components'
import { useTheme } from '../../theme'

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
const DEFAULT_RADIUS = 300
const MODES = [
  { key: 'draw', label: 'Draw', fullLabel: 'Draw on map' },
  { key: 'coords', label: 'Coords', fullLabel: 'Enter coordinates' },
]

const MOBILE_PANES = [
  { id: 'details', label: 'Details' },
  { id: 'map', label: 'Map' },
]

const centerIcon = L.divIcon({
  className: '',
  html: `
    <div style="
      width:24px;height:24px;border-radius:50%;
      background:var(--ft-primary);color:var(--ft-surface);
      display:flex;align-items:center;justify-content:center;
      border:2px solid var(--ft-surface);box-shadow:var(--ft-shadow-md);
      font-size:11px;font-weight:700;
    "></div>
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

const eastPointAtRadius = (lat, lon, radiusMeters) => {
  const metersPerDegLon = 111320 * Math.cos((lat * Math.PI) / 180)
  const dLon = metersPerDegLon === 0 ? 0 : radiusMeters / metersPerDegLon
  return [lat, lon + dLon]
}

const ClickCapture = ({ onSetCenter, suppressRef }) => {
  useMapEvents({
    click(e) {
      if (suppressRef.current) {
        suppressRef.current = false
        return
      }
      onSetCenter(e.latlng.lat, e.latlng.lng)
    },
  })
  return null
}

const InvalidateOnShow = () => {
  const map = useMap()
  useEffect(() => {
    const timer = window.setTimeout(() => map.invalidateSize(), 50)
    const container = map.getContainer()
    const observer = typeof ResizeObserver !== 'undefined'
      ? new ResizeObserver(() => { map.invalidateSize() })
      : null
    if (observer) observer.observe(container)
    return () => {
      window.clearTimeout(timer)
      observer?.disconnect()
    }
  }, [map])
  return null
}

const FitToCircle = ({ center, radiusMeters }) => {
  const map = useMap()
  const key = center && radiusMeters
    ? `${center[0]},${center[1]},${radiusMeters}`
    : ''
  const doneRef = useRef('')

  useEffect(() => {
    if (!center || !radiusMeters) return
    if (doneRef.current === key) return
    doneRef.current = key
    map.invalidateSize()
    const bounds = L.latLng(center[0], center[1]).toBounds(Number(radiusMeters) * 2)
    map.fitBounds(bounds, { padding: [36, 36] })
  }, [center, radiusMeters, key, map])

  return null
}

const GeofenceMapPanel = ({
  mapCenter,
  hasCenter,
  hasRadius,
  latNum,
  lonNum,
  radiusNum,
  handleRadius,
  isEdit,
  loadingGeofence,
  onRadiusHandleDragEnd,
  suppressMapClickRef,
  setCenter,
  tokens,
}) => (
  <div className="geofence-builder-map">
    <div className="geofence-builder-map__canvas">
      <MapContainer center={mapCenter} zoom={13} style={{ width: '100%', height: '100%', background: '#eef1f5' }} scrollWheelZoom>
        <TileLayer
          attribution={TILE_ATTRIBUTION}
          url={TILE_URL}
          subdomains="abcd"
          maxZoom={19}
          {...TILE_EXTRA_PROPS}
        />
        <InvalidateOnShow />
        <ClickCapture onSetCenter={setCenter} suppressRef={suppressMapClickRef} />
        {isEdit && !loadingGeofence && hasCenter && hasRadius && (
          <FitToCircle center={[latNum, lonNum]} radiusMeters={radiusNum} />
        )}
        {hasCenter && hasRadius && (
          <Circle
            center={[latNum, lonNum]}
            radius={radiusNum}
            pathOptions={{
              color: tokens.mapAccent,
              fillColor: tokens.mapAccent,
              fillOpacity: 0.18,
              weight: 2,
            }}
          />
        )}
        {hasCenter && (
          <Marker
            position={[latNum, lonNum]}
            icon={centerIcon}
            draggable
            eventHandlers={{
              dragstart: () => { suppressMapClickRef.current = true },
              dragend: (event) => {
                const latlng = event.target.getLatLng()
                setCenter(latlng.lat, latlng.lng)
              },
            }}
          >
            <Tooltip direction="top" offset={[0, -12]}>Center</Tooltip>
          </Marker>
        )}
        {hasCenter && hasRadius && (
          <Marker
            position={handleRadius}
            icon={ghostIcon}
            draggable
            eventHandlers={{
              dragstart: () => { suppressMapClickRef.current = true },
              dragend: onRadiusHandleDragEnd,
            }}
          >
            <Tooltip direction="top" offset={[0, -8]}>Radius</Tooltip>
          </Marker>
        )}
      </MapContainer>
    </div>
    <div className="geofence-builder-map__hint">
      Tap to place the center. Drag the pin to move it, or drag the edge handle to resize.
    </div>
  </div>
)

const GeofenceBuilderModal = ({ editGeofenceId, onClose, onSaved, apiFor: apiForProp, canLive }) => {
  const { tokens } = useTheme()
  // apiForProp: optional (resource, adminFallback) => url from usePanelScope
  // When not passed (admin usage) fall back to the admin endpoints.
  const resolveUrl = apiForProp || ((_resource, fallback) => fallback)
  const isEdit = editGeofenceId != null
  const { role } = useAuth()
  const [targetAdminId, setTargetAdminId] = useState('')
  const saGlobalCreate = role === 'super_admin' && readActingAdminId() == null
  const [mode, setMode] = useState('draw')
  const [mobilePane, setMobilePane] = useState('map')
  const [name, setName] = useState('')
  const [centerLat, setCenterLat] = useState('')
  const [centerLon, setCenterLon] = useState('')
  const [radiusMeters, setRadiusMeters] = useState(String(DEFAULT_RADIUS))
  const [loadingGeofence, setLoadingGeofence] = useState(Boolean(editGeofenceId))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const [devices, setDevices] = useState([])
  const [selectedDeviceId, setSelectedDeviceId] = useState('')
  const suppressMapClickRef = useRef(false)

  // Live position prefill — only available when live_tracking is permitted
  const showLivePrefill = canLive !== false

  useEffect(() => {
    if (!showLivePrefill) return undefined
    let cancelled = false
    const loadLive = async () => {
      try {
        const liveRes = await api.get(resolveUrl('/vehicles', '/api/live'))
        const items = liveRes.data?.live || liveRes.data || []
        if (!cancelled) setDevices(items)
      } catch {
        if (!cancelled) setDevices([])
      }
    }
    loadLive()
    return () => { cancelled = true }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showLivePrefill])

  useEffect(() => {
    if (!editGeofenceId) return undefined
    let cancelled = false
    const loadGeofence = async () => {
      setLoadingGeofence(true)
      try {
        const res = await api.get(resolveUrl(`/geofences/${editGeofenceId}`, `/api/geofences/${editGeofenceId}`))
        if (cancelled) return
        const geofence = res.data
        setName(geofence.name || '')
        setCenterLat(geofence.center_lat != null ? String(geofence.center_lat) : '')
        setCenterLon(geofence.center_lon != null ? String(geofence.center_lon) : '')
        setRadiusMeters(geofence.radius_meters != null ? String(geofence.radius_meters) : String(DEFAULT_RADIUS))
      } catch (err) {
        if (!cancelled) setError(err.response?.data?.detail || 'Failed to load geofence.')
      } finally {
        if (!cancelled) setLoadingGeofence(false)
      }
    }
    loadGeofence()
    return () => { cancelled = true }
  }, [editGeofenceId])

  const latNum = Number(centerLat)
  const lonNum = Number(centerLon)
  const radiusNum = Number(radiusMeters)
  const hasCenter = Number.isFinite(latNum) && Number.isFinite(lonNum)
  const hasRadius = Number.isFinite(radiusNum) && radiusNum > 0
  const mapCenter = useMemo(
    () => (hasCenter ? [latNum, lonNum] : DEFAULT_CENTER),
    [hasCenter, latNum, lonNum],
  )

  const setCenter = (lat, lon) => {
    setCenterLat(String(lat))
    setCenterLon(String(lon))
  }

  const handleUseDevicePosition = () => {
    const item = devices.find((d) => String(d.device.id) === selectedDeviceId)
    if (!item || !item.position || item.position.latitude == null || item.position.longitude == null) {
      setError('Selected device has no position data available')
      return
    }
    setError(null)
    setCenterLat(String(item.position.latitude))
    setCenterLon(String(item.position.longitude))
  }

  const onRadiusHandleDragEnd = (event) => {
    if (!hasCenter) return
    const latlng = event.target.getLatLng()
    const meters = Math.max(1, Math.round(L.latLng(latNum, lonNum).distanceTo(latlng)))
    setRadiusMeters(String(meters))
  }

  const saveGeofence = async () => {
    if (!name.trim()) {
      setError('Geofence name is required.')
      return
    }
    if (!Number.isFinite(latNum) || !Number.isFinite(lonNum)) {
      setError('Latitude and longitude are required.')
      return
    }
    if (!Number.isFinite(radiusNum) || radiusNum <= 0) {
      setError('Radius must be a positive number of meters.')
      return
    }
    if (saGlobalCreate && !isEdit && !targetAdminId) {
      setError('Select a fleet admin for this geofence.')
      return
    }

    setSaving(true)
    setError(null)
    try {
      const payload = {
        name: name.trim(),
        center_lat: latNum,
        center_lon: lonNum,
        radius_meters: radiusNum,
      }
      if (saGlobalCreate && !isEdit && targetAdminId) {
        payload.admin_id = Number(targetAdminId)
      }
      if (isEdit) {
        await api.patch(resolveUrl(`/geofences/${editGeofenceId}`, `/api/geofences/${editGeofenceId}`), payload)
        onSaved?.(editGeofenceId)
      } else {
        const res = await api.post(resolveUrl('/geofences', '/api/geofences'), payload)
        onSaved?.(res.data?.id)
      }
      onClose()
    } catch (err) {
      setError(err.response?.data?.detail || (isEdit ? 'Failed to update geofence.' : 'Failed to save geofence.'))
    } finally {
      setSaving(false)
    }
  }

  const handleRadius = eastPointAtRadius(latNum, lonNum, hasRadius ? radiusNum : DEFAULT_RADIUS)

  const deviceOptions = useMemo(() => (
    devices.map((item) => ({
      value: String(item.device.id),
      label: item.device.name || String(item.device.id),
    }))
  ), [devices])

  const selectedDeviceLabel = deviceOptions.find((option) => option.value === selectedDeviceId)?.label

  const selectMode = (nextMode) => {
    setMode(nextMode)
    setMobilePane(nextMode === 'coords' ? 'details' : 'map')
  }

  const nameAndModeTabs = (
    <>
      <div style={{ marginBottom: 14 }}>
        <Input
          label="Name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Depot perimeter"
          required
        />
      </div>

      {saGlobalCreate && !isEdit && (
        <div style={{ marginBottom: 14 }}>
          <SuperAdminFleetSelect
            required
            value={targetAdminId}
            onChange={(e) => setTargetAdminId(e.target.value)}
          />
        </div>
      )}

      <div className="geofence-builder-modes">
        {MODES.map((option) => (
          <Button
            key={option.key}
            type="button"
            variant={mode === option.key ? 'primary' : 'secondary'}
            size="sm"
            onClick={() => selectMode(option.key)}
          >
            {option.key === 'draw' ? <MapPin size={13} /> : <Pencil size={13} />}
            <span className="geofence-builder-mode-label--full">{option.fullLabel}</span>
            <span className="geofence-builder-mode-label--short">{option.label}</span>
          </Button>
        ))}
      </div>
    </>
  )

  const formPanel = mode === 'coords' ? (
    <div className="geofence-builder-form">
      {nameAndModeTabs}
      {showLivePrefill && (
        <div className="geofence-builder-device" style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 14 }}>
          <div className="ft-field">
            <label className="ft-field-label">Device (position prefill)</label>
            <Dropdown
              className="ft-dropdown--block"
              menuClassName="ft-dropdown-menu--stretch geofence-builder-device-menu"
              trigger={(
                <button type="button" className="ft-control ft-select-trigger">
                  <span className="ft-select-trigger-label">
                    {selectedDeviceLabel || 'Select a device'}
                  </span>
                  <ChevronDown size={16} className="ft-select-chevron" aria-hidden />
                </button>
              )}
            >
              <DropdownItem
                className={!selectedDeviceId ? 'ft-dropdown-item--active' : undefined}
                onClick={() => setSelectedDeviceId('')}
              >
                Select a device
              </DropdownItem>
              {deviceOptions.map((option) => (
                <DropdownItem
                  key={option.value}
                  className={option.value === selectedDeviceId ? 'ft-dropdown-item--active' : undefined}
                  onClick={() => setSelectedDeviceId(option.value)}
                >
                  {option.label}
                </DropdownItem>
              ))}
            </Dropdown>
          </div>
          <Button
            variant="secondary"
            onClick={handleUseDevicePosition}
            disabled={!selectedDeviceId}
          >
            Use device position
          </Button>
        </div>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <Input
          label="Latitude"
          type="number"
          step="0.000001"
          value={centerLat}
          onChange={(e) => setCenterLat(e.target.value)}
          required
        />
        <Input
          label="Longitude"
          type="number"
          step="0.000001"
          value={centerLon}
          onChange={(e) => setCenterLon(e.target.value)}
          required
        />
        <Input
          label="Radius (meters)"
          type="number"
          step="1"
          min="1"
          value={radiusMeters}
          onChange={(e) => setRadiusMeters(e.target.value)}
          required
        />
      </div>
    </div>
  ) : (
    <div className="geofence-builder-form">
      {nameAndModeTabs}
      <div style={{ marginBottom: 12 }}>
        <Input
          label="Radius (meters)"
          type="number"
          step="1"
          min="1"
          value={radiusMeters}
          onChange={(e) => setRadiusMeters(e.target.value)}
        />
      </div>
      <input
        type="range"
        min="50"
        max="10000"
        step="10"
        value={hasRadius ? Math.min(10000, Math.max(50, radiusNum)) : DEFAULT_RADIUS}
        onChange={(e) => setRadiusMeters(e.target.value)}
        style={{ width: '100%', marginBottom: 12, accentColor: tokens.primary }}
      />
      <div style={{ fontSize: 12, color: tokens.textSecondary, marginBottom: 16 }}>
        {loadingGeofence
          ? 'Loading geofence...'
          : hasCenter
            ? `${latNum.toFixed(6)}, ${lonNum.toFixed(6)} · ${hasRadius ? Math.round(radiusNum) : DEFAULT_RADIUS} m`
            : 'Open the Map tab to place the center pin, then set the radius here or on the map.'}
      </div>
    </div>
  )

  return (
    <>
      <style>
        {`
          .geofence-builder-modal { max-width: 840px !important; height: 90vh; }
          .geofence-builder-modal > div:nth-child(2) {
            padding: 0 !important;
            overflow: hidden !important;
            display: flex;
            flex-direction: column;
            min-height: 0;
            flex: 1;
          }
          .geofence-builder-mobile-tabs { display: none; }
          .geofence-builder-help {
            margin: 0 20px 12px;
            font-size: 13px;
            color: var(--ft-text-secondary);
          }
          .geofence-builder-error {
            margin: 0 20px 12px;
            padding: 10px 12px;
            border-radius: 8px;
            font-size: 13px;
          }
          .geofence-builder-layout {
            flex: 1;
            min-height: 0;
            display: grid;
            grid-template-columns: 280px 1fr;
            grid-template-rows: 1fr;
          }
          .geofence-builder-form {
            border-right: 1px solid var(--ft-border);
            padding: 20px;
            overflow-x: hidden;
            overflow-y: auto;
            min-height: 0;
          }
          .geofence-builder-device {
            min-width: 0;
            width: 100%;
          }
          .geofence-builder-device-menu {
            max-height: 220px;
            overflow-y: auto;
          }
          .geofence-builder-modes {
            display: grid;
            grid-template-columns: repeat(2, 1fr);
            gap: 8px;
            margin-bottom: 14px;
          }
          .geofence-builder-mode-label--short { display: none; }
          .geofence-builder-map {
            display: flex;
            flex-direction: column;
            min-height: 0;
          }
          .geofence-builder-map__canvas {
            flex: 1;
            min-height: 0;
            width: 100%;
            display: flex;
            align-items: stretch;
            overflow: hidden;
          }
          .geofence-builder-map__hint {
            padding: 10px 14px;
            border-top: 1px solid var(--ft-border);
            font-size: 12px;
            color: var(--ft-text-secondary);
            flex-shrink: 0;
          }
          @media (max-width: 640px) {
            .ft-backdrop:has(.geofence-builder-modal) {
              padding: 0 !important;
              align-items: stretch !important;
            }
            .geofence-builder-modal {
              width: 100% !important;
              max-width: 100% !important;
              height: 100% !important;
              max-height: 100% !important;
              border-radius: 0 !important;
            }
            .geofence-builder-modal > div:first-child {
              padding: 12px 14px 0 !important;
            }
            .geofence-builder-modal > div:first-child h3 {
              font-size: 16px !important;
            }
            .geofence-builder-modal > div:last-child {
              display: grid !important;
              grid-template-columns: 1fr 1fr;
              gap: 8px;
              padding: 10px 12px calc(10px + env(safe-area-inset-bottom)) !important;
            }
            .geofence-builder-modal > div:last-child .ft-btn {
              width: 100%;
              justify-content: center;
              min-height: 40px;
            }
            .geofence-builder-mobile-tabs {
              display: block;
              padding: 8px 12px 0;
              flex-shrink: 0;
            }
            .geofence-builder-mobile-tabs .ft-tabs {
              width: 100%;
            }
            .geofence-builder-help {
              display: none;
            }
            .geofence-builder-error {
              margin: 8px 12px;
            }
            .geofence-builder-layout {
              grid-template-columns: 1fr;
            }
            .geofence-builder-layout--map .geofence-builder-form {
              display: none;
            }
            .geofence-builder-layout--details .geofence-builder-map {
              display: none;
            }
            .geofence-builder-form {
              border-right: none;
              padding: 12px;
            }
            .geofence-builder-mode-label--full { display: none; }
            .geofence-builder-mode-label--short { display: inline; }
            .geofence-builder-map__hint {
              font-size: 11px;
              padding: 8px 12px;
            }
            .geofence-builder-map .leaflet-container {
              min-height: 0;
              height: 100%;
            }
            .geofence-builder-device-menu {
              max-height: min(240px, 40vh);
              overflow-y: auto;
            }
          }
        `}
      </style>
      <Modal
        open
        onClose={onClose}
        title={isEdit ? 'Edit Geofence' : 'Add New Geofence'}
        size="lg"
        className="geofence-builder-modal"
        footer={(
          <>
            <Button variant="secondary" onClick={onClose} disabled={saving}>Cancel</Button>
            <Button onClick={saveGeofence} loading={saving} disabled={loadingGeofence}>
              <MapPin size={16} />
              Save
            </Button>
          </>
        )}
      >
        <div className="geofence-builder-mobile-tabs">
          <Tabs
            items={MOBILE_PANES}
            value={mobilePane}
            onChange={setMobilePane}
          />
        </div>

        <p className="geofence-builder-help">
          Draw a circle on the map or enter coordinates. Name is required in both modes.
        </p>

        {error && (
          <div
            className="geofence-builder-error"
            style={{
              background: `${tokens.semantic.danger}18`,
              color: tokens.semantic.danger,
            }}
          >
            {error}
          </div>
        )}

        <div className={`geofence-builder-layout geofence-builder-layout--${mobilePane}`}>
          {formPanel}
          <GeofenceMapPanel
            mapCenter={mapCenter}
            hasCenter={hasCenter}
            hasRadius={hasRadius}
            latNum={latNum}
            lonNum={lonNum}
            radiusNum={radiusNum}
            handleRadius={handleRadius}
            isEdit={isEdit}
            loadingGeofence={loadingGeofence}
            onRadiusHandleDragEnd={onRadiusHandleDragEnd}
            suppressMapClickRef={suppressMapClickRef}
            setCenter={setCenter}
            tokens={tokens}
          />
        </div>
      </Modal>
    </>
  )
}

export default GeofenceBuilderModal
