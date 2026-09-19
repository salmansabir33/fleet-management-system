import api from '../../api'

/** In-flight + short-TTL cache so layout/overview/entry share one /records call. */
const CACHE_TTL_MS = 30_000
const cache = new Map()

const cacheKey = (deviceId) => String(deviceId)

export function invalidateMaintenanceRecords(deviceId) {
  if (deviceId == null) {
    cache.clear()
    return
  }
  cache.delete(cacheKey(deviceId))
}

export function getCachedMaintenanceRecords(deviceId) {
  const entry = cache.get(cacheKey(deviceId))
  if (!entry?.data) return null
  if (Date.now() - entry.ts > CACHE_TTL_MS) return null
  return entry.data
}

export function fetchMaintenanceRecords(deviceId, { force = false, params } = {}) {
  // Date-filtered queries are not cached (report page).
  if (params && (params.start || params.end)) {
    return api.get(`/api/maintenance/devices/${deviceId}/records`, { params })
  }

  const key = cacheKey(deviceId)
  if (!force) {
    const existing = cache.get(key)
    if (existing?.promise) return existing.promise
    if (existing?.data && Date.now() - existing.ts <= CACHE_TTL_MS) {
      return Promise.resolve({ data: existing.data })
    }
  }

  const promise = api
    .get(`/api/maintenance/devices/${deviceId}/records`)
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
