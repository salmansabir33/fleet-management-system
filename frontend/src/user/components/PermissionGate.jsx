import { ShieldOff } from 'lucide-react'
import { EmptyState, LoadingState, Card } from '../../shared/components'
import { useCurrentUser } from '../context/CurrentUserContext'

const PermissionGate = ({ requires, children }) => {
  const { can, loading, user } = useCurrentUser()

  if (loading) {
    return (
      <Card>
        <LoadingState label="Loading…" />
      </Card>
    )
  }

  if (!user) {
    return (
      <Card>
        <EmptyState
          title="Select a user"
          description="Pick a vehicle owner in the user portal to continue."
        />
      </Card>
    )
  }

  if (requires && !can(requires)) {
    return (
      <Card>
        <EmptyState
          icon={ShieldOff}
          title="You don't have permission to view this."
          description="Ask your administrator to grant access for this section."
        />
      </Card>
    )
  }

  return children
}

export default PermissionGate
