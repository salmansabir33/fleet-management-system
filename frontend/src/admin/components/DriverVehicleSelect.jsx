import { useEffect, useState } from 'react'
import api from '../../api'
import { Select } from '../../shared/components'
import { usePanelScope } from '../../manager/hooks/usePanelScope'

export function vehicleOptionLabel(device) {
  if (!device?.id) return 'Unassigned'
  const name = device.name || `Vehicle #${device.id}`
  return device.plate_number ? `${name} · ${device.plate_number}` : name
}

export async function fetchAssignableVehicles({ isManager, apiFor, can }) {
  if (isManager) {
    if (!can('live_tracking')) return []
    const res = await api.get(apiFor('/vehicles', '/api/fleet/devices'))
    const live = res.data.live || []
    return live
      .filter((item) => item.db_id != null)
      .map((item) => ({
        id: item.db_id,
        name: item.device?.name,
        plate_number: item.plate_number,
      }))
      .sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), undefined, { sensitivity: 'base' }))
  }
  const res = await api.get('/api/fleet/devices')
  const devices = Array.isArray(res.data) ? res.data : []
  return [...devices].sort((a, b) => (
    String(a.name || '').localeCompare(String(b.name || ''), undefined, { sensitivity: 'base' })
  ))
}

export async function applyDriverVehicleAssignment({
  apiFor,
  driverId,
  previousDeviceId,
  nextDeviceId,
}) {
  const prev = previousDeviceId == null || previousDeviceId === ''
    ? null
    : Number(previousDeviceId)
  const next = nextDeviceId == null || nextDeviceId === ''
    ? null
    : Number(nextDeviceId)
  if (prev === next) return
  if (next == null) {
    await api.post(apiFor(`/drivers/${driverId}/unassign`, `/api/drivers/${driverId}/unassign`))
    return
  }
  await api.post(
    apiFor(`/drivers/${driverId}/assign`, `/api/drivers/${driverId}/assign`),
    null,
    { params: { device_id: next } },
  )
}

export default function DriverVehicleSelect({
  value,
  onChange,
  disabled,
  helperText,
  currentDeviceId,
  currentDeviceName,
  currentDevicePlate,
}) {
  const { isManager, apiFor, can } = usePanelScope()
  const [devices, setDevices] = useState([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(null)

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      setLoading(true)
      setLoadError(null)
      try {
        const list = await fetchAssignableVehicles({ isManager, apiFor, can })
        if (!cancelled) setDevices(list)
      } catch (err) {
        console.error('Failed to load vehicles:', err)
        if (!cancelled) {
          setDevices([])
          setLoadError('Failed to load vehicles')
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [isManager, apiFor, can])

  const currentId = currentDeviceId == null ? null : Number(currentDeviceId)
  const hasCurrent = currentId != null && !devices.some((d) => d.id === currentId)

  return (
    <Select
      label="Assigned vehicle"
      value={value}
      onChange={onChange}
      disabled={disabled || loading}
      helperText={loadError || helperText}
    >
      <option value="">{loading ? 'Loading vehicles…' : 'Unassigned'}</option>
      {hasCurrent && (
        <option value={String(currentId)}>
          {vehicleOptionLabel({
            id: currentId,
            name: currentDeviceName,
            plate_number: currentDevicePlate,
          })}
        </option>
      )}
      {devices.map((d) => (
        <option key={d.id} value={String(d.id)}>
          {vehicleOptionLabel(d)}
        </option>
      ))}
    </Select>
  )
}
