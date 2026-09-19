import AdminAlertsFeed from './AdminAlertsFeed'
import { MobilePageHeading } from '../../shared/shell'
import { adminNavLabel } from '../navItems'
import '../styles/admin-notifications.css'

const AdminNotificationsPage = () => (
  <div className="ft-page-stack ft-admin-notifications-page">
    <MobilePageHeading>{adminNavLabel('/admin/notifications')}</MobilePageHeading>
    <AdminAlertsFeed />
  </div>
)

export default AdminNotificationsPage
