import { useEffect, useRef, useState } from 'react'
import { Check, ChevronDown } from 'lucide-react'
import api from '../../api'
import { Avatar } from '../../shared/components'
import { usePanelScope } from '../../manager/hooks/usePanelScope'
import { userPicSrc } from '../utils/userPic'

/** Display name for trips table / grouping: confirmed wins, else assigned. */
export const tripDisplayDriverName = (trip) => {
  if (trip?.driver_confirmation_status === 'confirmed' && trip.confirmed_driver_name) {
    return trip.confirmed_driver_name
  }
  return trip?.driver_name || null
}

export const tripDisplayDriverPic = (trip) => {
  if (trip?.driver_confirmation_status === 'confirmed' && trip.confirmed_driver_pic_url) {
    return trip.confirmed_driver_pic_url
  }
  return trip?.driver_pic_url || null
}

/**
 * Interactive driver cell: pending (orange) / confirmed (green),
 * one-click confirm of assigned driver, or pick another from dropdown.
 */
const TripDriverConfirmCell = ({ trip, onConfirmed, compact = false, readonly = false }) => {
  const { apiFor } = usePanelScope()
  const confirmed = trip.driver_confirmation_status === 'confirmed'
  const displayName = tripDisplayDriverName(trip) || 'Unassigned'
  const displayPic = tripDisplayDriverPic(trip)
  const assignedId = trip.driver_id

  const [open, setOpen] = useState(false)
  const [drivers, setDrivers] = useState([])
  const [loadingDrivers, setLoadingDrivers] = useState(false)
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

  const loadDrivers = async () => {
    setLoadingDrivers(true)
    setError(null)
    try {
      const res = await api.get(
        apiFor(`/trips/${trip.id}/confirmable-drivers`, `/api/trips/${trip.id}/confirmable-drivers`),
      )
      setDrivers(res.data || [])
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to load drivers')
      setDrivers([])
    } finally {
      setLoadingDrivers(false)
    }
  }

  const toggleOpen = (event) => {
    event.stopPropagation()
    event.preventDefault()
    if (saving) return
    const next = !open
    setOpen(next)
    if (next) loadDrivers()
  }

  const confirmDriver = async (driverId, event) => {
    event?.stopPropagation()
    event?.preventDefault()
    if (!driverId || saving) return
    setSaving(true)
    setError(null)
    try {
      const res = await api.post(
        apiFor(`/trips/${trip.id}/confirm-driver`, `/api/trips/${trip.id}/confirm-driver`),
        { driver_id: driverId },
      )
      onConfirmed?.(res.data)
      setOpen(false)
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to confirm driver')
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
      className={`at-trips-driver-confirm ${statusClass}${compact ? ' at-trips-driver-confirm--compact' : ''}${readonly ? ' at-trips-driver-confirm--readonly' : ''}${open ? ' is-open' : ''}`}
      onClick={readonly ? undefined : (event) => event.stopPropagation()}
      onKeyDown={readonly ? undefined : (event) => event.stopPropagation()}
    >
      <div className="at-trips-driver-confirm-row">
        <span className="at-trips-driver-avatar-wrap">
          <Avatar name={displayName} size="sm" src={userPicSrc(displayPic)} />
        </span>

        <div className="at-trips-driver-confirm-meta">
          <div className="at-trips-driver-confirm-name-row">
            <span className="at-trips-driver-name" title={displayName}>{displayName}</span>
            {!readonly && (
              <div className="at-trips-driver-confirm-actions">
                {!confirmed && assignedId != null && (
                  <button
                    type="button"
                    className="at-trips-driver-confirm-btn"
                    title="Confirm assigned driver"
                    disabled={saving}
                    onClick={(event) => confirmDriver(assignedId, event)}
                  >
                    <Check size={13} strokeWidth={2.5} />
                  </button>
                )}
                <button
                  type="button"
                  className="at-trips-driver-change-btn"
                  title={confirmed ? 'Change driver' : 'Select driver'}
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
          {loadingDrivers && <div className="at-trips-driver-dropdown-empty">Loading…</div>}
          {!loadingDrivers && error && (
            <div className="at-trips-driver-dropdown-empty at-trips-driver-dropdown-error">{error}</div>
          )}
          {!loadingDrivers && !error && drivers.length === 0 && (
            <div className="at-trips-driver-dropdown-empty">No drivers available</div>
          )}
          {!loadingDrivers && drivers.map((driver) => (
            <button
              key={driver.id}
              type="button"
              className="at-trips-driver-dropdown-item"
              disabled={saving}
              onClick={(event) => confirmDriver(driver.id, event)}
            >
              <Avatar
                name={driver.name}
                size="sm"
                src={userPicSrc(driver.driver_pic_url)}
              />
              <span className="at-trips-driver-dropdown-meta">
                <span className="at-trips-driver-dropdown-name">{driver.name}</span>
                {driver.current_device_name && (
                  <span className="at-trips-driver-dropdown-vehicle">{driver.current_device_name}</span>
                )}
              </span>
              {trip.confirmed_driver_id === driver.id && (
                <Check size={14} className="at-trips-driver-dropdown-check" />
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export default TripDriverConfirmCell
