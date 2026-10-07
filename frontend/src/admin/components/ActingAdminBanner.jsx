import { useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { clearActingAdmin, readActingAdminId, readActingAdminLabel } from '../../auth/actingAdminStorage'
import { ACTING_ADMIN_CHANGED_EVENT, dispatchActingAdminChanged } from '../../auth/actingAdminEvents'
import { clearAllScopedCaches } from '../../shared/clearScopedCaches'
import { useAuth } from '../../auth/AuthContext'
import { resolveBasePath } from '../../shared/hooks/useBasePath'
import '../styles/admin-settings.css'

const ActingAdminBanner = () => {
  const navigate = useNavigate()
  const location = useLocation()
  const { role } = useAuth()
  const [actingId, setActingId] = useState(() => readActingAdminId())
  const [label, setLabel] = useState(() => (
    readActingAdminLabel() || (readActingAdminId() != null ? `Admin #${readActingAdminId()}` : '')
  ))

  useEffect(() => {
    const sync = () => {
      const id = readActingAdminId()
      setActingId(id)
      setLabel(readActingAdminLabel() || (id != null ? `Admin #${id}` : ''))
    }
    sync()
    window.addEventListener(ACTING_ADMIN_CHANGED_EVENT, sync)
    return () => window.removeEventListener(ACTING_ADMIN_CHANGED_EVENT, sync)
  }, [])
  const basePath = resolveBasePath(location.pathname)

  if (role !== 'super_admin') return null
  if (!location.pathname.startsWith('/super-admin')) return null

  const handleExit = () => {
    clearActingAdmin()
    clearAllScopedCaches()
    dispatchActingAdminChanged()
    const stay = location.pathname.startsWith(basePath)
      ? location.pathname
      : `${basePath}/dashboard`
    navigate(stay, { replace: true })
  }

  if (actingId == null) return null

  return (
    <div className="ft-acting-admin-banner" role="status">
      <span>
        Acting as
        {' '}
        <strong>{label}</strong>
      </span>
      <button type="button" className="ft-acting-admin-banner__exit" onClick={handleExit}>
        Exit
      </button>
    </div>
  )
}

export default ActingAdminBanner
