import { Navigate, useLocation } from 'react-router-dom'
import { LoadingState } from '../shared/components'
import { useAuth } from './AuthContext'

const ProtectedRoute = ({ roles, children }) => {
  const { loading, isAuthenticated, role, managerId } = useAuth()
  const location = useLocation()

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center' }}>
        <LoadingState label="Checking session…" />
      </div>
    )
  }

  const loginPath = location.pathname.startsWith('/admin') ? '/admin/login' : '/login'

  if (!isAuthenticated) {
    return <Navigate to={loginPath} replace state={{ from: location.pathname }} />
  }

  if (roles && roles.length > 0 && !roles.includes(role)) {
    if (role === 'admin') return <Navigate to="/admin/dashboard" replace />
    if (role === 'manager' && managerId) return <Navigate to={`/manager/${managerId}/dashboard`} replace />
    return <Navigate to="/user/dashboard" replace />
  }

  return children
}

export default ProtectedRoute
