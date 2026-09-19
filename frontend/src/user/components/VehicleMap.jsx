import { useEffect, useMemo, useRef, useState } from 'react'
import { MapContainer, TileLayer, Marker, Tooltip, Polyline, ZoomControl, useMap } from 'react-leaflet'
import { Link, useLocation } from 'react-router-dom'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { X, Battery, Power, Clock, History, Menu, Search, MapPin, Truck, Tag, Gauge } from 'lucide-react'
import { colors, statusMeta } from '../theme'
import { usePanelScope } from '../../manager/hooks/usePanelScope'
import { isVehicleOnline } from '../utils/vehicleStatus'
import { useMediaQuery } from '../hooks/useMediaQuery'
import { colorFromVehicleId } from '../../shared/utils/vehicleMarkerColor'

// ── Basemap ──────────────────────────────────────────────────────────
// Three tiers, picked automatically by which env var is set:
//  1. VITE_MAPTILER_KEY (recommended now) — MapTiler's "Streets" style:
//     genuinely better detail/polish than CARTO Voyager, free tier is
//     100k tile loads/month, and signup needs only an email — Confirmed
//     no credit card required to activate, unlike Mapbox below. Get a
//     free key at https://cloud.maptiler.com/ (Account > Keys).
//     Note: MapTiler's free tier is billed as for non-commercial/
//     evaluation use in their docs — fine for "free for now", but
//     re-check their pricing page before this becomes a paid product.
//  2. VITE_MAPBOX_TOKEN (later, paid path) — Mapbox does require a
//     card on file to activate its free tier (my earlier claim that it
//     didn't was wrong — corrected here), so this stays opt-in only.
//  3. Neither set — CARTO Voyager, the same tile CDN this app already
//     called, no key or signup of any kind, works out of the box.
// Vite only inlines VITE_-prefixed env vars at startup, so restart
// `npm run dev` after adding either to `frontend/.env`.
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

// MapTiler serves 512px tiles at one zoom level "wider" than the
// 256px tiles CARTO/Mapbox use here — tileSize/zoomOffset make the
// zoom numbers line up the same way across all three so nothing else
// in this file (zoom={14}, maxZoom, etc.) needs to change per provider.
const TILE_EXTRA_PROPS = MAPTILER_KEY ? { tileSize: 512, zoomOffset: -1 } : {}


// ── Realistic top-down vehicle markers ───────────────────────────────
// Photorealistic bird's-eye sprites (front = up). Rotated by GPS course
// so the vehicle points the way it's driving — same idea as ride-share
// apps. Unknown/unset types use the sedan.
// Unique color per vehicle id is applied as a soft blend overlay on top
// of the PNG so highlights, windows, and body shading stay intact
// (flat CSS-mask fills looked like colored bars). Moving vehicles get a
// soft pulse in the same identity color.
const VEHICLE_ICON_SRC = {
  car: '/map-vehicles/car.png?v=2',
  van: '/map-vehicles/van.png?v=2',
  truck: '/map-vehicles/truck.png?v=2',
  bike: '/map-vehicles/bike.png?v=2',
  motorcycle: '/map-vehicles/bike.png?v=2',
}

const MARKER_SIZE = 52

// Cache divIcons by visual key so live polls / RAF tween ticks reuse the
// same Leaflet icon instance. Recreating HTML each render restarts the
// CSS pulse and makes markers "pop".
const pinIconCache = new Map()

const headingBucket = (heading) => {
  if (heading == null || Number.isNaN(Number(heading))) return 'none'
  return String(Math.round(Number(heading) / 15) * 15)
}

