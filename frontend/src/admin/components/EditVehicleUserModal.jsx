import { useEffect, useState } from 'react'
import { Save } from 'lucide-react'
import api from '../../api'
import { Modal, Input, Select, Button, LoadingState } from '../../shared/components'
import { useTheme } from '../../theme'
import { usePanelScope } from '../../manager/hooks/usePanelScope'
import UserPhotoField from './UserPhotoField'
import { uploadUserPhoto, uploadVehiclePhoto } from '../utils/userPic'

const IDLE_DEFAULTS_BY_VEHICLE_TYPE = {
  bike: 0.15,
  car: 0.6,
  van: 0.9,
  truck: 1.8,
}

const emptyVehicleForm = {
  name: '',
  vehicle_type: '',
  plate_number: '',
  fuel_type_id: '',
  fuel_avg_running: '',
  fuel_avg_idle: '',
  primary_geofence_id: '',
  speed_limit_kmh: '',
  harsh_brake_delta_kmh: '',
  harsh_accel_delta_kmh: '',
}

const toFormValue = (value) => (value == null || value === '' ? '' : String(value))

const deviceToForm = (device) => ({
  name: device?.name || '',
  vehicle_type: device?.vehicle_type || '',
  plate_number: device?.plate_number || '',
  fuel_type_id: toFormValue(device?.fuel_type_id),
  fuel_avg_running: toFormValue(device?.fuel_avg_running),
  fuel_avg_idle: toFormValue(device?.fuel_avg_idle),
  primary_geofence_id: toFormValue(device?.primary_geofence_id),
  speed_limit_kmh: toFormValue(device?.speed_limit_kmh),
  harsh_brake_delta_kmh: toFormValue(device?.harsh_brake_delta_kmh),
  harsh_accel_delta_kmh: toFormValue(device?.harsh_accel_delta_kmh),
})

