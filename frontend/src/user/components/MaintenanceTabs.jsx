import { Link } from 'react-router-dom'
import { colors, radius } from '../theme'

// Shared Entry/Report sub-nav for the Maintenance section — rendered by
// both Maintenance.jsx (Entry) and MaintenanceReport.jsx (Report) so the
// two pages read as one section with two views, not two separate pages.
const MaintenanceTabs = ({ active }) => (
  <div style={styles.wrap}>
    <Link
      to="/user/maintenance"
      style={{ ...styles.tab, ...(active === 'entry' ? styles.tabActive : {}) }}
    >
      Entry
    </Link>
    <Link
      to="/user/maintenance/report"
      style={{ ...styles.tab, ...(active === 'report' ? styles.tabActive : {}) }}
    >
      Report
    </Link>
  </div>
)

const styles = {
  wrap: {
    display: 'inline-flex',
    gap: 4,
    padding: 4,
    borderRadius: radius.md,
    background: colors.bg,
    border: `1px solid ${colors.border}`,
    marginBottom: 20,
  },
  tab: {
    padding: '7px 18px',
    borderRadius: radius.sm,
    fontSize: 13,
    fontWeight: 600,
    color: colors.textMuted,
    textDecoration: 'none',
  },
  tabActive: {
    background: colors.surface,
    color: colors.accent,
    boxShadow: '0 1px 2px rgba(16,24,40,0.08)',
  },
}

export default MaintenanceTabs
