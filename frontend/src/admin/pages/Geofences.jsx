import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Plus, MapPin, Pencil, Trash2, X, MoreVertical } from 'lucide-react'
import { Circle, MapContainer, Marker, TileLayer, Tooltip, useMap } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import api from '../../api'
import GeofenceBuilderModal from '../components/GeofenceBuilderModal'
import AssignVehicleToGeofenceModal from '../components/AssignVehicleToGeofenceModal'
import { useTheme } from '../../theme'
import {
  Card,
  Button,
  IconButton,
  SearchInput,
  Badge,
  Dropdown,
  DropdownItem,
  LoadingState,
  EmptyState,
} from '../../shared/components'
import { MobilePageHeading } from '../../shared/shell'
import { adminNavLabel } from '../navItems'
import { deriveVehicleStatus } from '../../user/utils/vehicleStatus'
import { usePanelScope } from '../../manager/hooks/usePanelScope'
import '../styles/admin-geofences.css'

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

const FLEET_STATUS_TOKEN = {
  moving: 'moving',
  idle: 'idle',
  stopped: 'parked',
  parked: 'parked',
  offline: 'offline',
}

const vehiclePinIconCache = new Map()

const vehiclePinIcon = (statusKey, tokens) => {
  const tokenKey = FLEET_STATUS_TOKEN[statusKey]
  const color = (tokenKey && tokens.fleetStatus[tokenKey]) || tokens.textMuted
  const cached = vehiclePinIconCache.get(color)
  if (cached) return cached
  const icon = L.divIcon({
    className: '',
    html: `
      <div style="position:relative;width:26px;height:26px;">
        <div style="
          position:absolute;top:50%;left:50%;width:16px;height:16px;
          margin:-8px 0 0 -8px;border-radius:50%;
          background:${color};border:3px solid #fff;
          box-shadow:0 1px 4px rgba(17,24,39,0.35);
        "></div>
      </div>
    `,
    iconSize: [26, 26],
    iconAnchor: [13, 13],
  })
  vehiclePinIconCache.set(color, icon)
  return icon
}

const fitGeofenceBounds = (geofence) => {
  if (!geofence) return null
  const lat = Number(geofence.center_lat)
  const lon = Number(geofence.center_lon)
  const meters = Number(geofence.radius_meters)
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || !Number.isFinite(meters) || meters <= 0) return null
  return L.latLng(lat, lon).toBounds(meters * 2)
}

const boundsFromVehicles = (vehicles) => {
  const points = (vehicles || [])
    .filter((vehicle) => vehicle.lat != null && vehicle.lon != null)
    .map((vehicle) => [vehicle.lat, vehicle.lon])
  if (points.length === 0) return null
  if (points.length === 1) return L.latLng(points[0][0], points[0][1]).toBounds(4000)
  return L.latLngBounds(points)
}

const boundsFromGeofences = (geofences) => {
  let bounds = null
  ;(geofences || []).forEach((geofence) => {
    const next = fitGeofenceBounds(geofence)
    if (!next) return
    bounds = bounds ? bounds.extend(next) : L.latLngBounds(next.getSouthWest(), next.getNorthEast())
  })
  return bounds
}

const FitToBounds = ({ bounds, maxZoom, fitKey }) => {
  const map = useMap()
  const boundsRef = useRef(bounds)
  boundsRef.current = bounds
  const boundsKey = fitKey ?? (bounds ? bounds.toBBoxString() : '')

  const apply = useCallback(() => {
    try {
      map.invalidateSize()
      const current = boundsRef.current
      if (!current) return
      const size = map.getSize()
      if (!size || size.x < 1 || size.y < 1) return
      map.fitBounds(current, {
        padding: [36, 36],
        ...(maxZoom != null ? { maxZoom } : {}),
      })
    } catch {
      // Ignore fit errors from detached / zero-size maps.
    }
  }, [map, maxZoom])

  useEffect(() => {
    apply()
  }, [boundsKey, apply])

  useEffect(() => {
    const timer = window.setTimeout(apply, 50)
    return () => window.clearTimeout(timer)
  }, [map, apply])

  return null
}

