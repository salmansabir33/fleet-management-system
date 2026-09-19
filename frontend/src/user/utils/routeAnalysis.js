// Route-level analysis for the Playback map: which segments are a real
// drive vs a GPS "signal lost, teleported back" gap, where to place
// direction arrowheads, and (trip mode) how to split a single Trip's
// route into exactly two legs — Outward and Inward — at the vehicle's
// farthest genuine stop from its geofence.

// Mirrors the exact formula backend/tracker_backend/services/position_writer.py
// uses (haversine_meters) — kept in sync deliberately so a "signal lost"
// call here means the same thing a GPS anomaly means server-side.
export const haversineMeters = (lat1, lon1, lat2, lon2) => {
  const R = 6371000
  const toRad = (d) => (d * Math.PI) / 180
  const phi1 = toRad(lat1)
  const phi2 = toRad(lat2)
  const dPhi = toRad(lat2 - lat1)
  const dLambda = toRad(lon2 - lon1)
  const a =
    Math.sin(dPhi / 2) ** 2 +
    Math.cos(phi1) * Math.cos(phi2) * Math.sin(dLambda / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(a))
}

// Compass bearing in degrees (0 = north, clockwise) from point A to B —
// used to orient an arrowhead when Traccar's own `course` field on the
// destination point is missing.
export const bearingDegrees = (lat1, lon1, lat2, lon2) => {
  const toRad = (d) => (d * Math.PI) / 180
  const toDeg = (r) => (r * 180) / Math.PI
  const phi1 = toRad(lat1)
  const phi2 = toRad(lat2)
  const dLambda = toRad(lon2 - lon1)
  const y = Math.sin(dLambda) * Math.cos(phi2)
  const x =
    Math.cos(phi1) * Math.sin(phi2) -
    Math.sin(phi1) * Math.cos(phi2) * Math.cos(dLambda)
  return (toDeg(Math.atan2(y, x)) + 360) % 360
}

// ── Signal-loss ("gap") detection ─────────────────────────────────────
// A segment is flagged as a gap if EITHER condition holds — matches
// what was agreed: a long silence, OR a physically implausible jump
// even across a short silence.
const GAP_TIME_SECONDS = 3 * 60 // 3 minutes
const GAP_MAX_PLAUSIBLE_SPEED_KMH = 180 // same cutoff as position_writer.py

// One entry per consecutive pair of points in `points`, describing the
// segment FROM points[i] TO points[i+1].
export const buildSegments = (points) => {
  const segments = []
  // Parse timestamps once — calling `new Date` twice per edge dominated
  // main-thread cost on 5k–10k point routes. Same gap thresholds.
  const timesMs = new Array(points.length)
  for (let i = 0; i < points.length; i++) {
    const p = points[i]
    timesMs[i] = p._fixMs != null ? p._fixMs : Date.parse(p.fixTime)
  }
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i]
    const b = points[i + 1]
    const distanceM = haversineMeters(a.latitude, a.longitude, b.latitude, b.longitude)
    const timeS = (timesMs[i + 1] - timesMs[i]) / 1000
    const impliedSpeedKmh = timeS > 0 ? (distanceM / 1000) / (timeS / 3600) : 0
    const isGap = timeS > GAP_TIME_SECONDS || impliedSpeedKmh > GAP_MAX_PLAUSIBLE_SPEED_KMH
    segments.push({ index: i, distanceM, timeS, impliedSpeedKmh, isGap })
  }
  return segments
}

// ── Direction arrowheads ──────────────────────────────────────────────
// Arrows are placed roughly every `spacingMeters` of ACTUAL travel
// (not one per raw ping) so a route with hundreds of points doesn't
// turn into a solid line of triangles. Spacing widens automatically for
// very long routes so the arrow count stays reasonable.
export const adaptiveArrowSpacing = (totalDistanceM, targetArrowCount = 120) =>
  Math.max(120, totalDistanceM / targetArrowCount)

