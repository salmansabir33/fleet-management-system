import api from '../../api'

/** In-flight + short-TTL cache so layout/nav/children share one /status call. */
const CACHE_TTL_MS = 30_000
const cache = new Map()

const cacheKey = (deviceId) => String(deviceId)

export function invalidateMaintenanceStatus(deviceId) {
  if (deviceId == null) {
    cache.clear()
    return
  }
  cache.delete(cacheKey(deviceId))
}

export function getCachedMaintenanceStatus(deviceId) {
  const entry = cache.get(cacheKey(deviceId))
  if (!entry?.data) return null
  if (Date.now() - entry.ts > CACHE_TTL_MS) return null
  return entry.data
}

export function fetchMaintenanceStatus(deviceId, { force = false } = {}) {
  const key = cacheKey(deviceId)
  if (!force) {
    const existing = cache.get(key)
    if (existing?.promise) return existing.promise
    if (existing?.data && Date.now() - existing.ts <= CACHE_TTL_MS) {
      return Promise.resolve({ data: existing.data })
    }
  }

  const promise = api
    .get(`/api/maintenance/devices/${deviceId}/status`)
    .then((res) => {
      cache.set(key, { data: res.data, ts: Date.now() })
      return res
    })
    .catch((err) => {
      const cur = cache.get(key)
      if (cur?.promise === promise) cache.delete(key)
      throw err
    })

  cache.set(key, { ...(cache.get(key) || {}), promise, ts: Date.now() })
  return promise
}
