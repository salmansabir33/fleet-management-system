// Session-scoped caches for Live Playback fetches. Same request key
// returns the same payload without a network round-trip; no TTL because
// historical period/trip ranges are stable within a page session.

const MAX_ENTRIES = 24

const routeCache = new Map()
const tripsCache = new Map()

const touch = (cache, key, value) => {
  if (cache.has(key)) cache.delete(key)
  cache.set(key, value)
  while (cache.size > MAX_ENTRIES) {
    const oldest = cache.keys().next().value
    cache.delete(oldest)
  }
  return value
}

export const routeCacheKey = (deviceId, fromIso, toIso, maxPoints) => (
  `${deviceId}|${fromIso}|${toIso}|${maxPoints ?? ''}`
)

export const tripsCacheKey = (deviceId, fromIso, toIso) => (
  `${deviceId}|${fromIso}|${toIso}`
)

export const getCachedRoute = (key) => routeCache.get(key)
export const setCachedRoute = (key, value) => touch(routeCache, key, value)

export const getCachedTrips = (key) => tripsCache.get(key)
export const setCachedTrips = (key, value) => touch(tripsCache, key, value)

export function clearPlaybackCaches() {
  routeCache.clear()
  tripsCache.clear()
}
