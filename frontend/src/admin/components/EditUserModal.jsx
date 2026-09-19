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
  imei: '',
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

const vehicleToForm = (device, imei = '') => ({
  name: device?.name || '',
  imei,
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

const EditUserModal = ({ user, onClose, onSaved }) => {
  const { tokens } = useTheme()
  const { apiFor, can } = usePanelScope()
  const deviceId = user?.vehicles?.[0]?.id ?? null

  const [username, setUsername] = useState(user.username || '')
  const [password, setPassword] = useState('')
  const [fullName, setFullName] = useState(user.full_name || '')
  const [phoneNumber, setPhoneNumber] = useState(user.phone_number || '')
  const [picFile, setPicFile] = useState(null)
  const [vehiclePicFile, setVehiclePicFile] = useState(null)
  const [vehiclePicUrl, setVehiclePicUrl] = useState(user.vehicles?.[0]?.pic_url || null)

  const [vehicle, setVehicle] = useState(() => vehicleToForm(user.vehicles?.[0]))
  const [idleTouched, setIdleTouched] = useState(Boolean(user.vehicles?.[0]?.fuel_avg_idle != null))
  const [fuelTypes, setFuelTypes] = useState([])
  const [geofences, setGeofences] = useState([])
  const [loading, setLoading] = useState(Boolean(deviceId))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const [canEditVehicle, setCanEditVehicle] = useState(false)

  useEffect(() => {
    let cancelled = false

    const load = async () => {
      setError(null)
      try {
        const [fuelRes, geoRes] = await Promise.all([
          api.get('/api/fuel-types'),
          api.get('/api/geofences'),
        ])
        if (cancelled) return
        setFuelTypes(fuelRes.data || [])
        setGeofences(geoRes.data || [])

        if (!deviceId) {
          setLoading(false)
          return
        }

        let device = user.vehicles?.[0]
        try {
          const deviceRes = await api.get(apiFor(`/vehicles/${deviceId}`, `/api/fleet/devices/${deviceId}`))
          device = deviceRes.data
          setCanEditVehicle(true)
        } catch {
          setCanEditVehicle(false)
        }

        let imei = ''
        if (can('live_tracking')) {
          try {
            const liveRes = await api.get(apiFor('/vehicles', '/api/live'))
            const match = (liveRes.data.live || []).find((v) => String(v.db_id) === String(deviceId))
            imei = match?.device?.uniqueId || ''
          } catch {
            imei = ''
          }
        }

        if (!cancelled) {
          setVehicle(vehicleToForm(device, imei))
          setIdleTouched(Boolean(device?.fuel_avg_idle != null))
          setVehiclePicUrl(device?.pic_url || user.vehicles?.[0]?.pic_url || null)
        }
      } catch (err) {
        if (!cancelled) {
          setError(err.response?.data?.detail || 'Failed to load user details')
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    load()
    return () => { cancelled = true }
  }, [apiFor, can, deviceId, user])

  const canSave = username.trim().length > 0 && (!canEditVehicle || vehicle.name.trim().length > 0)

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
    if (!canSave) return
    setSaving(true)
    setError(null)
    try {
      const userPayload = {
        username: username.trim(),
        full_name: fullName.trim() || null,
        phone_number: phoneNumber.trim() || null,
      }
      if (password.trim()) {
        userPayload.password = password.trim()
      }
      const requests = [
        api.patch(apiFor(`/users/${user.id}`, `/api/users/${user.id}`), userPayload),
      ]
      if (canEditVehicle && deviceId) {
        requests.push(
          api.patch(
            apiFor(`/vehicles/${deviceId}`, `/api/fleet/devices/${deviceId}`),
            buildVehiclePayload(),
          ),
        )
      }
      await Promise.all(requests)
      await uploadUserPhoto(api, apiFor, user.id, picFile)
      await uploadVehiclePhoto(api, apiFor, deviceId, vehiclePicFile)
      onSaved()
      onClose()
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to update user')
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
      title="Edit User"
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
          <p style={{ margin: '0 0 14px', fontSize: 13, color: tokens.textSecondary }}>
            Update this user and their vehicle below.
          </p>

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

          <div style={sectionTitle}>User details</div>
          <div style={{ marginBottom: 14 }}>
            <UserPhotoField
              name={fullName || username}
              currentSrc={user.pic_url}
              file={picFile}
              onChange={setPicFile}
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
              autoFocus
            />
            <Input
              label="Reset password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Leave blank to keep current"
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

          {deviceId && (
            <>
              <div style={{ ...sectionTitle, marginTop: 20 }}>Vehicle identity</div>
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
                <Input label="Name *" type="text" name="name" value={vehicle.name} onChange={handleVehicleChange} disabled={!canEditVehicle} />
                <Input label="IMEI" type="text" name="imei" value={vehicle.imei} readOnly disabled />
                <Select label="Vehicle type" name="vehicle_type" value={vehicle.vehicle_type} onChange={handleVehicleTypeChange} disabled={!canEditVehicle}>
                  <option value="">Select type</option>
                  <option value="bike">Bike</option>
                  <option value="car">Car</option>
                  <option value="van">Van</option>
                  <option value="truck">Truck</option>
                </Select>
                <Input label="Plate number" type="text" name="plate_number" value={vehicle.plate_number} onChange={handleVehicleChange} disabled={!canEditVehicle} />
                <Select label="Fuel type" name="fuel_type_id" value={vehicle.fuel_type_id} onChange={handleVehicleChange} disabled={!canEditVehicle}>
                  <option value="">Select fuel type</option>
                  {fuelTypes.map((ft) => (
                    <option key={ft.id} value={ft.id}>{ft.name}</option>
                  ))}
                </Select>
                <Select label="Primary geofence" name="primary_geofence_id" value={vehicle.primary_geofence_id} onChange={handleVehicleChange} disabled={!canEditVehicle}>
                  <option value="">None</option>
                  {geofences.map((g) => (
                    <option key={g.id} value={g.id}>{g.name}</option>
                  ))}
                </Select>
              </div>

              <div style={{ ...sectionTitle, marginTop: 20 }}>Driving parameters</div>
              <p style={{ fontSize: 12, color: tokens.textSecondary, margin: '-6px 0 12px' }}>
                Prefilled with this vehicle’s saved values — adjust as needed.
              </p>
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
                  disabled={!canEditVehicle}
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
                  disabled={!canEditVehicle}
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
                  disabled={!canEditVehicle}
                />
                <Input
                  label="Fuel avg — running (km/L)"
                  type="number"
                  name="fuel_avg_running"
                  value={vehicle.fuel_avg_running}
                  onChange={handleVehicleChange}
                  step="0.1"
                  min="0"
                  disabled={!canEditVehicle}
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
                  disabled={!canEditVehicle}
                />
              </div>
            </>
          )}
        </>
      )}
    </Modal>
  )
}

export default EditUserModal
