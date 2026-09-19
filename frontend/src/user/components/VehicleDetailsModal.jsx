import { X, Gauge, Truck, Fuel, MapPinned, User } from 'lucide-react'
import { colors } from '../theme'
import { StatusBadge } from './ui'

const Field = ({ label, value }) => (
  <div style={styles.field}>
    <span style={styles.fieldLabel}>{label}</span>
    <span style={styles.fieldValue}>{value ?? '—'}</span>
  </div>
)

// report: the /api/vehicle-report/{deviceId} response — { device, report, current_driver }
const VehicleDetailsModal = ({ report, status, onClose }) => {
  if (!report) return null
  const { device, report: metrics, current_driver } = report

  return (
    <div style={styles.overlay} onClick={onClose}>
      <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div style={styles.header}>
          <h3 style={styles.title}>{device.name}</h3>
          <button style={styles.closeBtn} onClick={onClose}><X size={18} /></button>
        </div>

        <div style={styles.statusRow}>
          <StatusBadge status={status} />
        </div>

        <div style={styles.fieldGrid}>
          <Field label="Plate number" value={device.plate_number} />
          <Field label="Vehicle type" value={device.vehicle_type} />
          <Field label="Fuel type" value={device.fuel_type_name} />
          <Field label="Last seen" value={device.last_seen_at ? new Date(device.last_seen_at).toLocaleString() : null} />
        </div>

        <div style={styles.statsList}>
          <div style={styles.statRow}>
            <Truck size={16} color={colors.accent} />
            <span style={styles.statLabel}>Distance today</span>
            <span style={styles.statValue}>
              {metrics ? `${metrics.db_total_distance} km` : '—'}
            </span>
          </div>
          <div style={styles.statRow}>
            <Fuel size={16} color={colors.accent} />
            <span style={styles.statLabel}>Fuel used</span>
            <span style={styles.statValue}>
              {metrics?.db_total_fuel_liters != null ? `${metrics.db_total_fuel_liters} L` : (metrics?.fuel_message || '—')}
            </span>
          </div>
          <div style={styles.statRow}>
            <MapPinned size={16} color={colors.accent} />
            <span style={styles.statLabel}>Fuel cost</span>
            <span style={styles.statValue}>
              {metrics?.db_total_fuel_cost_pkr != null ? `PKR ${metrics.db_total_fuel_cost_pkr}` : (metrics?.price_message || '—')}
            </span>
          </div>
          <div style={styles.statRow}>
            <User size={16} color={colors.accent} />
            <span style={styles.statLabel}>Driver</span>
            <span style={styles.statValue}>{current_driver?.name || 'Not assigned'}</span>
          </div>
          <div style={styles.statRow}>
            <Gauge size={16} color={colors.accent} />
            <span style={styles.statLabel}>Geofence</span>
            <span style={styles.statValue}>{device.primary_geofence_name || '—'}</span>
          </div>
        </div>
      </div>
    </div>
  )
}

const styles = {
  overlay: {
    position: 'fixed',
    inset: 0,
    background: 'rgba(17,24,39,0.5)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 2000,
  },
  modal: {
    background: colors.surface,
    borderRadius: 16,
    padding: 22,
    width: 440,
    maxWidth: '90vw',
    maxHeight: '85vh',
    overflowY: 'auto',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  title: {
    fontSize: 17,
    fontWeight: 700,
    color: colors.text,
    margin: 0,
  },
  closeBtn: {
    border: 'none',
    background: 'none',
    cursor: 'pointer',
    color: colors.textMuted,
  },
  statusRow: {
    marginBottom: 16,
  },
  fieldGrid: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: 14,
    marginBottom: 18,
    paddingBottom: 18,
    borderBottom: `1px solid ${colors.border}`,
  },
  field: {
    display: 'flex',
    flexDirection: 'column',
    gap: 3,
  },
  fieldLabel: {
    fontSize: 11,
    color: colors.textMuted,
    fontWeight: 600,
    textTransform: 'uppercase',
    letterSpacing: 0.3,
  },
  fieldValue: {
    fontSize: 14,
    color: colors.text,
    fontWeight: 600,
  },
  statsList: {
    display: 'flex',
    flexDirection: 'column',
    gap: 14,
  },
  statRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
  },
  statLabel: {
    fontSize: 13,
    color: colors.textMuted,
    flex: 1,
  },
  statValue: {
    fontSize: 13,
    fontWeight: 700,
    color: colors.text,
  },
}

export default VehicleDetailsModal
