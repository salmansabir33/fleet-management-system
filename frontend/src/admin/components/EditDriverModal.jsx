import { useState } from 'react'
import { Save } from 'lucide-react'
import api, { API_BASE_URL } from '../../api'
import { Modal, Input, Select, Button } from '../../shared/components'
import { useTheme } from '../../theme'
import { usePanelScope } from '../../manager/hooks/usePanelScope'
import DriverVehicleSelect, { applyDriverVehicleAssignment } from './DriverVehicleSelect'

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

const EditDriverModal = ({ driver, onClose, onSaved }) => {
  const { tokens } = useTheme()
  const { apiFor } = usePanelScope()
  const [name, setName] = useState(driver.name || '')
  const [idCardNumber, setIdCardNumber] = useState(driver.id_card_number || '')
  const [phoneNumber, setPhoneNumber] = useState(driver.phone_number || '')
  const [licenseNumber, setLicenseNumber] = useState(driver.license_number || '')
  const [licenseExpiry, setLicenseExpiry] = useState(driver.license_expiry || '')
  const [status, setStatus] = useState(driver.status || 'active')
  const [dateJoined, setDateJoined] = useState(driver.date_joined || '')
  const [driverPic, setDriverPic] = useState(null)
  const [licensePic, setLicensePic] = useState(null)
  const [deviceId, setDeviceId] = useState(
    driver.current_device_id != null ? String(driver.current_device_id) : '',
  )

  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  const canSave = name.trim().length > 0 && CNIC_COMPLETE.test(idCardNumber)

  const handleSave = async () => {
    if (!canSave) return
    setSaving(true)
    setError(null)
    try {
      const data = new FormData()
      data.append('name', name.trim())
      data.append('id_card_number', idCardNumber)
      data.append('phone_number', phoneNumber.trim())
      data.append('license_number', licenseNumber.trim())
      if (licenseExpiry) data.append('license_expiry', licenseExpiry)
      data.append('status', status)
      if (dateJoined) data.append('date_joined', dateJoined)
      if (driverPic) data.append('driver_pic', driverPic)
      if (licensePic) data.append('license_pic', licensePic)

      await api.patch(apiFor(`/drivers/${driver.id}`, `/api/drivers/${driver.id}`), data, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
      try {
        await applyDriverVehicleAssignment({
          apiFor,
          driverId: driver.id,
          previousDeviceId: driver.current_device_id,
          nextDeviceId: deviceId,
        })
      } catch (assignErr) {
        setError(apiError(assignErr, 'Driver saved, but vehicle assignment failed'))
        onSaved()
        return
      }
      onSaved()
      onClose()
    } catch (err) {
      setError(apiError(err, 'Failed to update driver'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Edit Driver"
      size="md"
      footer={(
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button onClick={handleSave} loading={saving} disabled={!canSave}>
            <Save size={15} />
            Save Changes
          </Button>
        </>
      )}
    >
      <p style={{ margin: '0 0 14px', fontSize: 13, color: tokens.textSecondary }}>
        Leave photos empty to keep the current ones.
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
          currentDeviceId={driver.current_device_id}
          currentDeviceName={driver.current_device_name}
          currentDevicePlate={driver.current_device_plate}
        />
        <div className="ft-field">
          <label className="ft-field-label">Driver photo</label>
          {driver.driver_pic_path && (
            <img
              src={`${API_BASE_URL}${driver.driver_pic_path}`}
              alt=""
              style={{
                width: 48,
                height: 48,
                borderRadius: 8,
                objectFit: 'cover',
                border: `1px solid ${tokens.border}`,
                marginBottom: 6,
              }}
            />
          )}
          <input
            type="file"
            accept="image/*"
            className="ft-control"
            onChange={(e) => setDriverPic(e.target.files[0] || null)}
          />
        </div>
        <div className="ft-field">
          <label className="ft-field-label">License photo</label>
          {driver.license_pic_path && (
            <img
              src={`${API_BASE_URL}${driver.license_pic_path}`}
              alt=""
              style={{
                width: 48,
                height: 48,
                borderRadius: 8,
                objectFit: 'cover',
                border: `1px solid ${tokens.border}`,
                marginBottom: 6,
              }}
            />
          )}
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

export default EditDriverModal
