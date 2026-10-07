import { useEffect, useRef, useState } from 'react'
import { UserPlus } from 'lucide-react'
import api from '../../api'
import { Modal, Input, Select, Button } from '../../shared/components'
import { useTheme } from '../../theme'
import { usePanelScope } from '../../manager/hooks/usePanelScope'
import { useAuth } from '../../auth/AuthContext'
import { readActingAdminId } from '../../auth/actingAdminStorage'
import SuperAdminFleetSelect from './SuperAdminFleetSelect'
import UserPhotoField from './UserPhotoField'
import { uploadUserPhoto, uploadVehiclePhoto } from '../utils/userPic'
import { isNewUserPasswordValid, newUserPasswordChecks } from '../../shared/passwordPolicy'

// Shared create-user flow -> POST users, then POST vehicles
// (user_id: new user's id). Used by both AllUsers.jsx's and
// AllVehicles.jsx's "Add user" buttons. URLs are scope-aware via
// usePanelScope / apiFor (admin vs /api/manager/{id}/...).
//
// Product rule: every user must own exactly one vehicle from creation
// (see the one-vehicle-per-user unique constraint on Device.user_id) —
// so vehicle details are mandatory here, not a follow-up step. Vehicle
// fields cover identity plus driving parameters so the resulting
// vehicle is complete at create time.
//
// Same live-default: picking a vehicle type fills the idle-avg field
// with the fleet default, still fully editable, only while untouched.
//
// Creation isn't atomic across the two POSTs (separate resources, and
// device creation also calls out to Traccar) — if the vehicle POST
// fails after the user POST succeeds, we roll back by deleting the
// just-created user so a failed submit never leaves a vehicle-less
// user behind, keeping the mandatory pairing true in practice, not
// just at data-entry time.

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