const pinIcon = (statusKey, heading, vehicleType, markerColor) => {
  const typeKey = (vehicleType || 'car').toLowerCase()
  const rotKey = headingBucket(heading)
  const color = markerColor || colors.textMuted
  const cacheKey = `${statusKey || ''}|${rotKey}|${typeKey}|${color}|blend`
  const cached = pinIconCache.get(cacheKey)
  if (cached) return cached

  const src = VEHICLE_ICON_SRC[typeKey] || VEHICLE_ICON_SRC.car
  const rotation = rotKey === 'none' ? 0 : Number(rotKey)
  const half = MARKER_SIZE / 2
  const pulse = statusKey === 'moving'
    ? `<div class="ft-map-pulse" style="
        position:absolute;top:50%;left:50%;width:32px;height:32px;
        margin:-16px 0 0 -16px;border-radius:50%;background:${color};
      "></div>`
    : ''
  // Stack: detailed PNG (depth) + masked color wash with mix-blend-mode
  // so luminance/shading survive. Drop-shadow on the wrapper so the
  // vehicle reads as sitting on the map.
  const icon = L.divIcon({
    className: 'ft-vehicle-marker',
    html: `
      <div style="position:relative;width:${MARKER_SIZE}px;height:${MARKER_SIZE}px;background:transparent;">
        ${pulse}
        <div
          style="
            position:absolute;top:50%;left:50%;
            width:${MARKER_SIZE}px;height:${MARKER_SIZE}px;
            margin:-${half}px 0 0 -${half}px;
            transform:rotate(${rotation}deg);
            filter:drop-shadow(0 2px 3px rgba(0,0,0,.5)) drop-shadow(0 6px 8px rgba(0,0,0,.22));
            pointer-events:none;
            user-select:none;
          "
        >
          <img
            src="${src}"
            alt=""
            draggable="false"
            style="
              display:block;
              width:100%;
              height:100%;
              object-fit:contain;
              background:transparent;
              filter:brightness(1.35) contrast(1.08);
            "
          />
          <div
            aria-hidden="true"
            style="
              position:absolute;inset:0;
              background:${color};
              opacity:0.88;
              mix-blend-mode:soft-light;
              -webkit-mask-image:url('${src}');
              mask-image:url('${src}');
              -webkit-mask-size:contain;
              mask-size:contain;
              -webkit-mask-repeat:no-repeat;
              mask-repeat:no-repeat;
              -webkit-mask-position:center;
              mask-position:center;
            "
          ></div>
          <div
            aria-hidden="true"
            style="
              position:absolute;inset:0;
              background:${color};
              opacity:0.55;
              mix-blend-mode:color;
              -webkit-mask-image:url('${src}');
              mask-image:url('${src}');
              -webkit-mask-size:contain;
              mask-size:contain;
              -webkit-mask-repeat:no-repeat;
              mask-repeat:no-repeat;
              -webkit-mask-position:center;
              mask-position:center;
            "
          ></div>
        </div>
      </div>
    `,
    iconSize: [MARKER_SIZE, MARKER_SIZE],
    iconAnchor: [half, half],
  })
  pinIconCache.set(cacheKey, icon)
  return icon
}

// ── Movement animation ───────────────────────────────────────────────
// Each poll snaps the reported lat/lon straight from the server — with
// nothing else, the marker jumps every 10s instead of looking like it's
// driving. This tweens the marker smoothly from its last drawn position
// to each new one over ANIMATION_MS, keyed per vehicle id so switching
// to a different vehicle (a new id) snaps instantly instead of sliding
// across the map from an unrelated location.
const ANIMATION_MS = 2500
// Assumption: jumps bigger than this (~5.5km at the equator) are
// treated as a correction/anomaly, not real driving between polls, and
// are snapped instantly instead of animated — sliding a marker across
// a huge distance in 2.5s would look broken, not "alive". If this
// fires too often for your fleet's speed/poll interval, raise it.
const MAX_ANIMATED_DELTA_DEG = 0.05

const easeInOutCubic = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2)

