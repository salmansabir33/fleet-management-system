import { colors } from '../../user/theme'
import { Card } from '../../user/components/ui'

// Keeps every admin sidebar link real (no 404s) while each page gets
// built out one at a time, per the project plan.
const AdminPlaceholder = ({ title }) => (
  <div>
    <h1 style={styles.title}>{title}</h1>
    <Card>
      <p style={styles.text}>{title} — coming soon.</p>
    </Card>
  </div>
)

const styles = {
  title: {
    fontSize: 22,
    fontWeight: 700,
    color: colors.text,
    margin: '0 0 20px',
  },
  text: {
    color: colors.textMuted,
    fontSize: 14,
    margin: 0,
  },
}

export default AdminPlaceholder