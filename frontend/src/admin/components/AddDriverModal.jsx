import { useState } from 'react'
import { UserPlus } from 'lucide-react'
import api from '../../api'
import { Modal, Input, Select, Button } from '../../shared/components'
import { useTheme } from '../../theme'
import { usePanelScope } from '../../manager/hooks/usePanelScope'
import { useAuth } from '../../auth/AuthContext'
import { readActingAdminId } from '../../auth/actingAdminStorage'
import SuperAdminFleetSelect from './SuperAdminFleetSelect'
import DriverVehicleSelect, { applyDriverVehicleAssignment } from './DriverVehicleSelect'

// Formats raw digits into 12345-1234567-1 as the user types, matching
// the CNIC format the backend validates.
const formatCnic = (raw) => {
  const digits = raw.replace(/\D/g, '').slice(0, 13)
  const part1 = digits.slice(0, 5)
  const part2 = digits.slice(5, 12)
  const part3 = digits.slice(12, 13)
  let out = part1
  if (part2) out += `-${part2}`
  if (part3) out += `-${part3}`
  return out
}

const CNIC_COMPLETE = /^\d{5}-\d{7}-\d{1}$/

const apiError = (err, fallback) => {
  const detail = err.response?.data?.detail
  if (typeof detail === 'string') return detail
  if (Array.isArray(detail) && detail.length) {
    return detail.map((d) => d.msg || d).join(' ')
  }
  return fallback
}

const AddDriverModal = ({ onClose, onCreated }) => {
  const { tokens } = useTheme()
  const { apiFor } = usePanelScope()
  const { role } = useAuth()
  const [targetAdminId, setTargetAdminId] = useState('')
  const saGlobalCreate = role === 'super_admin' && readActingAdminId() == null
  const [name, setName] = useState('')
  const [idCardNumber, setIdCardNumber] = useState('')
  const [phoneNumber, setPhoneNumber] = useState('')
  const [licenseNumber, setLicenseNumber] = useState('')
  const [licenseExpiry, setLicenseExpiry] = useState('')
  const [status, setStatus] = useState('active')
  const [dateJoined, setDateJoined] = useState('')
  const [driverPic, setDriverPic] = useState(null)
  const [licensePic, setLicensePic] = useState(null)
  const [deviceId, setDeviceId] = useState('')

  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  const canSave = name.trim().length > 0 && CNIC_COMPLETE.test(idCardNumber)
    && (!saGlobalCreate || targetAdminId)

  const handleCreate = async () => {
    if (!canSave) return
    setSaving(true)
    setError(null)
    try {
      const data = new FormData()
      data.append('name', name.trim())
      data.append('id_card_number', idCardNumber)
      if (phoneNumber.trim()) data.append('phone_number', phoneNumber.trim())
      if (licenseNumber.trim()) data.append('license_number', licenseNumber.trim())
      if (licenseExpiry) data.append('license_expiry', licenseExpiry)
      data.append('status', status)
      if (dateJoined) data.append('date_joined', dateJoined)
      if (driverPic) data.append('driver_pic', driverPic)
      if (licensePic) data.append('license_pic', licensePic)
      if (saGlobalCreate && targetAdminId) {
        data.append('admin_id', String(targetAdminId))
      }

      const res = await api.post(apiFor('/drivers', '/api/drivers'), data, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
      const created = res.data
      try {
        await applyDriverVehicleAssignment({
          apiFor,
          driverId: created.id,
          previousDeviceId: null,
          nextDeviceId: deviceId,
        })
      } catch (assignErr) {
        setError(apiError(assignErr, 'Driver created, but vehicle assignment failed'))
        onCreated()
        return
      }
      onCreated()
      onClose()
    } catch (err) {
      setError(apiError(err, 'Failed to create driver'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Add Driver"
      size="md"
      footer={(
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button onClick={handleCreate} loading={saving} disabled={!canSave}>
            <UserPlus size={15} />
            Create Driver
          </Button>
        </>
      )}
    >
      <p style={{ margin: '0 0 14px', fontSize: 13, color: tokens.textSecondary }}>
        Name and CNIC are required.
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

      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
        gap: 14,
      }}
      >
        <Input
          label="Name *"
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Full name"
          autoFocus
        />
        <Input
          label="CNIC *"
          type="text"
          value={idCardNumber}
          onChange={(e) => setIdCardNumber(formatCnic(e.target.value))}
          placeholder="12345-1234567-1"
        />
        <Input
          label="Phone number"
          type="text"
          value={phoneNumber}
          onChange={(e) => setPhoneNumber(e.target.value)}
          placeholder="+92 300 1234567"
        />
        <Input
          label="License number"
          type="text"
          value={licenseNumber}
          onChange={(e) => setLicenseNumber(e.target.value)}
        />
        <Input
          label="License expiry"
          type="date"
          value={licenseExpiry}
          onChange={(e) => setLicenseExpiry(e.target.value)}
        />
        <Select label="Status" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
          <option value="on_leave">On Leave</option>
        </Select>
        <Input
          label="Date joined"
          type="date"
          value={dateJoined}
          onChange={(e) => setDateJoined(e.target.value)}
        />
        <DriverVehicleSelect
          value={deviceId}
          onChange={(e) => setDeviceId(e.target.value)}
          disabled={saving}
          helperText="Optional"
        />
        <div className="ft-field">
          <label className="ft-field-label">Driver photo</label>
          <input
            type="file"
            accept="image/*"
            className="ft-control"
            onChange={(e) => setDriverPic(e.target.files[0] || null)}
          />
        </div>
        <div className="ft-field">
          <label className="ft-field-label">License photo</label>
          <input
            type="file"
            accept="image/*"
            className="ft-control"
            onChange={(e) => setLicensePic(e.target.files[0] || null)}
          />
        </div>
      </div>
    </Modal>
  )
}

export default AddDriverModal