const useAnimatedVehicles = (vehicles) => {
  const stateRef = useRef(new Map()) // id -> { from:[lat,lon], to:[lat,lon], start, done }
  const rafRef = useRef(null)
  const [, forceRender] = useState(0)

  useEffect(() => {
    const state = stateRef.current
    const now = performance.now()
    const seenIds = new Set()

    vehicles.forEach((v) => {
      if (v.lat == null || v.lon == null) return
      seenIds.add(v.id)
      const to = [v.lat, v.lon]
      const prev = state.get(v.id)
      if (!prev) {
        // First time we've seen this id — draw it in place, no slide-in.
        state.set(v.id, { from: to, to, start: now, done: true })
        return
      }
      if (prev.to[0] === to[0] && prev.to[1] === to[1]) return // unchanged

      const t = prev.done ? 1 : Math.min(1, (now - prev.start) / ANIMATION_MS)
      const eased = easeInOutCubic(t)
      const currentDrawn = [
        prev.from[0] + (prev.to[0] - prev.from[0]) * eased,
        prev.from[1] + (prev.to[1] - prev.from[1]) * eased,
      ]
      const jumpTooFar = Math.abs(to[0] - currentDrawn[0]) > MAX_ANIMATED_DELTA_DEG
        || Math.abs(to[1] - currentDrawn[1]) > MAX_ANIMATED_DELTA_DEG
      state.set(v.id, jumpTooFar
        ? { from: to, to, start: now, done: true }
        : { from: currentDrawn, to, start: now, done: false })
    })

    // Vehicle no longer in the list (deselected/removed) — drop its state.
    for (const id of state.keys()) {
      if (!seenIds.has(id)) state.delete(id)
    }

    const anyActive = Array.from(state.values()).some((e) => !e.done)
    if (anyActive && !rafRef.current) {
      const tick = () => {
        const t = performance.now()
        let stillActive = false
        state.forEach((entry) => {
          if (!entry.done && (t - entry.start) / ANIMATION_MS >= 1) entry.done = true
          if (!entry.done) stillActive = true
        })
        forceRender((n) => n + 1)
        rafRef.current = stillActive ? requestAnimationFrame(tick) : null
      }
      rafRef.current = requestAnimationFrame(tick)
    }
  }, [vehicles])

  useEffect(() => () => { if (rafRef.current) cancelAnimationFrame(rafRef.current) }, [])

  return useMemo(() => vehicles.map((v) => {
    if (v.lat == null || v.lon == null) return v
    const entry = stateRef.current.get(v.id)
    if (!entry) return v
    const t = entry.done ? 1 : Math.min(1, (performance.now() - entry.start) / ANIMATION_MS)
    const eased = easeInOutCubic(t)
    return {
      ...v,
      lat: entry.from[0] + (entry.to[0] - entry.from[0]) * eased,
      lon: entry.from[1] + (entry.to[1] - entry.from[1]) * eased,
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [vehicles])
}

const DEFAULT_CENTER = [31.4504, 73.1350] // Faisalabad — fallback when no vehicle has a position yet

const fmt = (v, digits = 0, suffix = '') => (v == null ? '—' : `${Number(v).toFixed(digits)}${suffix}`)

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

// A free-floating info card (desktop) or bottom sheet (mobile list mode).
// Rendered as a sibling of the Leaflet map so it isn't tied to Leaflet's
// hover lifecycle — opens on click and stays open until dismissed.
const SPEED_GAUGE_MAX_KMH = 120

const VehicleInfoCard = ({ vehicle, meta, onClose, onMoreDetails, variant = 'card' }) => {
  const [pos, setPos] = useState({ x: 24, y: 24 }) // offset from top-left of the map
  const dragRef = useRef(null)
  const location = useLocation()
  const { basePath } = usePanelScope()
  // usePanelScope defaults to /admin when there is no ManagerScopeProvider,
  // including on User pages — detect the User shell from the URL instead.
  const isUserShell = location.pathname.startsWith('/user')
  const replayTo = isUserShell
    ? '/user/playback'
    : `${basePath}/playback/${vehicle.id}`
  const isSheet = variant === 'sheet'
  const online = isVehicleOnline(vehicle.status)
  const speedKmh = Number(vehicle.speedKmh) || 0
  const speedPct = Math.max(0, Math.min(100, (speedKmh / SPEED_GAUGE_MAX_KMH) * 100))

  const startDrag = (e) => {
    if (isSheet) return
    const startX = e.clientX
    const startY = e.clientY
    const origin = { ...pos }
    dragRef.current = { startX, startY, origin }

    const onMove = (moveEvent) => {
      const dx = moveEvent.clientX - dragRef.current.startX
      const dy = moveEvent.clientY - dragRef.current.startY
      setPos({ x: dragRef.current.origin.x + dx, y: dragRef.current.origin.y + dy })
    }
    const onUp = () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  const statusBlock = online ? (
    <>
      <span style={{ ...styles.statusDot, background: statusMeta.moving.color }} />
      <span style={{ ...styles.statusLabel, color: statusMeta.moving.color }}>Online</span>
      <span style={{ ...styles.statusLabel, color: meta.color }}>· {meta.label}</span>
    </>
  ) : (
    <>
      <span style={{ ...styles.statusDot, background: meta.color }} />
      <span style={{ ...styles.statusLabel, color: meta.color }}>{meta.label}</span>
    </>
  )

  const body = (
    <>
      {vehicle.plateNumber && (
        <div style={styles.cardRow}>
          <span style={styles.cardLabel}>Plate</span>
          <span style={styles.cardValue}>{vehicle.plateNumber}</span>
        </div>
      )}
      {vehicle.vehicleType && (
        <div style={styles.cardRow}>
          <span style={styles.cardLabel}>Type</span>
          <span style={{ ...styles.cardValue, textTransform: 'capitalize' }}>
            {vehicle.vehicleType}
          </span>
        </div>
      )}
      <div style={styles.cardRow}>
        <span style={styles.cardLabel}>Speed</span>
        <span style={styles.cardValue}>{fmt(vehicle.speedKmh, 0, ' km/h')}</span>
      </div>
      {vehicle.distanceKm != null && (
        <div style={styles.cardRow}>
          <span style={styles.cardLabel}>Distance today</span>
          <span style={styles.cardValue}>{fmt(vehicle.distanceKm, 1, ' km')}</span>
        </div>
      )}
      {vehicle.ignition != null && (
        <div style={styles.cardRow}>
          <span style={styles.cardLabel}><Power size={11} style={styles.inlineIcon} /> Ignition</span>
          <span style={styles.cardValue}>{vehicle.ignition ? 'On' : 'Off'}</span>
        </div>
      )}
      {vehicle.batteryLevel != null && (
        <div style={styles.cardRow}>
          <span style={styles.cardLabel}><Battery size={11} style={styles.inlineIcon} /> Battery</span>
          <span style={styles.cardValue}>{vehicle.batteryLevel}%</span>
        </div>
      )}
      <div style={styles.cardRow}>
        <span style={styles.cardLabel}>Position</span>
        <span style={styles.cardValue}>{vehicle.lat.toFixed(4)}, {vehicle.lon.toFixed(4)}</span>
      </div>
      {vehicle.lastUpdate && (
        <div style={styles.cardRow}>
          <span style={styles.cardLabel}><Clock size={11} style={styles.inlineIcon} /> Updated</span>
          <span style={styles.cardValue}>{timeAgo(vehicle.lastUpdate)}</span>
        </div>
      )}

      <div style={styles.cardActions}>
        <Link to={replayTo} style={styles.routeLink}>
          <History size={12} style={styles.inlineIcon} /> Replay
        </Link>
        {onMoreDetails && (
          <button type="button" style={styles.detailsBtn} onClick={() => onMoreDetails(vehicle.id)}>
            More details
          </button>
        )}
      </div>
    </>
  )

  if (isSheet) {
    const statusColor = online ? statusMeta.moving.color : meta.color
    const statusText = online ? `Online · ${meta.label}` : meta.label

    return (
      <div className="ft-map-vehicle-sheet" role="dialog" aria-label="Vehicle details">
        <div className="ft-map-vehicle-sheet__handle" aria-hidden />

        <div className="ft-map-vehicle-sheet__header">
          <span
            className="ft-map-vehicle-sheet__status-dot"
            style={{ background: statusColor }}
            aria-hidden
          />
          <span className="ft-map-vehicle-sheet__name">{vehicle.name}</span>
          <span
            className="ft-map-vehicle-sheet__badge"
            style={{ color: statusColor, background: `${statusColor}1a`, borderColor: `${statusColor}33` }}
          >
            {statusText}
          </span>
          <button
            type="button"
            className="ft-map-vehicle-sheet__close"
            onClick={onClose}
            aria-label="Close vehicle details"
          >
            <X size={14} />
          </button>
        </div>

        <div className="ft-map-vehicle-sheet__hero">
          <div
            className="ft-map-vehicle-sheet__gauge"
            style={{
              background: `conic-gradient(var(--ft-primary) ${speedPct}%, var(--ft-border, #e5e7eb) 0)`,
            }}
            aria-label={`Speed ${fmt(vehicle.speedKmh, 0, ' km/h')}`}
          >
            <div className="ft-map-vehicle-sheet__gauge-inner">
              <strong>{fmt(vehicle.speedKmh, 0)}</strong>
              <span>km/h</span>
            </div>
          </div>

          {vehicle.ignition != null && (
            <div className="ft-map-vehicle-sheet__hero-stat">
              <span className="ft-map-vehicle-sheet__hero-icon" aria-hidden>
                <Power size={12} />
              </span>
              <span className="ft-map-vehicle-sheet__hero-label">Ignition</span>
              <strong className="ft-map-vehicle-sheet__hero-value">
                {vehicle.ignition ? 'ON' : 'OFF'}
              </strong>
            </div>
          )}

          {vehicle.lastUpdate && (
            <div className="ft-map-vehicle-sheet__hero-stat">
              <span className="ft-map-vehicle-sheet__hero-icon" aria-hidden>
                <Clock size={12} />
              </span>
              <span className="ft-map-vehicle-sheet__hero-label">Updated</span>
              <strong className="ft-map-vehicle-sheet__hero-value">
                {timeAgo(vehicle.lastUpdate)}
              </strong>
            </div>
          )}
        </div>

        <div className="ft-map-vehicle-sheet__grid">
          {vehicle.plateNumber && (
            <div className="ft-map-vehicle-sheet__cell">
              <Tag size={11} aria-hidden />
              <span className="ft-map-vehicle-sheet__cell-label">Plate</span>
              <strong className="ft-map-vehicle-sheet__cell-value">{vehicle.plateNumber}</strong>
            </div>
          )}
          {vehicle.vehicleType && (
            <div className="ft-map-vehicle-sheet__cell">
              <Truck size={11} aria-hidden />
              <span className="ft-map-vehicle-sheet__cell-label">Type</span>
              <strong className="ft-map-vehicle-sheet__cell-value" style={{ textTransform: 'capitalize' }}>
                {vehicle.vehicleType}
              </strong>
            </div>
          )}
          <div className="ft-map-vehicle-sheet__cell">
            <Gauge size={11} aria-hidden />
            <span className="ft-map-vehicle-sheet__cell-label">Speed</span>
            <strong className="ft-map-vehicle-sheet__cell-value">{fmt(vehicle.speedKmh, 0, ' km/h')}</strong>
          </div>
          {vehicle.batteryLevel != null && (
            <div className="ft-map-vehicle-sheet__cell">
              <Battery size={11} aria-hidden />
              <span className="ft-map-vehicle-sheet__cell-label">Battery</span>
              <strong className="ft-map-vehicle-sheet__cell-value">{vehicle.batteryLevel}%</strong>
            </div>
          )}
          <div className="ft-map-vehicle-sheet__cell">
            <MapPin size={11} aria-hidden />
            <span className="ft-map-vehicle-sheet__cell-label">Location</span>
            <strong className="ft-map-vehicle-sheet__cell-value">
              {vehicle.lat.toFixed(4)}, {vehicle.lon.toFixed(4)}
            </strong>
          </div>
          {vehicle.distanceKm != null && (
            <div className="ft-map-vehicle-sheet__cell">
              <Gauge size={11} aria-hidden />
              <span className="ft-map-vehicle-sheet__cell-label">Distance today</span>
              <strong className="ft-map-vehicle-sheet__cell-value">{fmt(vehicle.distanceKm, 1, ' km')}</strong>
            </div>
          )}
        </div>

        <div className="ft-map-vehicle-sheet__footer">
          <Link to={replayTo} className="ft-map-vehicle-sheet__action">
            <History size={12} aria-hidden />
            Replay
          </Link>
          {onMoreDetails && (
            <button
              type="button"
              className="ft-map-vehicle-sheet__action"
              onClick={() => onMoreDetails(vehicle.id)}
            >
              Info
            </button>
          )}
        </div>
      </div>
    )
  }

  return (
    <div style={{ ...styles.card, left: pos.x, top: pos.y }}>
      <div style={styles.cardHeader} onMouseDown={startDrag}>
        <span style={styles.cardName}>{vehicle.name}</span>
        {statusBlock}
        <button
          type="button"
          style={styles.closeBtn}
          onClick={onClose}
          onMouseDown={(e) => e.stopPropagation()}
          aria-label="Close vehicle details"
        >
          <X size={14} />
        </button>
      </div>
      {body}
    </div>
  )
}

const MobileVehicleList = ({ vehicles, onSelect, onClose }) => {
  const [query, setQuery] = useState('')
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return vehicles
    return vehicles.filter((v) => (v.name || '').toLowerCase().includes(q)
      || (v.plateNumber || '').toLowerCase().includes(q))
  }, [vehicles, query])

  return (
    <>
      <button
        type="button"
        className="ft-map-vehicle-list-backdrop"
        aria-label="Close vehicle list"
        onClick={onClose}
      />
      <div className="ft-map-vehicle-list" role="dialog" aria-label="Vehicle list">
        <div className="ft-map-vehicle-list__header">
          <span className="ft-map-vehicle-list__title">Vehicles</span>
          <button
            type="button"
            className="ft-map-vehicle-list__close"
            onClick={onClose}
            aria-label="Close vehicle list"
          >
            <X size={16} />
          </button>
        </div>
        <label className="ft-map-vehicle-list__search">
          <Search size={14} aria-hidden />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search vehicles"
            autoComplete="off"
          />
        </label>
        <ul className="ft-map-vehicle-list__items">
          {filtered.length === 0 && (
            <li className="ft-map-vehicle-list__empty">No vehicles found</li>
          )}
          {filtered.map((v) => {
            const meta = statusMeta[v.status] || { label: v.status || 'Unknown', color: colors.textMuted }
            return (
              <li key={v.id}>
                <button
                  type="button"
                  className="ft-map-vehicle-list__row"
                  onClick={() => onSelect(v.id)}
                >
                  <span
                    className="ft-map-vehicle-list__dot"
                    style={{ background: meta.color }}
                    aria-hidden
                  />
                  <span className="ft-map-vehicle-list__name">{v.name || 'Unnamed'}</span>
                  <span className="ft-map-vehicle-list__status" style={{ color: meta.color }}>
                    {meta.label}
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      </div>
    </>
  )
}

const FitTrailBounds = ({ points }) => {
  const map = useMap()
  const boundsKey = points.map((p) => `${p[0]?.toFixed?.(5) ?? p[0]},${p[1]?.toFixed?.(5) ?? p[1]}`).join('|')

  useEffect(() => {
    if (!points?.length) return
    if (points.length === 1) {
      map.setView(points[0], 14)
      return
    }
    map.fitBounds(L.latLngBounds(points), { padding: [36, 36], maxZoom: 16 })
    // boundsKey captures coordinate changes without a new array each render
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boundsKey, map])

  return null
}

// Fits the map to show every vehicle marker (admin fleet overview).
const FitAllBounds = ({ vehicles }) => {
  const map = useMap()
  const boundsKey = useMemo(
    () => vehicles.map((v) => `${v.id}:${v.lat?.toFixed(5)},${v.lon?.toFixed(5)}`).join('|'),
    [vehicles],
  )

  useEffect(() => {
    if (vehicles.length === 0) return
    if (vehicles.length === 1) {
      map.setView([vehicles[0].lat, vehicles[0].lon], 14)
      return
    }
    const bounds = L.latLngBounds(vehicles.map((v) => [v.lat, v.lon]))
    map.fitBounds(bounds, { padding: [48, 48], maxZoom: 14 })
  }, [boundsKey, map, vehicles.length])

  return null
}

// Pans/zooms the live map to a specific vehicle whenever `focusId`
// (or that vehicle's position) changes. Lives inside <MapContainer> so
// it can reach the Leaflet map instance via useMap(). Renders nothing.
const FlyToFocus = ({ vehicle }) => {
  const map = useMap()
  useEffect(() => {
    if (!vehicle || vehicle.lat == null || vehicle.lon == null) return
    map.flyTo([vehicle.lat, vehicle.lon], Math.max(map.getZoom(), 14), { duration: 0.8 })
  }, [vehicle?.id, vehicle?.lat, vehicle?.lon, map])
  return null
}

// Keeps a single vehicle centered as live position updates (detail pages).
const FollowVehicle = ({ vehicle }) => {
  const map = useMap()
  const didInit = useRef(false)

  useEffect(() => {
    if (!vehicle || vehicle.lat == null || vehicle.lon == null) return
    const latLng = L.latLng(vehicle.lat, vehicle.lon)

    if (!didInit.current) {
      didInit.current = true
      map.setView(latLng, Math.max(map.getZoom(), 14), { animate: false })
      return
    }

    map.panTo(latLng, { animate: true, duration: 0.5 })
  }, [vehicle?.id, vehicle?.lat, vehicle?.lon, map])

  useEffect(() => {
    didInit.current = false
  }, [vehicle?.id])

  return null
}

// Keeps Leaflet tile layout in sync when the map container is flex-sized.
const MapResizeSync = () => {
  const map = useMap()
  useEffect(() => {
    const sync = () => map.invalidateSize()
    sync()
    const container = map.getContainer()?.parentElement
    if (!container) return undefined

    const observer = new ResizeObserver(sync)
    observer.observe(container)
    const delayed = window.setTimeout(sync, 150)

    return () => {
      observer.disconnect()
      window.clearTimeout(delayed)
    }
  }, [map])
  return null
}

/**
 * vehicles: [{ id, name, lat, lon, status, speedKmh, distanceKm, ignition?, batteryLevel?, lastUpdate?, heading?, vehicleType?, plateNumber? }]
 * onMoreDetails?: (vehicleId) => void — when provided, the info card
 * shows a "More details" button that calls this instead of linking away.
 * focusId?: vehicle id to pan/zoom the map to (e.g. selecting a row in
 * a list next to the map) — also opens that vehicle's info card, same
 * as clicking its marker directly.
 * followId?: vehicle id to keep on-screen as live positions update
 * (soft-pans when the marker nears the edge). Does not open the info card.
 * fitAllVehicles?: when true, fit map bounds to all markers on load/update
 * (until a vehicle is selected). Clicking a marker zooms in and opens
 * the details card.
 * trail?: [[lat, lon], ...] recent path to draw under the live marker.
 * trailColor?: polyline stroke (defaults to brand indigo).
 * zoomPosition?: Leaflet zoom control corner (default topleft).
 * showMobileVehicleList?: on narrow viewports, hide zoom controls and
 * show a menu that opens a floating vehicle list + bottom detail sheet.
 */
const LEGEND_ITEMS = [
  { key: 'moving', label: 'Moving' },
  { key: 'idle', label: 'Idle' },
  { key: 'stopped', label: 'Parked' },
  { key: 'offline', label: 'Offline' },
]

const VehicleMap = ({
  vehicles = [],
  height = 320,
  onMoreDetails,
  focusId = null,
  followId = null,
  showLegend = false,
  fitAllVehicles = false,
  trail = null,
  trailColor = '#4f46e5',
  zoomPosition = 'topleft',
  showMobileVehicleList = false,
  className,
}) => {
  const isMobile = useMediaQuery('(max-width: 820px)')
  const mobileListMode = showMobileVehicleList && isMobile
  const animatedVehicles = useAnimatedVehicles(vehicles)
  const withPosition = animatedVehicles.filter((v) => v.lat != null && v.lon != null)
  const boundsVehicles = useMemo(
    () => vehicles.filter((v) => v.lat != null && v.lon != null),
    [vehicles],
  )
  const center = withPosition.length > 0
    ? [withPosition[0].lat, withPosition[0].lon]
    : DEFAULT_CENTER

  const [openId, setOpenId] = useState(null)
  const [listOpen, setListOpen] = useState(false)
  const openVehicle = withPosition.find((v) => v.id === openId)
  const focusVehicle = withPosition.find((v) => v.id === focusId)
  // Follow the reported (non-animated) position so we don't pan every RAF tick.
  const followVehicle = boundsVehicles.find((v) => String(v.id) === String(followId))
  const zoomVehicle = focusVehicle || openVehicle
  const trailPoints = Array.isArray(trail) ? trail.filter((p) => p?.[0] != null && p?.[1] != null) : []
  const shouldFitAll = fitAllVehicles && !zoomVehicle && !followVehicle && boundsVehicles.length > 0
  const shouldFitTrail = trailPoints.length > 0 && !zoomVehicle && !followVehicle && !shouldFitAll

  const handleMarkerClick = (vehicleId) => {
    setOpenId(vehicleId)
  }

  const handleListSelect = (vehicleId) => {
    setOpenId(vehicleId)
    setListOpen(false)
  }

  // If the open vehicle disappears from the list (e.g. lost its
  // position on a refresh), close the card instead of showing stale data.
  useEffect(() => {
    if (openId && !openVehicle) setOpenId(null)
  }, [openId, openVehicle])

  // Selecting a vehicle externally (e.g. clicking it in a list) opens
  // its info card too, same as clicking its marker on the map.
  useEffect(() => {
    if (focusId != null) setOpenId(focusId)
  }, [focusId])

  // Close the floating list when leaving mobile list mode (resize to desktop).
  useEffect(() => {
    if (!mobileListMode) setListOpen(false)
  }, [mobileListMode])

  return (
    <div
      className={['ft-vehicle-map', className].filter(Boolean).join(' ')}
      style={{ height, overflow: 'hidden', position: 'relative' }}
    >
      <MapContainer
        center={center}
        zoom={withPosition.length > 0 ? 14 : 6}
        style={{ height: '100%', width: '100%', background: '#eef1f5' }}
        scrollWheelZoom={false}
        zoomControl={false}
        attributionControl={false}
      >
        <TileLayer
          attribution={TILE_ATTRIBUTION}
          url={TILE_URL}
          subdomains="abcd"
          maxZoom={19}
          {...TILE_EXTRA_PROPS}
        />
        {!mobileListMode && <ZoomControl position={zoomPosition} />}
        <MapResizeSync />
        {shouldFitAll && <FitAllBounds vehicles={boundsVehicles} />}
        {shouldFitTrail && <FitTrailBounds points={trailPoints} />}
        {followVehicle && <FollowVehicle vehicle={followVehicle} />}
        {zoomVehicle && !followVehicle && <FlyToFocus vehicle={zoomVehicle} />}
        {trailPoints.length > 1 && (
          <Polyline
            positions={trailPoints}
            pathOptions={{ color: trailColor, weight: 4, opacity: 0.85 }}
          />
        )}
        {withPosition.map((v) => (
          <Marker
            key={v.id}
            position={[v.lat, v.lon]}
            icon={pinIcon(v.status, v.heading, v.vehicleType, colorFromVehicleId(v.id))}
            eventHandlers={{ click: () => handleMarkerClick(v.id) }}
          >
            <Tooltip permanent direction="top" offset={[0, -28]} className="vehicle-name-label">
              {v.name}
            </Tooltip>
          </Marker>
        ))}
      </MapContainer>

      {mobileListMode && (
        <button
          type="button"
          className="ft-map-menu-btn"
          onClick={() => setListOpen(true)}
          aria-label="Open vehicle list"
        >
          <Menu size={18} />
        </button>
      )}

      {mobileListMode && listOpen && (
        <MobileVehicleList
          vehicles={withPosition}
          onSelect={handleListSelect}
          onClose={() => setListOpen(false)}
        />
      )}

      {showLegend && (
        <div style={styles.legend}>
          {LEGEND_ITEMS.map((item) => (
            <span key={item.key} style={styles.legendItem}>
              <span
                style={{
                  ...styles.legendDot,
                  background: statusMeta[item.key]?.color || colors.textMuted,
                }}
              />
              {item.label}
            </span>
          ))}
        </div>
      )}

      {openVehicle && (
        <VehicleInfoCard
          vehicle={openVehicle}
          meta={statusMeta[openVehicle.status] || { label: openVehicle.status || 'Unknown', color: colors.textMuted }}
          onClose={() => setOpenId(null)}
          onMoreDetails={onMoreDetails}
          variant={mobileListMode ? 'sheet' : 'card'}
        />
      )}
    </div>
  )
}

const styles = {
  card: {
    position: 'absolute',
    zIndex: 500,
    background: colors.surface,
    borderRadius: 12,
    boxShadow: 'var(--ft-shadow-dropdown)',
    padding: '12px 14px',
    minWidth: 240,
    fontFamily: 'inherit',
  },
  cardHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    marginBottom: 8,
    paddingBottom: 8,
    borderBottom: `1px solid ${colors.border}`,
    cursor: 'grab',
    userSelect: 'none',
  },
  cardName: {
    fontSize: 14,
    fontWeight: 700,
    color: colors.text,
    marginRight: 'auto',
  },
  statusDot: {
    width: 7,
    height: 7,
    borderRadius: '50%',
    display: 'inline-block',
  },
  statusLabel: {
    fontSize: 11,
    fontWeight: 700,
  },
  closeBtn: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: 20,
    height: 20,
    marginLeft: 4,
    border: 'none',
    borderRadius: 6,
    background: colors.bg,
    color: colors.textMuted,
    cursor: 'pointer',
    flexShrink: 0,
  },
  cardRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    marginBottom: 4,
  },
  cardLabel: {
    display: 'inline-flex',
    alignItems: 'center',
    fontSize: 12,
    color: colors.textMuted,
  },
  inlineIcon: {
    marginRight: 4,
  },
  cardValue: {
    fontSize: 12,
    fontWeight: 600,
    color: colors.text,
  },
  detailsBtn: {
    flex: 1,
    padding: '7px 10px',
    borderRadius: 8,
    border: 'none',
    background: colors.accent,
    color: 'var(--ft-surface)',
    fontSize: 12,
    fontWeight: 700,
    cursor: 'pointer',
  },
  cardActions: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    marginTop: 8,
  },
  routeLink: {
    display: 'inline-flex',
    alignItems: 'center',
    fontSize: 12,
    fontWeight: 600,
    color: colors.accent,
    whiteSpace: 'nowrap',
  },
  legend: {
    position: 'absolute',
    left: 12,
    bottom: 12,
    zIndex: 450,
    display: 'flex',
    flexWrap: 'wrap',
    gap: 10,
    padding: '8px 12px',
    borderRadius: 10,
    background: 'rgba(255,255,255,0.94)',
    boxShadow: 'var(--ft-shadow-md)',
    fontSize: 11,
    fontWeight: 600,
    color: colors.textSecondary,
  },
  legendItem: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 5,
  },
  legendDot: {
    width: 8,
    height: 8,
    borderRadius: '50%',
    display: 'inline-block',
  },
}

export default VehicleMap