// `segments` may be the FULL route's segments, or a filtered slice of
// them (e.g. just the Inward leg) — either way, each `seg` carries its
// own true index into the FULL `points` array (`seg.index`), so we must
// look points up by that, never by the loop's own position in
// `segments`. Indexing by loop position instead of seg.index was the
// bug that, for any leg not starting at 0 (e.g. Inward), silently
// pulled `a`/`b` from the wrong end of the route entirely — arrows for
// the Inward leg were drawn using Outward's points, leaving Inward
// arrowless and drawing a phantom extra line back near the start.
export const sampleArrowPoints = (points, segments, spacingMeters) => {
  const arrows = []
  let accumulated = spacingMeters // place the first arrow near the start too
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i]
    accumulated += seg.distanceM
    if (!seg.isGap && seg.distanceM > 0 && accumulated >= spacingMeters) {
      const a = points[seg.index]
      const b = points[seg.index + 1]
      arrows.push({
        segmentIndex: seg.index,
        lat: b.latitude,
        lon: b.longitude,
        bearing: b.course != null ? b.course : bearingDegrees(a.latitude, a.longitude, b.latitude, b.longitude),
        speedKmh: b.speed_kmh || 0,
      })
      accumulated = 0
    }
  }
  return arrows
}

// ── Trip leg splitting (Outward / Inward — single farthest-stop split) ─
// A trip is split into exactly two legs — Outward and Inward — at the
// point where the vehicle came to a genuine stop (not a red light) while
// farthest from the trip's primary geofence. That's the trip's real
// "destination stop", so the split is always binary, no matter how many
// times the raw distance-from-home curve wiggles up and down along the
// way (traffic, detours, a quick errand near the far end, etc).
//
// "Genuine stop" = speed at/under STOP_SPEED_KMH_THRESHOLD for at least
// MIN_STOP_SECONDS continuously. Tunable within the requested 5–10
// minute window; 5 minutes is the current floor.
const STOP_SPEED_KMH_THRESHOLD = 2 // matches backend's SPEED_MOVING_THRESHOLD_KMH
const MIN_STOP_SECONDS = 5 * 60 // 5 minutes

// Groups consecutive slow-or-stopped points into stop candidates and
// keeps only the ones that lasted at least minDurationSeconds.
const findQualifyingStops = (points, speedThresholdKmh, minDurationSeconds) => {
  const stops = []
  let i = 0
  while (i < points.length) {
    if ((points[i].speed_kmh || 0) <= speedThresholdKmh) {
      let j = i
      while (j + 1 < points.length && (points[j + 1].speed_kmh || 0) <= speedThresholdKmh) j++
      const durationS = (
        (points[j]._fixMs != null ? points[j]._fixMs : Date.parse(points[j].fixTime))
        - (points[i]._fixMs != null ? points[i]._fixMs : Date.parse(points[i].fixTime))
      ) / 1000
      if (durationS >= minDurationSeconds) {
        stops.push({ startIdx: i, endIdx: j })
      }
      i = j + 1
    } else {
      i++
    }
  }
  return stops
}

// Returns [{ direction: 'outward'|'inward', startIdx, endIdx }, ...] — 0
// entries if there's nothing meaningful to split (no geofence, too few
// points, or no stop anywhere on the route lasted long enough to count
// as the turnaround), otherwise always exactly 2, in chronological
// order. `geofence` needs center_lat/center_lon.
export const splitTripLegs = (points, geofence) => {
  if (!geofence || points.length < 3) return []

  const dist = points.map((p) =>
    haversineMeters(geofence.center_lat, geofence.center_lon, p.latitude, p.longitude)
  )

  const stops = findQualifyingStops(points, STOP_SPEED_KMH_THRESHOLD, MIN_STOP_SECONDS)
  if (stops.length === 0) return []

  // The turnaround is the qualifying stop whose farthest point sits
  // farthest from the geofence overall (not just whichever stop is
  // longest — a stop near home can easily outlast a quick stop far
  // away). The split itself lands on that stop's ARRIVAL point
  // (startIdx), not wherever inside the stop happened to record the
  // single farthest GPS ping — a parked vehicle's GPS still jitters a
  // little, so picking the max-distance ping within the stop can nudge
  // the split to an odd point partway through it instead of cleanly at
  // "the vehicle arrived and stopped here."
  let turnStop = null
  let farthestDist = -Infinity
  for (const stop of stops) {
    for (let idx = stop.startIdx; idx <= stop.endIdx; idx++) {
      if (dist[idx] > farthestDist) {
        farthestDist = dist[idx]
        turnStop = stop
      }
    }
  }
  if (!turnStop) return []

  const turnIdx = turnStop.startIdx
  if (turnIdx <= 0 || turnIdx >= points.length - 1) return []

  return [
    { direction: 'outward', startIdx: 0, endIdx: turnIdx },
    { direction: 'inward', startIdx: turnIdx, endIdx: points.length - 1 },
  ]
}