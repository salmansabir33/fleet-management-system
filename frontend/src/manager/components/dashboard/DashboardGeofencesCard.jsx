import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Plus, Circle } from 'lucide-react'
import { Circle as LeafletCircle, MapContainer, TileLayer, useMap } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { useTheme } from '../../../theme'
import { hexToRgba } from '../../../shared/utils'
import {
  Card,
  Button,
  SearchInput,
  Table,
  TableRow,
  Badge,
  EmptyState,
} from '../../../shared/components'
import { usePanelScope } from '../../hooks/usePanelScope'

const MAPTILER_KEY = import.meta.env.VITE_MAPTILER_KEY
const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN

const TILE_URL = MAPTILER_KEY
  ? `https://api.maptiler.com/maps/streets-v4/{z}/{x}/{y}.png?key=${MAPTILER_KEY}`
  : MAPBOX_TOKEN
    ? `https://api.mapbox.com/styles/v1/mapbox/streets-v12/tiles/{z}/{x}/{y}@2x?access_token=${MAPBOX_TOKEN}`
    : 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png'

const TILE_ATTRIBUTION = MAPTILER_KEY
  ? '&copy; MapTiler &copy; OpenStreetMap'
  : MAPBOX_TOKEN
    ? '&copy; Mapbox &copy; OpenStreetMap'
    : '&copy; CARTO &copy; OpenStreetMap'

const TILE_EXTRA_PROPS = MAPTILER_KEY ? { tileSize: 512, zoomOffset: -1 } : {}
const DEFAULT_CENTER = [31.4504, 73.135]

const FitGeofence = ({ geofence }) => {
  const map = useMap()
  useEffect(() => {
    if (!geofence) return
    const lat = Number(geofence.center_lat)
    const lon = Number(geofence.center_lon)
    const meters = Number(geofence.radius_meters)
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || !Number.isFinite(meters)) return
    const bounds = L.latLng(lat, lon).toBounds(meters * 2)
    map.fitBounds(bounds, { padding: [24, 24] })
  }, [geofence, map])
  return null
}

const GeofencePreviewMap = ({ geofence }) => {
  const { tokens } = useTheme()

  if (!geofence) {
    return (
      <div style={{ height: 180, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <EmptyState title="Select a geofence" description="Choose a row to preview on the map." />
      </div>
    )
  }

  const lat = Number(geofence.center_lat)
  const lon = Number(geofence.center_lon)
  const radius = Number(geofence.radius_meters)

  return (
    <MapContainer
      center={Number.isFinite(lat) && Number.isFinite(lon) ? [lat, lon] : DEFAULT_CENTER}
      zoom={13}
      style={{ height: 180, width: '100%', borderRadius: 8 }}
      scrollWheelZoom={false}
    >
      <TileLayer url={TILE_URL} attribution={TILE_ATTRIBUTION} {...TILE_EXTRA_PROPS} />
      <FitGeofence geofence={geofence} />
      {Number.isFinite(lat) && Number.isFinite(lon) && Number.isFinite(radius) && (
        <LeafletCircle
          center={[lat, lon]}
          radius={radius}
          pathOptions={{ color: tokens.primary, fillColor: tokens.primary, fillOpacity: 0.15 }}
        />
      )}
    </MapContainer>
  )
}

const DashboardGeofencesCard = ({ geofences, geofenceDevices, canGeofences, loading = false }) => {
  const { tokens } = useTheme()
  const navigate = useNavigate()
  const { basePath, can } = usePanelScope()
  const [search, setSearch] = useState('')
  const [selectedId, setSelectedId] = useState(null)

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return geofences
    return geofences.filter((g) => (g.name || '').toLowerCase().includes(q))
  }, [geofences, search])

  const vehicleCountByGeofence = useMemo(() => {
    const counts = {}
    for (const device of geofenceDevices) {
      const gid = device.primary_geofence_id
      if (gid == null) continue
      counts[gid] = (counts[gid] || 0) + 1
    }
    return counts
  }, [geofenceDevices])

  const selected = geofences.find((g) => g.id === selectedId) || filtered[0] || null

  return (
    <Card
      badge={9}
      title="Geofences"
      right={can('geofence') ? (
        <Button variant="secondary" size="sm" onClick={() => navigate(`${basePath}/geofences`)}>
          <Plus size={14} />
          Add Geofence
        </Button>
      ) : null}
    >
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(0, 1fr) minmax(200px, 260px)',
          gap: 14,
          alignItems: 'start',
        }}
      >
        <div>
          <SearchInput
            placeholder="Search geofences…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ marginBottom: 12 }}
          />

          {!canGeofences ? (
            <EmptyState title="Not permitted" description="Geofence access is required." />
          ) : loading || filtered.length > 0 ? (
            <Table
              loading={loading}
              columns={[
                { key: 'name', label: 'Name' },
                { key: 'shape', label: 'Shape' },
                { key: 'vehicles', label: 'Vehicles', align: 'right' },
                { key: 'status', label: 'Status' },
              ]}
            >
              {filtered.slice(0, 5).map((geofence, idx) => (
                <TableRow
                  key={geofence.id ?? `geo-${geofence.name}-${idx}`}
                  onClick={() => setSelectedId(geofence.id)}
                  style={{
                    background: selected?.id === geofence.id ? tokens.primarySoft : undefined,
                  }}
                >
                  <td style={{ fontWeight: 600 }}>{geofence.name}</td>
                  <td>
                    <Circle size={14} color={tokens.primary} style={{ verticalAlign: -2 }} />
                    {' '}
                    Circle
                  </td>
                  <td style={{ textAlign: 'right' }}>{vehicleCountByGeofence[geofence.id] || 0}</td>
                  <td>
                    <Badge
                      color={tokens.semantic.success}
                      background={hexToRgba(tokens.semantic.success, 0.14)}
                      pill
                    >
                      Active
                    </Badge>
                  </td>
                </TableRow>
              ))}
            </Table>
          ) : (
            <EmptyState title="No geofences" description="No geofences in your workspace." />
          )}
        </div>

        <div>
          <div style={{ fontSize: 12, fontWeight: 600, color: tokens.textMuted, marginBottom: 8 }}>
            Preview
          </div>
          <GeofencePreviewMap geofence={selected} />
        </div>
      </div>
    </Card>
  )
}

export default DashboardGeofencesCard
