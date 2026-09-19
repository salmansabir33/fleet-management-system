import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import api from '../../api'
import { deriveVehicleStatus, tallyVehicleStatusCounts } from '../../user/utils/vehicleStatus'
import { periodToTripParams } from '../../admin/utils/dashboardPeriod'
import { usePanelScope } from './usePanelScope'
import { useManagerScope } from '../context/ManagerScopeContext'

/** Live fleet status — keep relatively fresh. */
const LIVE_REFRESH_MS = 15000
/** Weekly trip aggregates change slowly; avoid hammering /trips. */
const WEEK_REFRESH_MS = 60000

/**
 * Loads only what ManagerDashboard renders:
 * - /dashboard → live vehicles + summary KPIs
 * - /trips?week → usage chart + today's fuel/idle fuel
 *
 * Unused fleet endpoints (drivers, routes, geofences, alerts) are intentionally
 * not fetched here so the page can paint faster.
 */
export const useManagerDashboardData = (autoRefresh = true) => {
  const { apiFor, can } = usePanelScope()
  const { loading: scopeLoading } = useManagerScope()

  const canLive = can('live_tracking')
  const canReports = can('reports_analytics')
  const canTrips = can('trip_history')

  const [live, setLive] = useState([])
  const [summary, setSummary] = useState(null)
  const [weekTrips, setWeekTrips] = useState([])
  const [coreLoading, setCoreLoading] = useState(true)
  const [tripsLoading, setTripsLoading] = useState(true)
  const [lastUpdated, setLastUpdated] = useState(null)
  const weekRequestId = useRef(0)

  const loadCore = useCallback(async () => {
    try {
      const dashRes = await api.get(apiFor('/dashboard', '/api/live'))
      setLive(Array.isArray(dashRes.data.live) ? dashRes.data.live : [])
      setSummary(dashRes.data.summary || null)
      setLastUpdated(new Date())
    } catch (err) {
      console.error('Failed to load manager dashboard core:', err)
    }
  }, [apiFor])

  const loadWeekTrips = useCallback(async () => {
    if (!canTrips) {
      setWeekTrips([])
      return
    }
    const requestId = ++weekRequestId.current
    try {
      const res = await api.get(apiFor('/trips', '/api/trips'), {
        params: periodToTripParams('week'),
      })
      if (requestId !== weekRequestId.current) return
      setWeekTrips(Array.isArray(res.data) ? res.data : [])
    } catch (err) {
      if (requestId !== weekRequestId.current) return
      console.error('Failed to load weekly trips:', err)
      setWeekTrips([])
    }
  }, [apiFor, canTrips])

  const refreshAll = useCallback(async () => {
    setCoreLoading(true)
    setTripsLoading(true)
    await Promise.all([
      loadCore().finally(() => setCoreLoading(false)),
      loadWeekTrips().finally(() => setTripsLoading(false)),
    ])
  }, [loadCore, loadWeekTrips])

  useEffect(() => {
    if (scopeLoading) return undefined
    let cancelled = false
    const boot = async () => {
      setCoreLoading(true)
      setTripsLoading(canTrips)
      const corePromise = loadCore().finally(() => {
        if (!cancelled) setCoreLoading(false)
      })
      const tripsPromise = canTrips
        ? loadWeekTrips().finally(() => {
          if (!cancelled) setTripsLoading(false)
        })
        : Promise.resolve().then(() => {
          if (!cancelled) {
            setWeekTrips([])
            setTripsLoading(false)
          }
        })
      await Promise.all([corePromise, tripsPromise])
    }
    boot()
    return () => { cancelled = true }
  }, [scopeLoading, loadCore, loadWeekTrips, canTrips])

  useEffect(() => {
    if (!autoRefresh || scopeLoading) return undefined
    const liveTimer = setInterval(() => {
      loadCore()
    }, LIVE_REFRESH_MS)
    const weekTimer = canTrips
      ? setInterval(() => {
        loadWeekTrips()
      }, WEEK_REFRESH_MS)
      : null
    return () => {
      clearInterval(liveTimer)
      if (weekTimer) clearInterval(weekTimer)
    }
  }, [autoRefresh, scopeLoading, loadCore, loadWeekTrips, canTrips])

  const vehicleRows = useMemo(() => live
    .filter((item) => item.db_id != null)
    .map((item) => ({
      ...item,
      status: deriveVehicleStatus(item),
    })), [live])

  const statusCounts = useMemo(
    () => tallyVehicleStatusCounts(vehicleRows.map((row) => row.status)),
    [vehicleRows],
  )

  return {
    loading: coreLoading || scopeLoading,
    tripsLoading: tripsLoading || scopeLoading,
    lastUpdated,
    live,
    summary,
    weekTrips,
    vehicleRows,
    statusCounts,
    refreshAll,
    permissions: {
      canLive,
      canReports,
      canTrips,
    },
  }
}
