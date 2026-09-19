import { useEffect, useRef, useState } from 'react'
import { Truck, Check } from 'lucide-react'
import api from '../../api'
import { Modal, Input } from '../../shared/components'
import { useTheme } from '../../theme'
import { usePanelScope } from '../../manager/hooks/usePanelScope'

// Opened from the driver detail panel — search-and-pick a vehicle
// (GET /api/fleet/devices, filtered client-side) and assign via
// POST /api/drivers/{id}/assign?device_id=. Vehicles that already have
// a different driver are NOT disabled: the backend auto-closes the
// previous open assignment on both sides.
const AssignVehicleModal = ({ driverId, currentDeviceId, onClose, onAssigned }) => {
  const { tokens } = useTheme()
  const { isManager, apiFor, can } = usePanelScope()
  const [search, setSearch] = useState('')
  const [devices, setDevices] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  // Chrome ignores autocomplete=off on many fields; unlock after mount so the
  // oversized mobile autofill bubble (saved names / prior values) does not open.
  const [fieldsUnlocked, setFieldsUnlocked] = useState(false)
  const searchRef = useRef(null)

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setFieldsUnlocked(true)
      searchRef.current?.focus()
    }, 120)
    return () => window.clearTimeout(timer)
  }, [])

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      setLoading(true)
      try {
        if (isManager) {
          if (!can('live_tracking')) {
            if (!cancelled) setDevices([])
            return
          }
          // Manager vehicles live-feed → normalize to the DeviceOut-ish
          // shape this modal already renders (id/name/plate).
          const res = await api.get(apiFor('/vehicles', '/api/fleet/devices'))
          const live = res.data.live || []
          if (!cancelled) {
            setDevices(live
              .filter((item) => item.db_id != null)
              .map((item) => ({
                id: item.db_id,
                name: item.device?.name,
                plate_number: item.plate_number,
                owner_full_name: null,
                owner_username: null,
              })))
          }
        } else {
          const res = await api.get('/api/fleet/devices')
          if (!cancelled) setDevices(res.data)
        }
      } catch (err) {
        if (!cancelled) setError('Failed to load vehicles')
        console.error('Failed to load vehicles:', err)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [isManager, apiFor, can])

  const filtered = devices.filter((d) => {
    const q = search.trim().toLowerCase()
    if (!q) return true
    const owner = (d.owner_full_name || d.owner_username || '').toLowerCase()
    return (
      (d.name || '').toLowerCase().includes(q)
      || (d.plate_number || '').toLowerCase().includes(q)
      || owner.includes(q)
    )
  })

  const assignVehicle = async (deviceId) => {
    setSaving(true)
    setError(null)
    try {
      await api.post(apiFor(`/drivers/${driverId}/assign`, `/api/drivers/${driverId}/assign`), null, {
        params: { device_id: deviceId },
      })
      onAssigned()
      onClose()
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to assign vehicle')
    } finally {
      setSaving(false)
    }
  }

  const unlockField = (event) => {
    if (event.currentTarget.readOnly) {
      event.currentTarget.readOnly = false
    }
  }

  const ownerLabel = (d) => d.owner_full_name || d.owner_username || 'No owner'

  return (
    <Modal
      open
      onClose={onClose}
      title="Assign to Vehicle"
      size="md"
    >
      <p style={{ margin: '0 0 14px', fontSize: 13, color: tokens.textSecondary }}>
        Pick a vehicle to assign this driver to.
      </p>

      {error && (
        <div style={{
          background: `${tokens.semantic.danger}18`,
          color: tokens.semantic.danger,
          padding: '8px 12px',
          borderRadius: 8,
          fontSize: 13,
          marginBottom: 12,
        }}
        >
          {typeof error === 'string' ? error : 'Failed to assign vehicle'}
        </div>
      )}

      <form autoComplete="off" onSubmit={(e) => e.preventDefault()}>
        <Input
          ref={searchRef}
          type="search"
          name="vehicle-filter"
          placeholder="Search vehicles..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="none"
          spellCheck={false}
          inputMode="search"
          readOnly={!fieldsUnlocked}
          onFocus={unlockField}
        />
      </form>
      <div style={{ height: 12 }} />

      <div style={{
        overflowY: 'auto',
        minHeight: 120,
        maxHeight: 320,
        border: `1px solid ${tokens.border}`,
        borderRadius: 10,
      }}
      >
        {loading ? (
          <div style={{ padding: 24, textAlign: 'center', color: tokens.textSecondary, fontSize: 13 }}>
            Loading vehicles...
          </div>
        ) : filtered.length === 0 ? (
          <div style={{ padding: 24, textAlign: 'center', color: tokens.textSecondary, fontSize: 13 }}>
            {devices.length === 0 ? 'No vehicles available.' : 'No vehicles match.'}
          </div>
        ) : (
          filtered.map((d) => {
            const isCurrent = currentDeviceId === d.id
            return (
              <div
                key={d.id}
                role="button"
                tabIndex={0}
                onClick={() => !saving && !isCurrent && assignVehicle(d.id)}
                onKeyDown={(e) => {
                  if ((e.key === 'Enter' || e.key === ' ') && !saving && !isCurrent) assignVehicle(d.id)
                }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  padding: '10px 12px',
                  borderBottom: `1px solid ${tokens.border}`,
                  cursor: saving ? 'wait' : isCurrent ? 'default' : 'pointer',
                  background: isCurrent ? `${tokens.primary}14` : 'transparent',
                }}
              >
                <div style={{
                  width: 32,
                  height: 32,
                  borderRadius: 8,
                  background: `${tokens.primary}14`,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                }}
                >
                  <Truck size={16} color={tokens.primary} />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: tokens.text }}>{d.name}</div>
                  <div style={{ fontSize: 11, color: tokens.textSecondary, marginTop: 2 }}>
                    {d.plate_number || 'No plate'} · {ownerLabel(d)}
                  </div>
                </div>
                {isCurrent && <Check size={16} color={tokens.primary} />}
              </div>
            )
          })
        )}
      </div>
    </Modal>
  )
}

export default AssignVehicleModal
