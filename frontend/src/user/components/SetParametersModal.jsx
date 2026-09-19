import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { X, Gauge, Fuel, MapPinned, AlertTriangle } from 'lucide-react'
import api from '../../api'
import { colors, radius, shadow } from '../theme'
import { usePanelScope } from '../../manager/hooks/usePanelScope'

// Vehicle-customization form opened from the "Set Parameters" button on
// My Vehicle. Deliberately scoped to driving-behavior + fuel-average
// settings (speed limit, harsh brake/accel sensitivity, fuel averages,
// primary geofence) — identity fields like name/plate/vehicle type/fuel
// type stay admin-only on the Fleet Devices "Edit Device" page.
const toFormValue = (value) => (value == null || value === '' ? '' : String(value))

const SetParametersModal = ({ device, deviceId, onClose, onSaved }) => {
  const { apiFor } = usePanelScope()
  const [form, setForm] = useState({
    fuel_avg_running: '',
    fuel_avg_idle: '',
    primary_geofence_id: '',
    speed_limit_kmh: '',
    harsh_brake_delta_kmh: '',
    harsh_accel_delta_kmh: '',
  })
  const [original, setOriginal] = useState(null)
  const [geofences, setGeofences] = useState([])
  const [idleTouched, setIdleTouched] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    const initial = {
      fuel_avg_running: device.fuel_avg_running != null ? String(device.fuel_avg_running) : '',
      fuel_avg_idle: device.fuel_avg_idle != null ? String(device.fuel_avg_idle) : '',
      primary_geofence_id: toFormValue(device.primary_geofence_id),
      speed_limit_kmh: device.speed_limit_kmh != null ? String(device.speed_limit_kmh) : '',
      harsh_brake_delta_kmh: device.harsh_brake_delta_kmh != null ? String(device.harsh_brake_delta_kmh) : '',
      harsh_accel_delta_kmh: device.harsh_accel_delta_kmh != null ? String(device.harsh_accel_delta_kmh) : '',
    }
    setForm(initial)
    setOriginal(initial)
    // Re-init only when we're looking at a different device, not on every
    // background poll refresh in the parent (which creates a new `device`
    // object every 10s and would otherwise wipe in-progress edits).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [device.id])

  useEffect(() => {
    const fetchGeofences = async () => {
      try {
        const res = await api.get(apiFor('/geofences', '/api/geofences'))
        setGeofences(res.data)
      } catch (err) {
        console.error('Failed to fetch geofences:', err)
      }
    }
    fetchGeofences()
  }, [apiFor])

  const geofenceOptions = useMemo(() => {
    const list = [...geofences]
    const currentId = form.primary_geofence_id
    if (currentId && !list.some((g) => String(g.id) === String(currentId))) {
      list.unshift({
        id: Number(currentId),
        name: device.primary_geofence_name || `Geofence #${currentId}`,
      })
    }
    return list
  }, [geofences, form.primary_geofence_id, device.primary_geofence_name])

  const handleChange = (e) => {
    const { name, value } = e.target
    setForm((prev) => ({ ...prev, [name]: value }))
    if (name === 'fuel_avg_idle') setIdleTouched(true)
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!original) return
    setSaving(true)
    setError(null)

    const payload = {}
    if (form.fuel_avg_running !== original.fuel_avg_running) {
      payload.fuel_avg_running = form.fuel_avg_running === '' ? null : parseFloat(form.fuel_avg_running)
    }
    if (idleTouched && form.fuel_avg_idle !== original.fuel_avg_idle) {
      payload.fuel_avg_idle = form.fuel_avg_idle === '' ? null : parseFloat(form.fuel_avg_idle)
    }
    if (form.primary_geofence_id !== original.primary_geofence_id) {
      payload.primary_geofence_id = form.primary_geofence_id === '' ? null : Number(form.primary_geofence_id)
    }
    if (form.speed_limit_kmh !== original.speed_limit_kmh) {
      payload.speed_limit_kmh = form.speed_limit_kmh === '' ? null : parseFloat(form.speed_limit_kmh)
    }
    if (form.harsh_brake_delta_kmh !== original.harsh_brake_delta_kmh) {
      payload.harsh_brake_delta_kmh = form.harsh_brake_delta_kmh === '' ? null : parseFloat(form.harsh_brake_delta_kmh)
    }
    if (form.harsh_accel_delta_kmh !== original.harsh_accel_delta_kmh) {
      payload.harsh_accel_delta_kmh = form.harsh_accel_delta_kmh === '' ? null : parseFloat(form.harsh_accel_delta_kmh)
    }

    if (Object.keys(payload).length === 0) {
      onClose()
      return
    }

    try {
      await api.patch(apiFor(`/vehicles/${deviceId}`, `/api/fleet/devices/${deviceId}`), payload)
      onSaved()
      onClose()
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to save parameters')
    } finally {
      setSaving(false)
    }
  }

  return createPortal(
    <div style={styles.backdrop} onClick={onClose}>
      <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div style={styles.modalBody}>
        <div style={styles.header}>
          <h2 style={styles.title}>Set Parameters</h2>
          <button type="button" style={styles.closeBtn} onClick={onClose}>
            <X size={18} color={colors.textMuted} />
          </button>
        </div>
        <p style={styles.subtitle}>Customize driving limits and fuel settings for this vehicle.</p>

        {error && <div style={styles.error}>{error}</div>}

        <form onSubmit={handleSubmit}>
          <div style={styles.sectionLabel}>
            <Gauge size={14} color={colors.accent} />
            Driving limits
          </div>

          <div style={styles.fieldGroup}>
            <label style={styles.label}>Speed limit (km/h)</label>
            <input
              type="number"
              step="1"
              min="0"
              name="speed_limit_kmh"
              placeholder="Fleet default (80 km/h)"
              value={form.speed_limit_kmh}
              onChange={handleChange}
              style={styles.input}
            />
          </div>

          <div style={styles.fieldRow}>
            <div style={styles.fieldGroup}>
              <label style={styles.label}>Harsh brake sensitivity (km/h)</label>
              <input
                type="number"
                step="1"
                min="0"
                name="harsh_brake_delta_kmh"
                placeholder="Default (15 km/h)"
                value={form.harsh_brake_delta_kmh}
                onChange={handleChange}
                style={styles.input}
              />
            </div>
            <div style={styles.fieldGroup}>
              <label style={styles.label}>Harsh accel sensitivity (km/h)</label>
              <input
                type="number"
                step="1"
                min="0"
                name="harsh_accel_delta_kmh"
                placeholder="Default (15 km/h)"
                value={form.harsh_accel_delta_kmh}
                onChange={handleChange}
                style={styles.input}
              />
            </div>
          </div>
          <div style={styles.hint}>
            <AlertTriangle size={12} color={colors.textFaint} />
            Lower sensitivity flags gentler speed changes as harsh braking/acceleration. Leave blank to use the fleet default.
          </div>

          <div style={{ ...styles.sectionLabel, marginTop: 20 }}>
            <Fuel size={14} color={colors.accent} />
            Fuel averages
          </div>

          <div style={styles.fieldRow}>
            <div style={styles.fieldGroup}>
              <label style={styles.label}>Running (km/L)</label>
              <input
                type="number"
                step="0.1"
                min="0"
                name="fuel_avg_running"
                value={form.fuel_avg_running}
                onChange={handleChange}
                style={styles.input}
              />
            </div>
            <div style={styles.fieldGroup}>
              <label style={styles.label}>Idle (L/hr)</label>
              <input
                type="number"
                step="0.1"
                min="0"
                name="fuel_avg_idle"
                value={form.fuel_avg_idle}
                onChange={handleChange}
                style={styles.input}
              />
            </div>
          </div>

          <div style={{ ...styles.sectionLabel, marginTop: 20 }}>
            <MapPinned size={14} color={colors.accent} />
            Geofence
          </div>

          <div style={styles.fieldGroup}>
            <label style={styles.label}>Primary geofence</label>
            <select
              name="primary_geofence_id"
              value={form.primary_geofence_id}
              onChange={handleChange}
              style={styles.input}
            >
              <option value="">None</option>
              {geofenceOptions.map((g) => (
                <option key={g.id} value={g.id}>{g.name}</option>
              ))}
            </select>
          </div>

          <div style={styles.actions}>
            <button type="button" onClick={onClose} style={styles.cancelBtn} disabled={saving}>
              Cancel
            </button>
            <button type="submit" style={styles.saveBtn} disabled={saving}>
              {saving ? 'Saving...' : 'Save Parameters'}
            </button>
          </div>
        </form>
        </div>
      </div>
    </div>,
    document.body,
  )
}