const FlyToPosition = ({ vehicleId, position }) => {
  const map = useMap()
  useEffect(() => {
    if (!position) return
    const [lat, lon] = position
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return
    try {
      const size = map.getSize()
      if (!size || size.x < 1 || size.y < 1) {
        map.invalidateSize()
      }
      map.flyTo(position, Math.max(map.getZoom() || 15, 15), { duration: 0.8 })
    } catch {
      // Hidden / zero-size map containers can throw during flyTo.
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vehicleId, map])
  return null
}

const SyncGeofenceView = ({ geofence }) => {
  const map = useMap()
  useEffect(() => {
    if (!geofence) return
    try {
      const bounds = fitGeofenceBounds(geofence)
      map.invalidateSize()
      const size = map.getSize()
      if (!size || size.x < 1 || size.y < 1) return
      if (bounds) {
        map.fitBounds(bounds, { padding: [36, 36] })
      } else {
        const lat = Number(geofence.center_lat)
        const lon = Number(geofence.center_lon)
        if (!Number.isFinite(lat) || !Number.isFinite(lon)) return
        map.setView([lat, lon], Math.max(map.getZoom() || 13, 13))
      }
    } catch {
      // Ignore sync errors from detached / zero-size maps.
    }
  }, [geofence?.id, map])
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

const GeofenceMap = ({ geofence, vehicles, overviewGeofences, focusVehicleId, focusPosition }) => {
  const { tokens } = useTheme()
  const geofenceBounds = fitGeofenceBounds(geofence)
  const overviewBounds = useMemo(
    () => boundsFromVehicles(vehicles) || boundsFromGeofences(overviewGeofences),
    [vehicles, overviewGeofences],
  )
  const bounds = geofence ? geofenceBounds : overviewBounds
  const center = geofence
    ? [Number(geofence.center_lat), Number(geofence.center_lon)]
    : (vehicles[0] ? [vehicles[0].lat, vehicles[0].lon] : DEFAULT_CENTER)
  const fitKey = geofence
    ? `geofence:${geofence.id}`
    : `overview:${vehicles.map((vehicle) => vehicle.id).sort((a, b) => a - b).join(',')}|fences:${(overviewGeofences || []).map((item) => item.id).join(',')}`

  return (
    <div style={{ flex: 1, minHeight: 0 }} className="ft-split-map">
      <MapContainer
        center={center}
        zoom={geofence ? 13 : 8}
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
        <InvalidateOnShow />
        <SyncGeofenceView geofence={geofence} />
        {!focusPosition && (
          <FitToBounds bounds={bounds} maxZoom={geofence ? undefined : 14} fitKey={fitKey} />
        )}
        {focusPosition && <FlyToPosition vehicleId={focusVehicleId} position={focusPosition} />}

        {geofence && (
          <Circle
            center={[Number(geofence.center_lat), Number(geofence.center_lon)]}
            radius={Number(geofence.radius_meters)}
            pathOptions={{
              color: tokens.primary,
              fillColor: tokens.primary,
              fillOpacity: 0.16,
              weight: 2,
            }}
          >
            <Tooltip sticky>{geofence.name}</Tooltip>
          </Circle>
        )}

        {vehicles.map((vehicle) => (
          <Marker
            key={vehicle.id}
            position={[vehicle.lat, vehicle.lon]}
            icon={vehiclePinIcon(vehicle.status, tokens)}
          >
            <Tooltip direction="top" offset={[0, -12]}>{vehicle.name}</Tooltip>
          </Marker>
        ))}
      </MapContainer>
    </div>
  )
}

const makeGeofenceStyles = (tokens) => ({
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
    display: 'flex',
    alignItems: 'center',
    gap: 8,
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
  mapPanel: {
    position: 'relative',
    padding: 0,
    overflow: 'hidden',
    display: 'flex',
    flexDirection: 'column',
    minHeight: 0,
  },
  sectionEmpty: {
    fontSize: 12,
    color: tokens.textDisabled,
    padding: '6px 0',
  },
})

const GeofencesPage = () => {
  const { tokens } = useTheme()
  const styles = useMemo(() => makeGeofenceStyles(tokens), [tokens])
  const { isManager, can, apiFor } = usePanelScope()
  const canManage = can('geofence')
  const canLive = can('live_tracking')
  const [geofences, setGeofences] = useState([])
  const [allDevices, setAllDevices] = useState([])
  const [liveById, setLiveById] = useState({})
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [selectedGeofenceId, setSelectedGeofenceId] = useState(null)
  const [focusVehicleId, setFocusVehicleId] = useState(null)
  const [showBuilder, setShowBuilder] = useState(false)
  const [editGeofenceId, setEditGeofenceId] = useState(null)
  const [showAssignModal, setShowAssignModal] = useState(false)
  const [isMobileLayout, setIsMobileLayout] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(max-width: 900px)').matches,
  )
  const [mobileMapOpen, setMobileMapOpen] = useState(false)

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

  const loadGeofences = useCallback(async () => {
    try {
      const res = await api.get(apiFor('/geofences', '/api/geofences'))
      setGeofences(res.data || [])
    } catch (err) {
      console.error('Failed to load geofences:', err)
    }
  }, [apiFor])

  const loadDevices = useCallback(async () => {
    try {
      // In manager mode use the geofence-scoped assignable-vehicles endpoint
      // (returns flat DeviceOut for the manager's fleet, no live_tracking required)
      const url = isManager
        ? apiFor('/geofences/assignable-vehicles', '/api/fleet/devices')
        : '/api/fleet/devices'
      const res = await api.get(url)
      setAllDevices(res.data || [])
    } catch (err) {
      console.error('Failed to load vehicles:', err)
    }
  }, [isManager, apiFor])

  const loadLive = useCallback(async () => {
    if (!canLive) return
    try {
      const res = await api.get(apiFor('/vehicles', '/api/live'))
      const items = res.data?.live || res.data || []
      const next = {}
      items.forEach((item) => {
        if (item.db_id != null) next[item.db_id] = item
      })
      setLiveById(next)
    } catch (err) {
      console.error('Failed to load live positions:', err)
    }
  }, [canLive, apiFor])

  useEffect(() => {
    const boot = async () => {
      setLoading(true)
      const tasks = [loadGeofences(), loadDevices()]
      if (canLive) tasks.push(loadLive())
      await Promise.all(tasks)
      setLoading(false)
    }
    boot()
  }, [loadGeofences, loadDevices, loadLive, canLive])

  useEffect(() => {
    if (!canLive) return undefined
    const interval = setInterval(loadLive, 10000)
    return () => clearInterval(interval)
  }, [loadLive, canLive])

  const assignedVehicles = useCallback((geofenceId) => (
    allDevices
      .filter((device) => Number(device.primary_geofence_id) === Number(geofenceId))
      .map((device) => {
        const live = liveById[device.id]
        const lat = live?.position?.latitude
        const lon = live?.position?.longitude
        return {
          ...device,
          lat: lat ?? null,
          lon: lon ?? null,
          status: live ? deriveVehicleStatus(live) : 'offline',
          plate_number: device.plate_number,
        }
      })
  ), [allDevices, liveById])

  const filteredGeofences = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return geofences
    return geofences.filter((geofence) => (geofence.name || '').toLowerCase().includes(q))
  }, [geofences, search])

  const selectedGeofence = geofences.find((item) => item.id === selectedGeofenceId) || null
  const selectedVehicles = selectedGeofenceId ? assignedVehicles(selectedGeofenceId) : []
  const allLiveVehicles = useMemo(() => (
    allDevices
      .map((device) => {
        const live = liveById[device.id]
        const lat = live?.position?.latitude
        const lon = live?.position?.longitude
        return {
          ...device,
          lat: lat ?? null,
          lon: lon ?? null,
          status: live ? deriveVehicleStatus(live) : 'offline',
          plate_number: device.plate_number,
        }
      })
      .filter((vehicle) => vehicle.lat != null && vehicle.lon != null)
  ), [allDevices, liveById])
  const mapVehicles = selectedGeofenceId
    ? selectedVehicles.filter((vehicle) => vehicle.lat != null && vehicle.lon != null)
    : allLiveVehicles
  const focusedVehicle = selectedVehicles.find((vehicle) => vehicle.id === focusVehicleId) || null
  const focusPosition = focusedVehicle?.lat != null && focusedVehicle?.lon != null
    ? [focusedVehicle.lat, focusedVehicle.lon]
    : null

  const expandGeofence = (geofenceId) => {
    if (isMobileLayout) {
      setSelectedGeofenceId(geofenceId)
      setFocusVehicleId(null)
      setMobileMapOpen(true)
      return
    }
    const next = selectedGeofenceId === geofenceId ? null : geofenceId
    setSelectedGeofenceId(next)
    setFocusVehicleId(null)
  }

  const closeMobileMap = () => {
    setMobileMapOpen(false)
  }

  const openCreate = () => {
    setEditGeofenceId(null)
    setShowBuilder(true)
  }

  const openEdit = (geofenceId) => {
    setEditGeofenceId(geofenceId)
    setShowBuilder(true)
  }

  const closeBuilder = () => {
    setShowBuilder(false)
    setEditGeofenceId(null)
  }

  const handleSavedGeofence = async (geofenceId) => {
    await loadGeofences()
    if (geofenceId != null) {
      setSelectedGeofenceId(geofenceId)
      setFocusVehicleId(null)
    }
  }

  const deleteGeofence = async (geofence) => {
    if (!window.confirm(`Delete geofence "${geofence.name}"? This cannot be undone.`)) return
    try {
      await api.delete(apiFor(`/geofences/${geofence.id}`, `/api/geofences/${geofence.id}`))
      setGeofences((current) => current.filter((item) => item.id !== geofence.id))
      if (selectedGeofenceId === geofence.id) {
        setSelectedGeofenceId(null)
        setFocusVehicleId(null)
      }
    } catch (err) {
      window.alert(err.response?.data?.detail || 'Failed to delete geofence.')
    }
  }

  const unassignVehicle = async (device) => {
    try {
      if (isManager) {
        await api.delete(apiFor(`/geofences/${selectedGeofenceId}/vehicles/${device.id}`, `/api/fleet/devices/${device.id}`))
      } else {
        await api.patch(`/api/fleet/devices/${device.id}`, { primary_geofence_id: null })
      }
      await loadDevices()
    } catch (err) {
      window.alert(err.response?.data?.detail || 'Failed to unassign vehicle.')
    }
  }

  const focusVehicle = (vehicle) => {
    if (vehicle.lat == null || vehicle.lon == null) return
    setFocusVehicleId(vehicle.id)
    if (isMobileLayout) {
      setMobileMapOpen(true)
    }
  }

  const listPanel = (
    <Card
      className={`ft-geofences-list-panel${isManager ? ' ft-glass ft-glass--elevated' : ''}`}
      style={styles.listPanel}
    >
      <div style={{ padding: '12px 14px', borderBottom: `1px solid ${tokens.border}` }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: tokens.text }}>Geofences</div>
      </div>
      {loading && geofences.length === 0 ? (
        <LoadingState label="Loading geofences…" />
      ) : filteredGeofences.length === 0 ? (
        <EmptyState
          title={geofences.length === 0 ? 'No geofences yet' : 'No geofences match.'}
          description={geofences.length === 0 ? 'Create one to get started.' : undefined}
        />
      ) : (
        <div className="ft-geofences-list-scroll" style={styles.list}>
          {filteredGeofences.map((geofence) => {
            const expanded = selectedGeofenceId === geofence.id
            const vehicles = assignedVehicles(geofence.id)
            const pillVehicles = vehicles.slice(0, 2)
            return (
              <div key={geofence.id} className="ft-admin-entity-card" style={styles.routeCard}>
                <div style={styles.routeRow}>
                  <button type="button" style={styles.routeRowMain} onClick={() => expandGeofence(geofence.id)}>
                    <div style={styles.routeIcon}>
                      <MapPin size={16} color={tokens.primary} />
                    </div>
                    <div style={{ flex: 1, minWidth: 0, textAlign: 'left' }}>
                      <div style={styles.routeName}>{geofence.name}</div>
                      <div style={styles.vehicleMatchSub}>{geofence.radius_meters} m radius</div>
                      {vehicles.length >= 1 && (
                        <div style={styles.vehiclePillRow}>
                          {pillVehicles.map((vehicle) => (
                            <Badge key={vehicle.id} color={tokens.textMuted} background={tokens.background}>
                              {vehicle.name}
                            </Badge>
                          ))}
                          {vehicles.length > 2 && (
                            <Badge color={tokens.textMuted} background={tokens.background}>
                              +{vehicles.length - 2}
                            </Badge>
                          )}
                        </div>
                      )}
                    </div>
                  </button>
                  <div style={styles.routeRowActions}>
                    {canManage && (
                      <Dropdown
                        align="right"
                        trigger={(
                          <IconButton label="Geofence actions" size="sm">
                            <MoreVertical size={14} />
                          </IconButton>
                        )}
                      >
                        <DropdownItem onClick={() => openEdit(geofence.id)}>
                          <Pencil size={13} />
                          Edit
                        </DropdownItem>
                        <DropdownItem danger onClick={() => deleteGeofence(geofence)}>
                          <Trash2 size={13} />
                          Delete
                        </DropdownItem>
                      </Dropdown>
                    )}
                  </div>
                </div>

                {expanded && (
                  <div style={styles.routeExpanded}>
                    {vehicles.length === 0 ? (
                      <div style={styles.sectionEmpty}>No vehicles assigned to this geofence.</div>
                    ) : (
                      <div style={styles.vehicleMatchList}>
                        {vehicles.map((vehicle) => (
                          <div
                            key={vehicle.id}
                            style={{
                              ...styles.vehicleMatchRow,
                              ...(focusVehicleId === vehicle.id ? styles.vehicleMatchRowActive : {}),
                            }}
                            onClick={() => focusVehicle(vehicle)}
                          >
                            <div style={{ minWidth: 0, flex: 1 }}>
                              <div style={styles.vehicleMatchName}>{vehicle.name}</div>
                              <div style={styles.vehicleMatchSub}>
                                {vehicle.plate_number || 'No plate'}
                                {vehicle.lat == null ? ' · No live position' : ''}
                              </div>
                            </div>
                            {canManage && (
                              <IconButton
                                label="Unassign"
                                size="sm"
                                onClick={(e) => {
                                  e.stopPropagation()
                                  unassignVehicle(vehicle)
                                }}
                              >
                                <X size={12} />
                              </IconButton>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                    {canManage && (
                      <Button
                        variant="secondary"
                        style={{ marginTop: 10, width: '100%' }}
                        onClick={() => setShowAssignModal(true)}
                      >
                        <Plus size={14} />
                        Assign vehicle
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
  )

  const mapPanel = (
    <Card
      className="ft-map-frame ft-geofences-desktop-map"
      style={{
        ...styles.mapPanel,
        minHeight: isManager ? 480 : undefined,
      }}
    >
      <GeofenceMap
        geofence={selectedGeofence}
        vehicles={mapVehicles}
        overviewGeofences={geofences}
        focusVehicleId={focusVehicleId}
        focusPosition={focusPosition}
      />
    </Card>
  )

  return (
    <div className="ft-page-stack ft-page-stack--fill ft-geofences-page" style={styles.page}>
      <MobilePageHeading>{adminNavLabel('/admin/geofences')}</MobilePageHeading>
      <div className="ft-geofences-toolbar">
        <SearchInput
          className="ft-geofences-toolbar__search"
          placeholder="Search geofences..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        {canManage && (
          <Button className="ft-geofences-toolbar__add" onClick={openCreate}>
            <Plus size={16} />
            Geofence
          </Button>
        )}
      </div>

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
        {isManager && !isMobileLayout && mapPanel}
        {listPanel}
        {!isManager && !isMobileLayout && mapPanel}
      </div>

      {mobileMapOpen && selectedGeofence && createPortal(
        <div className="ft-geofences-map-overlay" role="dialog" aria-modal="true" aria-label={selectedGeofence.name}>
          <div className="ft-geofences-map-overlay__bar">
            <div className="ft-geofences-map-overlay__title">{selectedGeofence.name}</div>
            <button
              type="button"
              className="ft-geofences-map-overlay__close"
              onClick={closeMobileMap}
              aria-label="Close map"
            >
              <X size={20} />
            </button>
          </div>
          <div className="ft-geofences-map-overlay__map">
            <GeofenceMap
              geofence={selectedGeofence}
              vehicles={mapVehicles}
              overviewGeofences={geofences}
              focusVehicleId={focusVehicleId}
              focusPosition={focusPosition}
            />
          </div>
        </div>,
        document.body,
      )}

      {showBuilder && (
        <GeofenceBuilderModal
          editGeofenceId={editGeofenceId}
          onClose={closeBuilder}
          onSaved={handleSavedGeofence}
          apiFor={isManager ? apiFor : undefined}
          canLive={canLive}
        />
      )}

      {showAssignModal && selectedGeofenceId && (
        <AssignVehicleToGeofenceModal
          geofenceId={selectedGeofenceId}
          alreadyAssignedDeviceIds={selectedVehicles.map((vehicle) => vehicle.id)}
          onClose={() => setShowAssignModal(false)}
          onAssigned={loadDevices}
          vehiclesUrl={isManager ? apiFor('/geofences/assignable-vehicles', '/api/fleet/devices') : undefined}
          assignUrl={isManager ? (deviceId) => apiFor(`/geofences/${selectedGeofenceId}/vehicles/${deviceId}`, `/api/fleet/devices/${deviceId}`) : undefined}
        />
      )}
    </div>
  )
}

export default GeofencesPage
