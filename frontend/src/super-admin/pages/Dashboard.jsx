import { Link } from 'react-router-dom'
import { PageHeader, Card } from '../../shared/components'
import '../../admin/styles/admin-settings.css'

const links = [
  { to: '/super-admin/admins', title: 'Fleet admins', description: 'Create and manage fleet administrator accounts.' },
  { to: '/super-admin/unassigned', title: 'Unassigned users', description: 'Users and devices not tied to any fleet admin.' },
  { to: '/super-admin/enter-fleet', title: 'Enter fleet', description: 'Act as a fleet admin to manage their portal.' },
]

const Dashboard = () => (
  <div className="ft-page-stack">
    <PageHeader
      title="Super Admin"
      subtitle="Manage fleet admins, unassigned assets, and enter a fleet when needed."
    />
    <div className="ft-admin-settings-grid">
      {links.map((item) => (
        <Card key={item.to} title={item.title}>
          <p style={{ marginTop: 0, marginBottom: 12, color: 'var(--ft-text-muted)', fontSize: 14 }}>
            {item.description}
          </p>
          <Link to={item.to} className="ft-link-button">
            Open
          </Link>
        </Card>
      ))}
    </div>
  </div>
)

export default Dashboard