const EditVehicleUserModal = ({ vehicleRow, onClose, onSaved }) => {
  const { tokens } = useTheme()
  const { apiFor } = usePanelScope()
  const deviceId = vehicleRow?.db_id

  const [loading, setLoading] = useState(true)
  const [imei, setImei] = useState(vehicleRow?.device?.uniqueId || '')
  const [ownerId, setOwnerId] = useState(null)
  const [username, setUsername] = useState('')
  const [fullName, setFullName] = useState('')
  const [phoneNumber, setPhoneNumber] = useState('')
  const [userPicUrl, setUserPicUrl] = useState(null)
  const [userPicFile, setUserPicFile] = useState(null)
  const [vehicle, setVehicle] = useState(emptyVehicleForm)
  const [vehiclePicUrl, setVehiclePicUrl] = useState(null)
  const [vehiclePicFile, setVehiclePicFile] = useState(null)
  const [idleTouched, setIdleTouched] = useState(false)
  const [fuelTypes, setFuelTypes] = useState([])
  const [geofences, setGeofences] = useState([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    let cancelled = false

    const load = async () => {
      if (!deviceId) return
      setLoading(true)
      setError(null)
      try {
        const [deviceRes, fuelRes, geoRes] = await Promise.all([
          api.get(apiFor(`/vehicles/${deviceId}`, `/api/fleet/devices/${deviceId}`)),
          api.get('/api/fuel-types'),
          api.get('/api/geofences'),
        ])
        if (cancelled) return

        const device = deviceRes.data
        setVehicle(deviceToForm(device))
        setVehiclePicUrl(device?.pic_url || null)
        setImei(vehicleRow?.device?.uniqueId || '')
        setIdleTouched(Boolean(device?.fuel_avg_idle != null))

        const userId = device.user_id ?? vehicleRow?.owner?.id ?? null
        setOwnerId(userId)

        if (userId) {
          const userRes = await api.get(apiFor(`/users/${userId}`, `/api/users/${userId}`))
          if (!cancelled) {
            setUsername(userRes.data.username || '')
            setFullName(userRes.data.full_name || '')
            setPhoneNumber(userRes.data.phone_number || '')
            setUserPicUrl(userRes.data.pic_url || null)
          }
        } else {
          setUsername('')
          setFullName('')
          setPhoneNumber('')
          setUserPicUrl(null)
        }

        setFuelTypes(fuelRes.data || [])
        setGeofences(geoRes.data || [])
      } catch (err) {
        if (!cancelled) {
          setError(err.response?.data?.detail || 'Failed to load vehicle details')
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    load()
    return () => { cancelled = true }
  }, [apiFor, deviceId, vehicleRow])

  const canSave = vehicle.name.trim().length > 0 && (!ownerId || username.trim().length > 0)

  const handleVehicleChange = (e) => {
    const { name, value } = e.target
    setVehicle((prev) => ({ ...prev, [name]: value }))
    if (name === 'fuel_avg_idle') setIdleTouched(true)
  }

  const handleVehicleTypeChange = (e) => {
    const vehicleType = e.target.value
    setVehicle((prev) => ({
      ...prev,
      vehicle_type: vehicleType,
      fuel_avg_idle: idleTouched ? prev.fuel_avg_idle : String(IDLE_DEFAULTS_BY_VEHICLE_TYPE[vehicleType] ?? ''),
    }))
  }

  const buildVehiclePayload = () => {
    const payload = {
      name: vehicle.name.trim(),
      vehicle_type: vehicle.vehicle_type || null,
      plate_number: vehicle.plate_number.trim() || null,
      fuel_type_id: vehicle.fuel_type_id ? Number(vehicle.fuel_type_id) : null,
      fuel_avg_running: vehicle.fuel_avg_running ? parseFloat(vehicle.fuel_avg_running) : null,
      primary_geofence_id: vehicle.primary_geofence_id ? Number(vehicle.primary_geofence_id) : null,
      speed_limit_kmh: vehicle.speed_limit_kmh ? parseFloat(vehicle.speed_limit_kmh) : null,
      harsh_brake_delta_kmh: vehicle.harsh_brake_delta_kmh ? parseFloat(vehicle.harsh_brake_delta_kmh) : null,
      harsh_accel_delta_kmh: vehicle.harsh_accel_delta_kmh ? parseFloat(vehicle.harsh_accel_delta_kmh) : null,
    }
    if (idleTouched) {
      payload.fuel_avg_idle = vehicle.fuel_avg_idle ? parseFloat(vehicle.fuel_avg_idle) : null
    }
    return payload
  }

  const handleSave = async () => {
    if (!canSave || !deviceId) return
    setSaving(true)
    setError(null)
    try {
      const requests = [
        api.patch(
          apiFor(`/vehicles/${deviceId}`, `/api/fleet/devices/${deviceId}`),
          buildVehiclePayload(),
        ),
      ]

      if (ownerId) {
        requests.push(
          api.patch(apiFor(`/users/${ownerId}`, `/api/users/${ownerId}`), {
            username: username.trim(),
            full_name: fullName.trim() || null,
            phone_number: phoneNumber.trim() || null,
          }),
        )
      }

      await Promise.all(requests)
      await uploadUserPhoto(api, apiFor, ownerId, userPicFile)
      await uploadVehiclePhoto(api, apiFor, deviceId, vehiclePicFile)
      onSaved()
      onClose()
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to save changes')
    } finally {
      setSaving(false)
    }
  }

  const sectionTitle = {
    fontSize: 12,
    fontWeight: 700,
    color: tokens.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.3,
    marginBottom: 12,
  }

  const grid = {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 200px), 1fr))',
    gap: 14,
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Edit Vehicle & User"
      size="lg"
      footer={(
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button onClick={handleSave} loading={saving} disabled={!canSave || loading}>
            <Save size={15} />
            Save Changes
          </Button>
        </>
      )}
    >
      {loading ? (
        <LoadingState label="Loading details…" />
      ) : (
        <>
          {error && (
            <div style={{
              background: `${tokens.semantic.danger}18`,
              color: tokens.semantic.danger,
              padding: '8px 12px',
              borderRadius: 8,
              fontSize: 13,
              marginBottom: 14,
            }}
            >
              {error}
            </div>
          )}

          {ownerId ? (
            <>
              <div style={sectionTitle}>User details</div>
              <div style={{ marginBottom: 14 }}>
                <UserPhotoField
                  name={fullName || username}
                  currentSrc={userPicUrl}
                  file={userPicFile}
                  onChange={setUserPicFile}
                  addLabel="Add photo"
                  changeLabel="Change photo"
                />
              </div>
              <div style={grid}>
                <Input
                  label="Username *"
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="jdoe"
                />
                <Input
                  label="Full name"
                  type="text"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder="Jane Doe"
                />
                <Input
                  label="Phone number"
                  type="text"
                  value={phoneNumber}
                  onChange={(e) => setPhoneNumber(e.target.value)}
                  placeholder="+1 555 123 4567"
                />
              </div>
            </>
          ) : (
            <p style={{ margin: '0 0 14px', fontSize: 13, color: tokens.textMuted }}>
              This vehicle has no linked owner user. You can edit vehicle details below.
            </p>
          )}

          <div style={{ ...sectionTitle, marginTop: ownerId ? 20 : 0 }}>Vehicle identity</div>
          <div style={{ marginBottom: 14 }}>
            <UserPhotoField
              label="Vehicle photo"
              name={vehicle.name || 'Vehicle'}
              currentSrc={vehiclePicUrl}
              file={vehiclePicFile}
              onChange={setVehiclePicFile}
              addLabel="Add photo"
              changeLabel="Change photo"
            />
          </div>
          <div style={grid}>
            <Input label="VIN / IMEI" type="text" value={imei} readOnly disabled />
            <Input
              label="Vehicle name *"
              type="text"
              name="name"
              value={vehicle.name}
              onChange={handleVehicleChange}
            />
            <Select
              label="Vehicle type"
              name="vehicle_type"
              value={vehicle.vehicle_type}
              onChange={handleVehicleTypeChange}
            >
              <option value="">Select type</option>
              <option value="bike">Bike</option>
              <option value="car">Car</option>
              <option value="van">Van</option>
              <option value="truck">Truck</option>
            </Select>
            <Input
              label="Plate number"
              type="text"
              name="plate_number"
              value={vehicle.plate_number}
              onChange={handleVehicleChange}
            />
            <Select
              label="Fuel type"
              name="fuel_type_id"
              value={vehicle.fuel_type_id}
              onChange={handleVehicleChange}
            >
              <option value="">Select fuel type</option>
              {fuelTypes.map((ft) => (
                <option key={ft.id} value={ft.id}>{ft.name}</option>
              ))}
            </Select>
            <Select
              label="Primary geofence"
              name="primary_geofence_id"
              value={vehicle.primary_geofence_id}
              onChange={handleVehicleChange}
            >
              <option value="">None</option>
              {geofences.map((g) => (
                <option key={g.id} value={g.id}>{g.name}</option>
              ))}
            </Select>
          </div>

          <div style={{ ...sectionTitle, marginTop: 20 }}>Driving parameters</div>
          <div style={grid}>
            <Input
              label="Speed limit (km/h)"
              type="number"
              name="speed_limit_kmh"
              value={vehicle.speed_limit_kmh}
              onChange={handleVehicleChange}
              step="1"
              min="0"
              placeholder="Fleet default"
            />
            <Input
              label="Harsh brake threshold (km/h)"
              type="number"
              name="harsh_brake_delta_kmh"
              value={vehicle.harsh_brake_delta_kmh}
              onChange={handleVehicleChange}
              step="1"
              min="0"
              placeholder="Fleet default"
            />
            <Input
              label="Harsh acceleration threshold (km/h)"
              type="number"
              name="harsh_accel_delta_kmh"
              value={vehicle.harsh_accel_delta_kmh}
              onChange={handleVehicleChange}
              step="1"
              min="0"
              placeholder="Fleet default"
            />
            <Input
              label="Fuel avg — running (km/L)"
              type="number"
              name="fuel_avg_running"
              value={vehicle.fuel_avg_running}
              onChange={handleVehicleChange}
              step="0.1"
              min="0"
            />
            <Input
              label="Fuel avg — idle (L/hr)"
              type="number"
              name="fuel_avg_idle"
              value={vehicle.fuel_avg_idle}
              onChange={handleVehicleChange}
              step="0.1"
              min="0"
              placeholder="Auto by vehicle type"
            />
          </div>
        </>
      )}
    </Modal>
  )
}

export default EditVehicleUserModal
