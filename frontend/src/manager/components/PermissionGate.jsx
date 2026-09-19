import { ShieldOff } from 'lucide-react'
import { usePanelScope } from '../hooks/usePanelScope'
import { EmptyState, LoadingState, Card } from '../../shared/components'

// Wraps a manager-scoped page so a direct URL to a section the manager
// lacks permission for shows a clear denied state instead of fetching
// and 403ing. Admin routes never mount this (can() is always true
// outside manager scope anyway).
const PermissionGate = ({ requires, children }) => {
  const { can, loading } = usePanelScope()

  if (loading) {
    return (
      <Card>
        <LoadingState label="Loading…" />
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
