import { useState } from 'react'
import { Link, Navigate } from 'react-router-dom'
import {
  Antenna,
  ArrowRight,
  Bell,
  Bike,
  Car,
  ChartColumn,
  Eye,
  EyeOff,
  Lock,
  Shield,
  Truck,
  User,
  Wrench,
} from 'lucide-react'
import { useAuth } from '../auth/AuthContext'
import '../styles/login.css'

const HERO_FEATURES = [
  { icon: Antenna, label: 'Live Tracking' },
  { icon: ChartColumn, label: 'Trip Analytics' },
  { icon: Bell, label: 'Safety Alerts' },
  { icon: Wrench, label: 'Maintenance' },
]

const Login = () => {
  const { loading, isAuthenticated, role, managerId, login } = useAuth()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState(null)
  const [submitting, setSubmitting] = useState(false)

  if (!loading && isAuthenticated) {
    if (role === 'admin') return <Navigate to="/admin/dashboard" replace />
    if (role === 'manager' && managerId) return <Navigate to={`/manager/${managerId}/dashboard`} replace />
    return <Navigate to="/user/dashboard" replace />
  }

  const handleSubmit = async (event) => {
    event.preventDefault()
    setSubmitting(true)
    setError(null)
    try {
      await login(username.trim(), password)
    } catch (err) {
      setError(err.response?.data?.detail || 'Login failed. Check your username and password.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="ft-login-page">
      <div className="ft-login-decor" aria-hidden="true">
        <div className="ft-login-map" />
        <div className="ft-login-satellite">
          <span className="ft-login-satellite-body" />
          <span className="ft-login-satellite-beam" />
        </div>
        <span className="ft-login-pin ft-login-pin--1"><Car size={14} /></span>
        <span className="ft-login-pin ft-login-pin--2"><Bike size={14} /></span>
        <span className="ft-login-pin ft-login-pin--3"><Truck size={14} /></span>
      </div>

      <div className="ft-login-shell">
        <section className="ft-login-hero">
          <div className="ft-login-hero-brand">
            <div className="ft-login-hero-logo">
              <Shield size={22} color="#fff" />
            </div>
            <div>
              <p className="ft-login-hero-name">
                FLEET <span>TRACKER</span>
              </p>
              <p className="ft-login-hero-tag">Smart Tracking. Better Decisions.</p>
            </div>
          </div>

          <h2 className="ft-login-hero-headline">
            Track Every Journey.
            <br />
            Drive <span>Better Results.</span>
          </h2>
          <p className="ft-login-hero-copy">
            Real-time tracking, trip history, alerts, maintenance and more — all in one powerful platform.
          </p>

          <ul className="ft-login-features">
            {HERO_FEATURES.map(({ icon: Icon, label }) => (
              <li key={label}>
                <span className="ft-login-feature-icon">
                  <Icon size={22} />
                </span>
                <span>{label}</span>
              </li>
            ))}
          </ul>
        </section>

        <section className="ft-login-panel">
          <div className="ft-login-card">
            <div className="ft-login-brand">
              <div className="ft-login-shield">
                <Shield size={28} color="#fff" />
              </div>
              <h1 className="ft-login-title">FLEET TRACKER</h1>
              <p className="ft-login-subtitle">Sign in to access your fleet dashboard</p>
            </div>

            <form className="ft-login-form" onSubmit={handleSubmit}>
              <div className="ft-login-field">
                <label htmlFor="username">Username</label>
                <div className="ft-login-input-wrap">
                  <User size={16} />
                  <input
                    id="username"
                    type="text"
                    autoComplete="username"
                    placeholder="Enter your username"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    required
                  />
                </div>
              </div>

              <div className="ft-login-field">
                <label htmlFor="password">Password</label>
                <div className="ft-login-input-wrap">
                  <Lock size={16} />
                  <input
                    id="password"
                    type={showPassword ? 'text' : 'password'}
                    autoComplete="current-password"
                    placeholder="Enter your password"
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
                {submitting ? 'Signing in…' : 'Sign In'}
                {!submitting && <ArrowRight size={16} />}
              </button>
            </form>

            <p className="ft-login-footer">
              Administrator? <Link to="/admin/login">Admin login</Link>
            </p>
          </div>
        </section>
      </div>
    </div>
  )
}

export default Login