const styles = {
  backdrop: {
    position: 'fixed',
    inset: 0,
    background: 'rgba(17, 24, 39, 0.5)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 2000,
    padding: 20,
  },
  modal: {
    background: colors.surface,
    borderRadius: radius.lg,
    boxShadow: shadow.card,
    width: '100%',
    maxWidth: 460,
    maxHeight: '82vh',
    overflow: 'hidden',
    display: 'flex',
    flexDirection: 'column',
  },
  modalBody: {
    overflowY: 'auto',
    overflowX: 'hidden',
    padding: 20,
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  title: {
    fontSize: 18,
    fontWeight: 700,
    color: colors.text,
    margin: 0,
  },
  closeBtn: {
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    display: 'inline-flex',
    padding: 4,
    borderRadius: 6,
  },
  subtitle: {
    fontSize: 13,
    color: colors.textMuted,
    marginTop: 4,
    marginBottom: 20,
  },
  sectionLabel: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    fontSize: 12,
    fontWeight: 700,
    color: colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.3,
    marginBottom: 10,
  },
  fieldGroup: {
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
    marginBottom: 14,
    flex: 1,
    minWidth: 0,
  },
  fieldRow: {
    display: 'flex',
    gap: 12,
    minWidth: 0,
  },
  label: {
    fontSize: 12,
    fontWeight: 600,
    color: colors.text,
    lineHeight: 1.35,
  },
  input: {
    width: '100%',
    boxSizing: 'border-box',
    padding: '9px 12px',
    borderRadius: radius.sm,
    border: `1px solid ${colors.border}`,
    fontSize: 14,
    color: colors.text,
    background: colors.surface,
    fontFamily: 'inherit',
  },
  hint: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: 6,
    fontSize: 11,
    color: colors.textFaint,
    marginTop: -6,
    marginBottom: 4,
    lineHeight: 1.4,
  },
  error: {
    background: colors.criticalSoft,
    color: colors.critical,
    padding: '8px 12px',
    borderRadius: radius.sm,
    fontSize: 13,
    marginBottom: 16,
  },
  actions: {
    display: 'flex',
    justifyContent: 'flex-end',
    gap: 10,
    marginTop: 22,
    paddingTop: 16,
    borderTop: `1px solid ${colors.border}`,
  },
  cancelBtn: {
    padding: '9px 16px',
    borderRadius: radius.sm,
    border: `1px solid ${colors.border}`,
    background: colors.surface,
    color: colors.textMuted,
    fontSize: 13,
    fontWeight: 600,
    cursor: 'pointer',
  },
  saveBtn: {
    padding: '9px 18px',
    borderRadius: radius.sm,
    border: 'none',
    background: colors.accent,
    color: '#fff',
    fontSize: 13,
    fontWeight: 700,
    cursor: 'pointer',
  },
}

export default SetParametersModal