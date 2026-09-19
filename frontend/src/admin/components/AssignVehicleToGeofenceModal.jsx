import { useEffect, useState } from 'react'
import { Truck } from 'lucide-react'
import api from '../../api'
import { Modal, Input } from '../../shared/components'
import { useTheme } from '../../theme'

const AssignVehicleToGeofenceModal = ({
  geofenceId,
  alreadyAssignedDeviceIds = [],
  onClose,
  onAssigned,
  // Optional scoped URLs for manager mode
  vehiclesUrl,   // GET endpoint to list assignable vehicles
  assignUrl,     // (deviceId) => POST url to assign; if absent uses admin PATCH
}) => {
  const { tokens } = useTheme()
  const [search, setSearch] = useState('')
  const [devices, setDevices] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  const assignedSet = new Set(alreadyAssignedDeviceIds.map(Number))

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      setLoading(true)
      try {
        const res = await api.get(vehiclesUrl || '/api/fleet/devices')
        if (!cancelled) setDevices(res.data || [])
      } catch (err) {
        if (!cancelled) setError('Failed to load vehicles')
        console.error('Failed to load vehicles:', err)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [vehiclesUrl])

  const available = devices.filter((d) => !assignedSet.has(Number(d.id)))

  const filtered = available.filter((d) => {
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
      if (assignUrl) {
        await api.post(assignUrl(deviceId))
      } else {
        await api.patch(`/api/fleet/devices/${deviceId}`, {
          primary_geofence_id: geofenceId,
        })
      }
      onAssigned()
      onClose()
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to assign vehicle')
    } finally {
      setSaving(false)
    }
  }

  const ownerLabel = (d) => d.owner_full_name || d.owner_username || 'No owner'

  return (
    <Modal
      open
      onClose={onClose}
      title="Assign Vehicle"
      size="md"
    >
      <p style={{ margin: '0 0 14px', fontSize: 13, color: tokens.textSecondary }}>
        Pick a vehicle to assign to this geofence.
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
          type="search"
          placeholder="Search vehicles..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          autoFocus
          name="geofence-vehicle-search"
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="none"
          spellCheck={false}
          inputMode="search"
          data-lpignore="true"
          data-1p-ignore="true"
          data-form-type="other"
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
            {available.length === 0 ? 'No vehicles available to assign.' : 'No vehicles match.'}
          </div>
        ) : (
          filtered.map((d) => (
            <div
              key={d.id}
              role="button"
              tabIndex={0}
              onClick={() => !saving && assignVehicle(d.id)}
              onKeyDown={(e) => {
                if ((e.key === 'Enter' || e.key === ' ') && !saving) assignVehicle(d.id)
              }}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: '10px 12px',
                borderBottom: `1px solid ${tokens.border}`,
                cursor: saving ? 'wait' : 'pointer',
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
            </div>
          ))
        )}
      </div>
    </Modal>
  )
}

export default AssignVehicleToGeofenceModal
