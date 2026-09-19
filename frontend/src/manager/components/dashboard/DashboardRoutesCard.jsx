import { useNavigate } from 'react-router-dom'
import { Plus, Route as RouteIcon, MoreVertical } from 'lucide-react'
import { useTheme } from '../../../theme'
import { hexToRgba } from '../../../shared/utils'
import {
  Card,
  Button,
  Table,
  TableRow,
  Badge,
  Dropdown,
  DropdownItem,
  IconButton,
  EmptyState,
} from '../../../shared/components'
import { usePanelScope } from '../../hooks/usePanelScope'

const DashboardRoutesCard = ({ routes, canRoutes, loading = false }) => {
  const { tokens } = useTheme()
  const navigate = useNavigate()
  const { basePath, can } = usePanelScope()

  return (
    <Card
      badge={7}
      title="Routes"
      right={can('route_management') ? (
        <Button variant="secondary" size="sm" onClick={() => navigate(`${basePath}/routes`)}>
          <Plus size={14} />
          Add Route
        </Button>
      ) : null}
    >
      {!canRoutes ? (
        <EmptyState title="Not permitted" description="Route management access is required." />
      ) : loading || routes.length > 0 ? (
        <Table
          loading={loading}
          columns={[
            { key: 'name', label: 'Route Name' },
            { key: 'vehicles', label: 'Assigned Vehicles', align: 'right' },
            { key: 'distance', label: 'Total Distance' },
            { key: 'compliance', label: 'Compliance %' },
            { key: 'status', label: 'Status' },
            { key: 'actions', label: '' },
          ]}
        >
          {routes.slice(0, 6).map((route, idx) => (
            <TableRow key={route.id ?? `route-${route.name}-${idx}`}>
              <td>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                  <RouteIcon size={14} color={tokens.primary} />
                  <span style={{ fontWeight: 600 }}>{route.name}</span>
                </span>
              </td>
              <td style={{ textAlign: 'right' }}>{route.vehicle_count ?? 0}</td>
              <td title="Total distance is not returned by the routes list API">—</td>
              <td title="Compliance % is not returned by the routes list API">—</td>
              <td>
                <Badge
                  color={tokens.semantic.success}
                  background={hexToRgba(tokens.semantic.success, 0.14)}
                  pill
                >
                  Active
                </Badge>
              </td>
              <td>
                <Dropdown
                  align="right"
                  trigger={(
                    <IconButton label="Route actions" size="sm">
                      <MoreVertical size={14} />
                    </IconButton>
                  )}
                >
                  <DropdownItem onClick={() => navigate(`${basePath}/routes`)}>
                    Open in Routes
                  </DropdownItem>
                </Dropdown>
              </td>
            </TableRow>
          ))}
        </Table>
      ) : (
        <EmptyState title="No routes" description="Create a route to see it here." />
      )}
    </Card>
  )
}

export default DashboardRoutesCard
