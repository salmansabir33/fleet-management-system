import { useState } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { ArrowRight, Eye, EyeOff, Lock, Shield, User } from 'lucide-react'
import { useAuth } from '../auth/AuthContext'
import '../styles/login.css'

const AdminLogin = () => {
  const { loading, isAuthenticated, role, adminLogin } = useAuth()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState(null)
  const [submitting, setSubmitting] = useState(false)

  if (!loading && isAuthenticated && role === 'admin') {
    return <Navigate to="/admin/dashboard" replace />
  }
  if (!loading && isAuthenticated && role === 'super_admin') {
    return <Navigate to="/super-admin/dashboard" replace />
  }

  const handleSubmit = async (event) => {
    event.preventDefault()
    setSubmitting(true)
    setError(null)
    try {
      await adminLogin(username.trim(), password)
    } catch (err) {
      setError(err.response?.data?.detail || 'Invalid admin credentials.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="ft-login-page ft-login-page--admin">
      <div className="ft-login-card">
        <div className="ft-login-brand">
          <div className="ft-login-shield">
            <Shield size={28} color="#fff" />
          </div>
          <h1 className="ft-login-title">Admin Portal</h1>
          <p className="ft-login-subtitle">Super administrator sign in</p>
        </div>

        <form className="ft-login-form" onSubmit={handleSubmit}>
          <div className="ft-login-field">
            <label htmlFor="admin-username">Admin username</label>
            <div className="ft-login-input-wrap">
              <User size={16} />
              <input
                id="admin-username"
                type="text"
                autoComplete="username"
                placeholder="Enter admin username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
              />
            </div>
          </div>

          <div className="ft-login-field">
            <label htmlFor="admin-password">Password</label>
            <div className="ft-login-input-wrap">
              <Lock size={16} />
              <input
                id="admin-password"
                type={showPassword ? 'text' : 'password'}
                autoComplete="current-password"
                placeholder="Enter admin password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
              <button
                type="button"
                className="ft-login-toggle"
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                onClick={() => setShowPassword((v) => !v)}
              >
                {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>

          {error && <p className="ft-login-error">{error}</p>}

          <button type="submit" className="ft-login-submit" disabled={submitting}>
            {submitting ? 'Signing in…' : 'Sign In as Admin'}
            {!submitting && <ArrowRight size={16} />}
          </button>
        </form>

        <p className="ft-login-footer">
          Fleet user or manager? <Link to="/login">Back to login</Link>
        </p>
      </div>
    </div>
  )
}

export default AdminLogin
