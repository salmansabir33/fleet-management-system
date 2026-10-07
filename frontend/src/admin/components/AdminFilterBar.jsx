import { useCallback, useEffect, useState } from 'react'
import { Shield } from 'lucide-react'
import api from '../../api'
import { Select } from '../../shared/components'
import {
  readSaAdminFilter,
  writeSaAdminFilter,
  SA_ADMIN_FILTER_EVENT,
} from '../utils/saAdminFilter'
import { useShowSaAdminFilter } from '../hooks/useSaAdminListParams'
import './AdminFilterBar.css'

const AdminFilterBar = ({ compact = false, inline = false, className = '' }) => {
  const show = useShowSaAdminFilter()
  const [admins, setAdmins] = useState([])
  const [value, setValue] = useState(() => {
    const id = readSaAdminFilter()
    return id == null ? '' : String(id)
  })

  const loadAdmins = useCallback(async () => {
    try {
      const res = await api.get('/api/super-admin/admins')
      setAdmins((res.data || []).filter((row) => row.is_active))
    } catch {
      setAdmins([])
    }
  }, [])

  useEffect(() => {
    if (!show) return undefined
    loadAdmins()
  }, [show, loadAdmins])

  useEffect(() => {
    if (!show) return undefined
    const sync = () => {
      const id = readSaAdminFilter()
      setValue(id == null ? '' : String(id))
    }
    window.addEventListener(SA_ADMIN_FILTER_EVENT, sync)
    return () => window.removeEventListener(SA_ADMIN_FILTER_EVENT, sync)
  }, [show])

  if (!show) return null

  const handleChange = (e) => {
    const next = e.target.value
    setValue(next)
    writeSaAdminFilter(next === '' ? null : Number(next))
  }

  const adminOptions = admins.map((admin) => (
    <option key={admin.id} value={String(admin.id)}>
      {admin.full_name || admin.username}
    </option>
  ))

  if (inline) {
    return (
      <div className={`ft-sa-admin-filter ft-sa-admin-filter--inline ${className}`.trim()}>
        <span className="ft-sa-admin-filter__inline-label">Fleet admin</span>
        <Select
          value={value}
          onChange={handleChange}
          className="ft-sa-admin-filter__inline-select"
          aria-label="Fleet admin"
        >
          <option value="">All fleets</option>
          {adminOptions}
        </Select>
      </div>
    )
  }

  if (compact) {
    return (
      <div className={`ft-admin-period-filter ft-sa-admin-filter--compact ${className}`.trim()}>
        <span className="ft-admin-period-filter__icon" aria-hidden>
          <Shield size={15} strokeWidth={2.25} />
        </span>
        <Select
          value={value}
          onChange={handleChange}
          className="ft-admin-period-filter__select"
          aria-label="Fleet admin"
        >
          <option value="">All</option>
          {adminOptions}
        </Select>
      </div>
    )
  }

  return (
    <div className={`ft-sa-admin-filter ${className}`.trim()} style={{ marginBottom: 12, maxWidth: 320 }}>
      <Select label="Fleet admin" value={value} onChange={handleChange}>
        <option value="">All fleets</option>
        {admins.map((admin) => (
          <option key={admin.id} value={String(admin.id)}>
            {admin.full_name || admin.username}
            {' '}
            (
            {admin.username}
            )
          </option>
        ))}
      </Select>
    </div>
  )
}

export default AdminFilterBar
