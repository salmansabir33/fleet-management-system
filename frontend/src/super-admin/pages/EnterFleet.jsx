import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import api from '../../api'
import { writeActingAdmin } from '../../auth/actingAdminStorage'
import { dispatchActingAdminChanged } from '../../auth/actingAdminEvents'
import { clearAllScopedCaches } from '../../shared/clearScopedCaches'
import {
  Button,
  Card,
  LoadingState,
  PageHeader,
  Select,
} from '../../shared/components'

const EnterFleet = () => {
  const navigate = useNavigate()
  const [admins, setAdmins] = useState([])
  const [adminId, setAdminId] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      setLoading(true)
      try {
        const res = await api.get('/api/super-admin/admins')
        if (cancelled) return
        const active = (res.data || []).filter((row) => row.is_active)
        setAdmins(active)
        if (active.length > 0) setAdminId(String(active[0].id))
      } catch (err) {
        if (!cancelled) setError(err.response?.data?.detail || 'Failed to load admins')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [])

  const handleEnter = () => {
    const selected = admins.find((row) => String(row.id) === String(adminId))
    if (!selected) return
    const label = selected.full_name || selected.username
    clearAllScopedCaches()
    writeActingAdmin(selected.id, label)
    dispatchActingAdminChanged()
    navigate('/super-admin/dashboard', { replace: true })
  }

  if (loading) return <LoadingState label="Loading fleet admins…" />

  return (
    <div className="ft-page-stack">
      <PageHeader
        title="Enter fleet"
        subtitle="Choose a fleet admin to act as. Their data and settings scope apply until you exit."
      />

      {error && <div className="ft-admin-settings-error">{error}</div>}

      <Card title="Acting context">
        {admins.length === 0 ? (
          <p className="ft-muted">No active fleet admins yet. Create one first.</p>
        ) : (
          <>
            <Select
              label="Fleet admin"
              value={adminId}
              onChange={(e) => setAdminId(e.target.value)}
            >
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
            <div style={{ marginTop: 16, display: 'flex', justifyContent: 'flex-end' }}>
              <Button type="button" onClick={handleEnter} disabled={!adminId}>
                Enter fleet portal
              </Button>
            </div>
          </>
        )}
      </Card>
    </div>
  )
}

export default EnterFleet
