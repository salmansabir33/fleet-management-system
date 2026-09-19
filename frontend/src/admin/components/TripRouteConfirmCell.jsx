import { useEffect, useRef, useState } from 'react'
import { Check, ChevronDown } from 'lucide-react'
import api from '../../api'
import { usePanelScope } from '../../manager/hooks/usePanelScope'

/** Display name for trips table / grouping: confirmed wins, else assigned. */
export const tripDisplayRouteName = (trip) => {
  if (trip?.route_confirmation_status === 'confirmed' && trip.confirmed_route_name) {
    return trip.confirmed_route_name
  }
  return trip?.route_name || null
}

/**
 * Interactive route cell: pending (orange) / confirmed (green),
 * one-click confirm of assigned route, or pick another from dropdown.
 */
const TripRouteConfirmCell = ({ trip, onConfirmed, compact = false, readonly = false }) => {
  const { apiFor } = usePanelScope()
  const confirmed = trip.route_confirmation_status === 'confirmed'
  const displayName = tripDisplayRouteName(trip) || 'Unassigned'
  const assignedId = trip.route_id

  const [open, setOpen] = useState(false)
  const [routes, setRoutes] = useState([])
  const [loadingRoutes, setLoadingRoutes] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const rootRef = useRef(null)

  useEffect(() => {
    if (!open) return undefined
    const onDoc = (event) => {
      if (rootRef.current && !rootRef.current.contains(event.target)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  const loadRoutes = async () => {
    setLoadingRoutes(true)
    setError(null)
    try {
      const res = await api.get(
        apiFor(`/trips/${trip.id}/confirmable-routes`, `/api/trips/${trip.id}/confirmable-routes`),
      )
      setRoutes(res.data || [])
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to load routes')
      setRoutes([])
    } finally {
      setLoadingRoutes(false)
    }
  }

  const toggleOpen = (event) => {
    event.stopPropagation()
    event.preventDefault()
    if (saving) return
    const next = !open
    setOpen(next)
    if (next) loadRoutes()
  }

  const confirmRoute = async (routeId, event) => {
    event?.stopPropagation()
    event?.preventDefault()
    if (!routeId || saving) return
    setSaving(true)
    setError(null)
    try {
      const res = await api.post(
        apiFor(`/trips/${trip.id}/confirm-route`, `/api/trips/${trip.id}/confirm-route`),
        { route_id: routeId },
      )
      onConfirmed?.(res.data)
      setOpen(false)
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to confirm route')
    } finally {
      setSaving(false)
    }
  }

  const statusClass = confirmed
    ? 'at-trips-driver-confirm--confirmed'
    : 'at-trips-driver-confirm--pending'

  return (
    <div
      ref={rootRef}
      className={`at-trips-driver-confirm at-trips-route-confirm ${statusClass}${compact ? ' at-trips-driver-confirm--compact' : ''}${readonly ? ' at-trips-driver-confirm--readonly' : ''}${open ? ' is-open' : ''}`}
      onClick={readonly ? undefined : (event) => event.stopPropagation()}
      onKeyDown={readonly ? undefined : (event) => event.stopPropagation()}
    >
      <div className="at-trips-driver-confirm-row">
        <div className="at-trips-driver-confirm-meta">
          <div className="at-trips-driver-confirm-name-row">
            <span className="at-trips-driver-name" title={displayName}>{displayName}</span>
            {!readonly && (
              <div className="at-trips-driver-confirm-actions">
                {!confirmed && assignedId != null && (
                  <button
                    type="button"
                    className="at-trips-driver-confirm-btn"
                    title="Confirm assigned route"
                    disabled={saving}
                    onClick={(event) => confirmRoute(assignedId, event)}
                  >
                    <Check size={13} strokeWidth={2.5} />
                  </button>
                )}
                <button
                  type="button"
                  className="at-trips-driver-change-btn"
                  title={confirmed ? 'Change route' : 'Select route'}
                  disabled={saving}
                  aria-expanded={open}
                  onClick={toggleOpen}
                >
                  <ChevronDown size={13} />
                </button>
              </div>
            )}
          </div>
          <span className={`at-trips-driver-badge ${confirmed ? 'is-confirmed' : 'is-pending'}`}>
            {confirmed ? 'Confirmed' : 'Pending'}
          </span>
        </div>
      </div>

      {!readonly && open && (
        <div className="at-trips-driver-dropdown" role="listbox">
          {loadingRoutes && <div className="at-trips-driver-dropdown-empty">Loading…</div>}
          {!loadingRoutes && error && (
            <div className="at-trips-driver-dropdown-empty at-trips-driver-dropdown-error">{error}</div>
          )}
          {!loadingRoutes && !error && routes.length === 0 && (
            <div className="at-trips-driver-dropdown-empty">No routes available</div>
          )}
          {!loadingRoutes && routes.map((route) => (
            <button
              key={route.id}
              type="button"
              className="at-trips-driver-dropdown-item"
              disabled={saving}
              onClick={(event) => confirmRoute(route.id, event)}
            >
              <span className="at-trips-driver-dropdown-meta">
                <span className="at-trips-driver-dropdown-name">{route.name}</span>
                {route.current_device_names?.length > 0 && (
                  <span className="at-trips-driver-dropdown-vehicle">
                    {route.current_device_names.join(', ')}
                  </span>
                )}
              </span>
              {trip.confirmed_route_id === route.id && (
                <Check size={14} className="at-trips-driver-dropdown-check" />
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export default TripRouteConfirmCell
