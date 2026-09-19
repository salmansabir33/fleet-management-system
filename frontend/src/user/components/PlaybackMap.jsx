import { memo, useEffect, useMemo } from 'react'
import { MapContainer, TileLayer, Polyline, Marker, useMap } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { colors } from '../theme'
import {
  buildSegments,
  sampleArrowPoints,
  adaptiveArrowSpacing,
} from '../utils/routeAnalysis'

// Same tile source resolution as VehicleMap.jsx (MapTiler > Mapbox > CARTO
// fallback) — duplicated rather than imported since VehicleMap doesn't
// export it, but kept in sync with the same env vars.
const MAPTILER_KEY = import.meta.env.VITE_MAPTILER_KEY
const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN

const TILE_URL = MAPTILER_KEY
  ? `https://api.maptiler.com/maps/streets-v4/{z}/{x}/{y}.png?key=${MAPTILER_KEY}`
  : MAPBOX_TOKEN
    ? `https://api.mapbox.com/styles/v1/mapbox/streets-v12/tiles/{z}/{x}/{y}@2x?access_token=${MAPBOX_TOKEN}`
    : 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png'

const TILE_ATTRIBUTION = MAPTILER_KEY
  ? '&copy; <a href="https://www.maptiler.com/copyright/" target="_blank">MapTiler</a> &copy; <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a> contributors'
  : MAPBOX_TOKEN
    ? '&copy; <a href="https://www.mapbox.com/about/maps/">Mapbox</a> &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
    : '&copy; <a href="https://carto.com/attributions">CARTO</a> &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'

const TILE_EXTRA_PROPS = MAPTILER_KEY ? { tileSize: 512, zoomOffset: -1 } : {}

// Speed (0..1 of the route's own max) -> color, blue (slow) through red
// (fast) — same rainbow-band idea as Traccar's own replay legend.
const COLOR_STOPS = [
  [0, [37, 99, 235]],
  [0.25, [13, 148, 136]],
  [0.5, [234, 179, 8]],
  [0.75, [249, 115, 22]],
  [1, [220, 38, 38]],
]
const SPEED_BAND_COUNT = 8
const lerp = (a, b, t) => a + (b - a) * t
const speedToColor = (t) => {
  const clamped = Math.max(0, Math.min(1, t || 0))
  for (let i = 0; i < COLOR_STOPS.length - 1; i++) {
    const [t0, c0] = COLOR_STOPS[i]
    const [t1, c1] = COLOR_STOPS[i + 1]
    if (clamped >= t0 && clamped <= t1) {
      const lt = t1 === t0 ? 0 : (clamped - t0) / (t1 - t0)
      return `rgb(${Math.round(lerp(c0[0], c1[0], lt))},${Math.round(lerp(c0[1], c1[1], lt))},${Math.round(lerp(c0[2], c1[2], lt))})`
    }
  }
  const last = COLOR_STOPS[COLOR_STOPS.length - 1][1]
  return `rgb(${last[0]},${last[1]},${last[2]})`
}

const bandColor = (bandIndex) => {
  const mid = (bandIndex + 0.5) / SPEED_BAND_COUNT
  return speedToColor(mid)
}

// Distinct color for "signal lost" segments — deliberately outside the
// blue->red speed gradient (a violet) so it never reads as "very fast"
// or blends into the red end of the legend.
const GAP_COLOR = '#7c3aed'

const playheadIconCache = new Map()
const directionIconCache = new Map()

const roundHeading = (heading) => Math.round((heading || 0) / 5) * 5

const makeArrowIcon = (color, heading) => L.divIcon({
  className: '',
  html: `
    <div style="position:relative;width:22px;height:22px;">
      <div style="
        position:absolute;top:50%;left:50%;width:0;height:0;
        margin:-15px 0 0 -6px;
        border-left:6px solid transparent;border-right:6px solid transparent;
        border-bottom:11px solid ${color};
        transform:rotate(${heading || 0}deg);transform-origin:6px 15px;
        filter:drop-shadow(0 1px 2px rgba(17,24,39,0.4));
      "></div>
      <div style="
        position:absolute;top:50%;left:50%;width:12px;height:12px;
        margin:-6px 0 0 -6px;border-radius:50%;
        background:${color};border:2px solid #fff;
        box-shadow:0 1px 3px rgba(17,24,39,0.4);
      "></div>
    </div>
  `,
  iconSize: [22, 22],
  iconAnchor: [11, 11],
})

const makeDirectionArrowIcon = (color, bearing) => L.divIcon({
  className: '',
  html: `
    <div style="width:14px;height:14px;transform:rotate(${bearing || 0}deg);transform-origin:50% 50%;">
      <div style="
        width:0;height:0;margin:0 auto;
        border-left:5px solid transparent;border-right:5px solid transparent;
        border-bottom:9px solid ${color};
        filter:drop-shadow(0 1px 1px rgba(17,24,39,0.5));
      "></div>
    </div>
  `,
  iconSize: [14, 14],
  iconAnchor: [7, 7],
})