const CreateUserModal = ({ onClose, onCreated }) => {
  const { tokens } = useTheme()
  const { apiFor, isManager } = usePanelScope()
  const { role } = useAuth()
  const [targetAdminId, setTargetAdminId] = useState('')
  const saGlobalCreate = role === 'super_admin' && readActingAdminId() == null && !isManager
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [fullName, setFullName] = useState('')
  const [phoneNumber, setPhoneNumber] = useState('')
  const [picFile, setPicFile] = useState(null)
  const [vehiclePicFile, setVehiclePicFile] = useState(null)
  // Chrome ignores autocomplete=off on many fields; unlock after mount so the
  // oversized mobile autofill bubble (saved IMEI / prior values) does not open.
  const [fieldsUnlocked, setFieldsUnlocked] = useState(false)
  const usernameRef = useRef(null)

  const [vehicle, setVehicle] = useState(emptyVehicleForm)
  const [idleTouched, setIdleTouched] = useState(false)
  const [fuelTypes, setFuelTypes] = useState([])
  const [geofences, setGeofences] = useState([])

  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setFieldsUnlocked(true)
      usernameRef.current?.focus()
    }, 120)
    return () => window.clearTimeout(timer)
  }, [])

  useEffect(() => {
    const load = async () => {
      try {
        const [fuelRes, geoRes] = await Promise.all([
          api.get('/api/fuel-types'),
          api.get('/api/geofences'),
        ])
        setFuelTypes(fuelRes.data)
        setGeofences(geoRes.data)
      } catch (err) {
        console.error('Failed to load fuel types / geofences:', err)
      }
    }
    load()
  }, [])

  const unlockField = (event) => {
    if (event.currentTarget.readOnly) {
      event.currentTarget.readOnly = false
    }
  }

  const fieldGuard = {
    readOnly: !fieldsUnlocked,
    onFocus: unlockField,
  }

  const canSave = username.trim().length > 0
    && isNewUserPasswordValid(password)
    && vehicle.name.trim().length > 0
    && vehicle.imei.trim().length > 0
    && (!saGlobalCreate || Boolean(targetAdminId))

  const passwordChecks = newUserPasswordChecks(password)

  const handleVehicleChange = (e) => {
    const { name, value } = e.target
    setVehicle((prev) => ({ ...prev, [name]: value }))
    if (name === 'fuel_avg_idle') setIdleTouched(true)
  }

  // Picking a vehicle type fills the idle-avg field with the fleet
  // default, still fully editable, only while untouched.
  const handleVehicleTypeChange = (e) => {
    const vehicleType = e.target.value
    setVehicle((prev) => ({
      ...prev,
      vehicle_type: vehicleType,
      fuel_avg_idle: idleTouched ? prev.fuel_avg_idle : String(IDLE_DEFAULTS_BY_VEHICLE_TYPE[vehicleType] ?? ''),
    }))
  }

  const handleCreate = async () => {
    if (!canSave) return
    if (saGlobalCreate && !targetAdminId) {
      setError('Fleet admin is required')
      return
    }
    setSaving(true)
    setError(null)

    const vehiclePayload = {
      name: vehicle.name.trim(),
      imei: vehicle.imei.trim(),
    }
    if (vehicle.vehicle_type) vehiclePayload.vehicle_type = vehicle.vehicle_type
    if (vehicle.plate_number) vehiclePayload.plate_number = vehicle.plate_number
    if (vehicle.fuel_type_id) vehiclePayload.fuel_type_id = Number(vehicle.fuel_type_id)
    if (vehicle.fuel_avg_running) vehiclePayload.fuel_avg_running = parseFloat(vehicle.fuel_avg_running)
    if (idleTouched && vehicle.fuel_avg_idle) vehiclePayload.fuel_avg_idle = parseFloat(vehicle.fuel_avg_idle)
    if (vehicle.primary_geofence_id) vehiclePayload.primary_geofence_id = Number(vehicle.primary_geofence_id)
    if (vehicle.speed_limit_kmh) vehiclePayload.speed_limit_kmh = parseFloat(vehicle.speed_limit_kmh)
    if (vehicle.harsh_brake_delta_kmh) vehiclePayload.harsh_brake_delta_kmh = parseFloat(vehicle.harsh_brake_delta_kmh)
    if (vehicle.harsh_accel_delta_kmh) vehiclePayload.harsh_accel_delta_kmh = parseFloat(vehicle.harsh_accel_delta_kmh)

    const userPayload = {
      username: username.trim(),
      password: password.trim(),
      full_name: fullName.trim() || null,
      phone_number: phoneNumber.trim() || null,
    }
    if (saGlobalCreate && targetAdminId) {
      userPayload.admin_id = Number(targetAdminId)
    }

    // Manager scope: one atomic POST (user + vehicle). Admin keeps the
    // established two-call flow with client-side rollback.
    if (isManager) {
      try {
        const userRes = await api.post(apiFor('/users', '/api/users'), {
          user: userPayload,
          vehicle: vehiclePayload,
        })
        await uploadUserPhoto(api, apiFor, userRes.data.id, picFile)
        await uploadVehiclePhoto(api, apiFor, userRes.data.vehicles?.[0]?.id, vehiclePicFile)
        onCreated(userRes.data)
        onClose()
      } catch (err) {
        setError(err.response?.data?.detail || 'Failed to create user')
      } finally {
        setSaving(false)
      }
      return
    }

    let newUser = null
    let vehicleCreated = false
    try {
      const userRes = await api.post('/api/users', userPayload)
      newUser = userRes.data

      const deviceRes = await api.post('/api/fleet/devices', {
        ...vehiclePayload,
        user_id: newUser.id,
      })
      vehicleCreated = true

      await uploadUserPhoto(api, apiFor, newUser.id, picFile)
      await uploadVehiclePhoto(api, apiFor, deviceRes.data?.id, vehiclePicFile)

      onCreated(newUser)
      onClose()
    } catch (err) {
      if (newUser != null && !vehicleCreated) {
        try {
          await api.delete(`/api/users/${newUser.id}`)
        } catch (rollbackErr) {
          console.error('Failed to roll back user after vehicle creation failed:', rollbackErr)
        }
      }
      setError(err.response?.data?.detail || (!vehicleCreated && newUser ? 'Failed to create vehicle' : 'Failed to create user'))
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
      title="Add User"
      size="lg"
      footer={(
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button onClick={handleCreate} loading={saving} disabled={!canSave}>
            <UserPlus size={15} />
            Create User & Vehicle
          </Button>
        </>
      )}
    >
      <form
        className="ft-create-user-form"
        autoComplete="off"
        onSubmit={(event) => {
          event.preventDefault()
          handleCreate()
        }}
      >
        <p style={{ margin: '0 0 14px', fontSize: 13, color: tokens.textSecondary }}>
          Every user must own a vehicle — fill in both below.
        </p>

        {saGlobalCreate && (
          <div style={{ marginBottom: 14 }}>
            <SuperAdminFleetSelect
              required
              value={targetAdminId}
              onChange={(e) => setTargetAdminId(e.target.value)}
            />
          </div>
        )}

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
            file={picFile}
            onChange={setPicFile}
            addLabel="Add photo"
            changeLabel="Change photo"
          />
        </div>
        <div style={grid}>
          <Input
            ref={usernameRef}
            label="Username *"
            type="text"
            name="ft-new-username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="jdoe"
            autoComplete="off"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            {...fieldGuard}
          />
          <Input
            label="Password *"
            type="password"
            name="ft-new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Min. 8 chars, upper, lower, number"
            autoComplete="new-password"
            {...fieldGuard}
          />
          <ul style={{ margin: '0 0 8px', paddingLeft: 18, fontSize: 12, color: tokens.textSecondary, gridColumn: '1 / -1' }}>
            <li style={{ color: passwordChecks.minLength ? tokens.semantic.success : tokens.textSecondary }}>At least 8 characters</li>
            <li style={{ color: passwordChecks.uppercase ? tokens.semantic.success : tokens.textSecondary }}>One uppercase letter</li>
            <li style={{ color: passwordChecks.lowercase ? tokens.semantic.success : tokens.textSecondary }}>One lowercase letter</li>
            <li style={{ color: passwordChecks.number ? tokens.semantic.success : tokens.textSecondary }}>One number</li>
          </ul>
          <Input
            label="Full name"
            type="text"
            name="ft-new-fullname"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            placeholder="Jane Doe"
            autoComplete="off"
            {...fieldGuard}
          />
          <Input
            label="Phone number"
            type="text"
            name="ft-new-phone"
            value={phoneNumber}
            onChange={(e) => setPhoneNumber(e.target.value)}
            placeholder="+1 555 123 4567"
            autoComplete="off"
            inputMode="tel"
            {...fieldGuard}
          />
        </div>

        <div style={{ ...sectionTitle, marginTop: 20 }}>Vehicle identity</div>
        <div style={{ marginBottom: 14 }}>
          <UserPhotoField
            label="Vehicle photo"
            name={vehicle.name || 'Vehicle'}
            file={vehiclePicFile}
            onChange={setVehiclePicFile}
            addLabel="Add photo"
            changeLabel="Change photo"
          />
        </div>
        <div style={grid}>
          <Input label="Name *" type="text" name="name" value={vehicle.name} onChange={handleVehicleChange} autoComplete="off" {...fieldGuard} />
          <Input label="IMEI *" type="text" name="imei" value={vehicle.imei} onChange={handleVehicleChange} autoComplete="off" inputMode="numeric" {...fieldGuard} />
          <Select label="Vehicle type" name="vehicle_type" value={vehicle.vehicle_type} onChange={handleVehicleTypeChange} autoComplete="off">
            <option value="">Select type</option>
            <option value="bike">Bike</option>
            <option value="car">Car</option>
            <option value="van">Van</option>
            <option value="truck">Truck</option>
          </Select>
          <Input label="Plate number" type="text" name="plate_number" value={vehicle.plate_number} onChange={handleVehicleChange} autoComplete="off" {...fieldGuard} />
          <Select label="Fuel type" name="fuel_type_id" value={vehicle.fuel_type_id} onChange={handleVehicleChange} autoComplete="off">
            <option value="">Select fuel type</option>
            {fuelTypes.map((ft) => (
              <option key={ft.id} value={ft.id}>{ft.name}</option>
            ))}
          </Select>
          <Select label="Primary geofence" name="primary_geofence_id" value={vehicle.primary_geofence_id} onChange={handleVehicleChange} autoComplete="off">
            <option value="">None</option>
            {geofences.map((g) => (
              <option key={g.id} value={g.id}>{g.name}</option>
            ))}
          </Select>
        </div>

        <div style={{ ...sectionTitle, marginTop: 20 }}>Driving parameters</div>
        <p style={{ fontSize: 12, color: tokens.textSecondary, margin: '-6px 0 12px' }}>
          Prefilled with fleet defaults based on vehicle type — adjust as needed.
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
            autoComplete="off"
            {...fieldGuard}
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
            autoComplete="off"
            {...fieldGuard}
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
            autoComplete="off"
            {...fieldGuard}
          />
          <Input
            label="Fuel avg — running (km/L)"
            type="number"
            name="fuel_avg_running"
            value={vehicle.fuel_avg_running}
            onChange={handleVehicleChange}
            step="0.1"
            min="0"
            autoComplete="off"
            {...fieldGuard}
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
            autoComplete="off"
            {...fieldGuard}
          />
        </div>
      </form>
    </Modal>
  )
}

export default CreateUserModal
