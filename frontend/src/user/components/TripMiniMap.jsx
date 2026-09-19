import { useEffect, useMemo } from 'react'
import { MapContainer, TileLayer, Marker, Polyline, useMap } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { useTheme } from '../../theme'

const TILE_URL = 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png'
const TILE_ATTRIBUTION = '&copy; <a href="https://carto.com/attributions">CARTO</a> &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'

const pinIcon = (color) => L.divIcon({
  className: '',
  html: `<div style="width:12px;height:12px;border-radius:50%;background:${color};border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.35)"></div>`,
  iconSize: [12, 12],
  iconAnchor: [6, 6],
})

function FitTripBounds({ points }) {
  const map = useMap()
  useEffect(() => {
    if (!points?.length) return
    if (points.length === 1) {
      map.setView(points[0], 14)
      return
    }
    map.fitBounds(L.latLngBounds(points), { padding: [28, 28] })
  }, [map, points])
  return null
}

export default function TripMiniMap({ trip, height = 220, color }) {
  const { tokens } = useTheme()
  const lineColor = color || tokens.primary

  const points = useMemo(() => {
    if (!trip) return []
    const pts = []
    if (trip.start_lat != null && trip.start_lon != null) pts.push([trip.start_lat, trip.start_lon])
    if (trip.end_lat != null && trip.end_lon != null) pts.push([trip.end_lat, trip.end_lon])
    return pts
  }, [trip])

  if (!trip || points.length === 0) {
    return (
      <div style={{
        height,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: tokens.textMuted,
        fontSize: 13,
        background: tokens.background,
        borderRadius: tokens.radius.md,
      }}
      >
        No route coordinates for this trip.
      </div>
    )
  }

  return (
    <div style={{ height, borderRadius: tokens.radius.md, overflow: 'hidden' }}>
      <MapContainer
        center={points[0]}
        zoom={13}
        style={{ height: '100%', width: '100%' }}
        zoomControl={false}
        attributionControl={false}
      >
        <TileLayer url={TILE_URL} attribution={TILE_ATTRIBUTION} />
        <FitTripBounds points={points} />
        {points[0] && <Marker position={points[0]} icon={pinIcon(lineColor)} />}
        {points[1] && <Marker position={points[1]} icon={pinIcon(tokens.semantic.success)} />}
        {points.length === 2 && (
          <Polyline positions={points} pathOptions={{ color: lineColor, weight: 4 }} />
        )}
      </MapContainer>
    </div>
  )
}