const cachedPlayheadIcon = (color, heading) => {
  const h = roundHeading(heading)
  const key = `${color}|${h}`
  let icon = playheadIconCache.get(key)
  if (!icon) {
    icon = makeArrowIcon(color, h)
    playheadIconCache.set(key, icon)
  }
  return icon
}

const cachedDirectionIcon = (color, bearing) => {
  const h = roundHeading(bearing)
  const key = `${color}|${h}`
  let icon = directionIconCache.get(key)
  if (!icon) {
    icon = makeDirectionArrowIcon(color, h)
    directionIconCache.set(key, icon)
  }
  return icon
}

/**
 * Collapse consecutive same-band drive segments into longer polylines and
 * collect gap segments into one MultiPolyline. Target: O(bands) Leaflet
 * layers instead of one Polyline per consecutive GPS pair.
 */
const buildBandedPathLayers = (points, segments, maxSpeed) => {
  const bands = Array.from({ length: SPEED_BAND_COUNT }, () => [])
  const gapLines = []

  for (const seg of segments) {
    const p = points[seg.index]
    const next = points[seg.index + 1]
    if (!p || !next) continue
    const a = [p.latitude, p.longitude]
    const b = [next.latitude, next.longitude]

    if (seg.isGap) {
      gapLines.push([a, b])
      continue
    }

    const segSpeed = ((p.speed_kmh || 0) + (next.speed_kmh || 0)) / 2
    const ratio = Math.min(1, Math.max(0, segSpeed / maxSpeed))
    const band = Math.min(SPEED_BAND_COUNT - 1, Math.floor(ratio * SPEED_BAND_COUNT))
    const bucket = bands[band]
    const lastLine = bucket[bucket.length - 1]
    if (
      lastLine
      && lastLine[lastLine.length - 1][0] === a[0]
      && lastLine[lastLine.length - 1][1] === a[1]
    ) {
      lastLine.push(b)
    } else {
      bucket.push([a, b])
    }
  }

  return { bands, gapLines }
}

