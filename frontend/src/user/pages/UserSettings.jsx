import {
  PageHeader,
  Card,
  SectionHeader,
} from '../../shared/components'
import { useCurrentUser } from '../context/CurrentUserContext'
import UserNotificationSettings from '../components/UserNotificationSettings'
import '../../admin/styles/admin-settings.css'

const UserSettings = () => {
  const { user } = useCurrentUser()

  return (
    <div className="ft-page-stack">
      <PageHeader
        title="Settings"
        subtitle="Control which alerts you receive for your vehicle"
      />

      <Card>
        <SectionHeader
          title="Vehicle Notifications"
          subtitle="Turn alerts on or off for your assigned vehicle"
        />
        <UserNotificationSettings userId={user?.id} />
      </Card>
    </div>
  )
}

export default UserSettings
