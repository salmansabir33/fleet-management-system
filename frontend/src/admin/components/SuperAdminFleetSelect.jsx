import { useEffect, useState } from 'react'
import api from '../../api'
import { Select } from '../../shared/components'
import { useAuth } from '../../auth/AuthContext'
import { readActingAdminId } from '../../auth/actingAdminStorage'

/**
 * Fleet admin picker for super-admin global mode (no acting context).
 * Returns null when not applicable.
 */
const SuperAdminFleetSelect = ({
  value,
  onChange,
  label = 'Fleet admin',
  required = false,
  optional = false,
}) => {
  const { role } = useAuth()
  const acting = readActingAdminId()
  const [admins, setAdmins] = useState([])

  useEffect(() => {
    if (role !== 'super_admin' || acting != null) return undefined
    let cancelled = false
    api.get('/api/super-admin/admins')
      .then((res) => {
        if (!cancelled) setAdmins((res.data || []).filter((row) => row.is_active))
      })
      .catch(() => {
        if (!cancelled) setAdmins([])
      })
    return () => { cancelled = true }
  }, [role, acting])

  if (role !== 'super_admin' || acting != null) return null

  const labelText = optional ? `${label} (optional)` : label

  return (
    <Select
      label={labelText}
      value={value}
      onChange={onChange}
      required={required}
    >
      {!required && optional && <option value="">— Unassigned / default —</option>}
      {required && <option value="">Select fleet admin…</option>}
      {admins.map((admin) => (
        <option key={admin.id} value={admin.id}>
          {admin.full_name || admin.username}
          {' '}
          (
          {admin.username}
          )
        </option>
      ))}
    </Select>
  )
}

export default SuperAdminFleetSelect