// Fits the map to the currently-shown point set (whole route, or just
// the selected leg) whenever that set changes — not on every playback
// frame, since `bounds` is only recomputed when the underlying point
// set itself changes.
//
// While following, keep the playhead inside a padded "safe" viewport so
// it doesn't sit under the bottom control chrome or drift off an edge
// before a pan triggers.
const MapController = ({ bounds, currentPoint, followPoint }) => {
  const map = useMap()

  useEffect(() => {
    if (bounds) {
      map.fitBounds(bounds, { padding: [32, 32] })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bounds])

  useEffect(() => {
    if (!followPoint || !currentPoint) return

    const size = map.getSize()
    if (!size.x || !size.y) return

    // Leave room for the bottom playback chrome (legend + bar) and a
    // margin from the sides / top so the marker stays readable.
    const padX = Math.max(48, size.x * 0.18)
    const padTop = Math.max(48, size.y * 0.16)
    const padBottom = Math.max(150, size.y * 0.38)
    const sw = map.containerPointToLatLng(L.point(padX, size.y - padBottom))
    const ne = map.containerPointToLatLng(L.point(size.x - padX, padTop))
    const safeBounds = L.latLngBounds(sw, ne)
    const target = L.latLng(currentPoint[0], currentPoint[1])

    if (!safeBounds.contains(target)) {
      map.panTo(target, { animate: true, duration: 0.35, easeLinearity: 0.25 })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPoint, followPoint])

  return null
}

const StaticRouteLayer = memo(function StaticRouteLayer({
  bands,
  gapLines,
  arrowPoints,
  maxSpeed,
}) {
  return (
    <>
      {bands.map((lines, bandIndex) => (
        lines.length > 0 ? (
          <Polyline
            key={`band-${bandIndex}`}
            positions={lines}
            pathOptions={{
              color: bandColor(bandIndex),
              weight: 4,
              opacity: 0.9,
            }}
            interactive={false}
          />
        ) : null
      ))}
      {gapLines.length > 0 && (
        <Polyline
          positions={gapLines}
          pathOptions={{
            color: GAP_COLOR,
            weight: 3,
            opacity: 0.85,
            dashArray: '2 8',
          }}
          interactive={false}
        />
      )}
      {arrowPoints.map((a) => (
        <Marker
          key={`arrow-${a.segmentIndex}`}
          position={[a.lat, a.lon]}
          icon={cachedDirectionIcon(speedToColor((a.speedKmh || 0) / maxSpeed), a.bearing)}
          interactive={false}
        />
      ))}
    </>
  )
})

const PlayheadMarker = memo(function PlayheadMarker({ position, color, course }) {
  if (!position) return null
  return (
    <Marker position={position} icon={cachedPlayheadIcon(color, course)} />
  )
})

/**
 * route: [{ latitude, longitude, speed_kmh, course, fixTime, ... }] — raw
 *   items from GET /api/route/{deviceId}, already in chronological order
 *   and filtered for null coords by Playback.jsx.
 * currentIndex: which point (index into the FULL route) playback is on.
 * legRange: optional { startIdx, endIdx } into the full route — when set,
 *   only that slice is drawn/fitted (used by the Outward/Inward leg
 *   viewer). currentIndex is still an index into the full route either way.
 * followPoint: pan the map to keep the current point in the visible
 *   area above the bottom chrome (used during replay / scrubbing).
 * controls: optional node (the PlaybackBar) rendered as a glass overlay
 *   along the bottom of the map. On mobile the bar is full-width with the
 *   speed legend/gauge stacked above it; on desktop they sit in one row.
 */
const PlaybackMap = ({ route = [], currentIndex = 0, height = 460, followPoint = false, legRange = null, controls = null }) => {
  // Parent already drops null lat/lon; keep a cheap identity so callers
  // that pass a raw array still work without a second O(n) filter copy.
  const points = route

  const maxSpeed = useMemo(
    () => points.reduce((max, p) => Math.max(max, p.speed_kmh || 0), 1),
    [points],
  )

  // Segments are computed over the FULL route so gap detection at a leg
  // boundary is unaffected by where the leg happens to be sliced.
  const segments = useMemo(() => buildSegments(points), [points])

  const sliceStart = legRange ? legRange.startIdx : 0
  const sliceEnd = legRange ? legRange.endIdx : Math.max(0, points.length - 1)

  const visibleSegments = useMemo(
    () => segments.filter((s) => s.index >= sliceStart && s.index < sliceEnd),
    [segments, sliceStart, sliceEnd],
  )

  const totalDistanceM = useMemo(
    () => visibleSegments.reduce((sum, s) => (s.isGap ? sum : sum + s.distanceM), 0),
    [visibleSegments],
  )

  const arrowPoints = useMemo(() => {
    const spacing = adaptiveArrowSpacing(totalDistanceM)
    return sampleArrowPoints(points, visibleSegments, spacing)
  }, [points, visibleSegments, totalDistanceM])

  const pathLayers = useMemo(
    () => buildBandedPathLayers(points, visibleSegments, maxSpeed),
    [points, visibleSegments, maxSpeed],
  )

  const bounds = useMemo(() => {
    if (points.length === 0 || sliceEnd < sliceStart) return null
    let b = null
    for (let i = sliceStart; i <= sliceEnd; i++) {
      const p = points[i]
      if (!p) continue
      const ll = L.latLng(p.latitude, p.longitude)
      b = b ? b.extend(ll) : L.latLngBounds(ll, ll)
    }
    return b
  }, [points, sliceStart, sliceEnd])

  const current = points[Math.min(currentIndex, Math.max(0, points.length - 1))]
  const currentLatLng = current ? [current.latitude, current.longitude] : null
  const currentSpeedRatio = current ? (current.speed_kmh || 0) / maxSpeed : 0
  const currentColor = current ? speedToColor(currentSpeedRatio) : colors.accent

  if (points.length === 0) {
    return (
      <div style={{ ...styles.wrap, height, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <span style={{ color: colors.textMuted, fontSize: 13 }}>No route points in this range.</span>
      </div>
    )
  }

  return (
    <div style={{ ...styles.wrap, height }}>
      <MapContainer
        center={[points[0].latitude, points[0].longitude]}
        zoom={14}
        style={{ height: '100%', width: '100%', background: '#eef1f5' }}
        scrollWheelZoom
      >
        <TileLayer
          attribution={TILE_ATTRIBUTION}
          url={TILE_URL}
          subdomains="abcd"
          maxZoom={19}
          {...TILE_EXTRA_PROPS}
        />

        <StaticRouteLayer
          bands={pathLayers.bands}
          gapLines={pathLayers.gapLines}
          arrowPoints={arrowPoints}
          maxSpeed={maxSpeed}
        />

        <PlayheadMarker
          position={currentLatLng}
          color={currentColor}
          course={current?.course}
        />

        <MapController bounds={bounds} currentPoint={currentLatLng} followPoint={followPoint} />
      </MapContainer>

      <div className="playback-map-overlays">
        <div className="playback-map-meta">
          <div className="playback-map-legend">
            <div className="playback-map-legend-bar" />
            <div className="playback-map-legend-labels">
              <span>0</span>
              <span>{Math.round(maxSpeed)} km/h</span>
            </div>
            <div className="playback-map-legend-gap">
              <span className="playback-map-legend-gap-swatch" aria-hidden />
              <span>Signal lost</span>
            </div>
          </div>

          <div className="playback-map-speed">
            <div
              className="playback-map-speed-ring"
              style={{ borderColor: currentColor }}
            >
              <span className="playback-map-speed-value">
                {Math.round(current?.speed_kmh || 0)}
              </span>
              <span className="playback-map-speed-unit">km/h</span>
            </div>
          </div>
        </div>

        {controls && <div className="playback-map-controls">{controls}</div>}
      </div>
    </div>
  )
}

const styles = {
  wrap: {
    borderRadius: 0,
    overflow: 'hidden',
    position: 'relative',
  },
}

export default memo(PlaybackMap)
