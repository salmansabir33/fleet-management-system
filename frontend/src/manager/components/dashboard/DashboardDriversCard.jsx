import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Plus } from 'lucide-react'
import { useTheme } from '../../../theme'
import { hexToRgba } from '../../../shared/utils'
import {
  Card,
  Button,
  SearchInput,
  Table,
  TableRow,
  Badge,
  Avatar,
  EmptyState,
} from '../../../shared/components'
import { usePanelScope } from '../../hooks/usePanelScope'
import { timeAgo } from '../../utils/dashboardFormatters'

const DriverStatusBadge = ({ status, tokens }) => {
  let color = tokens.textMuted
  if (status === 'active') color = tokens.semantic.success
  else if (status === 'on_leave') color = tokens.semantic.warning
  return (
    <Badge color={color} background={hexToRgba(color, 0.14)} pill>
      {(status || 'unknown').replace('_', ' ')}
    </Badge>
  )
}

const DashboardDriversCard = ({ drivers, canDrivers, loading = false }) => {
  const { tokens } = useTheme()
  const navigate = useNavigate()
  const { basePath, can } = usePanelScope()
  const [search, setSearch] = useState('')

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return drivers
    return drivers.filter((d) => (
      (d.name || '').toLowerCase().includes(q)
      || (d.phone_number || '').toLowerCase().includes(q)
    ))
  }, [drivers, search])

  return (
    <Card
      badge={5}
      title="Drivers"
      right={can('driver_management') ? (
        <Button variant="secondary" size="sm" onClick={() => navigate(`${basePath}/drivers`)}>
          <Plus size={14} />
          Add Driver
        </Button>
      ) : null}
    >
      <SearchInput
        placeholder="Search drivers…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        style={{ marginBottom: 12 }}
      />

      {!canDrivers ? (
        <EmptyState title="Not permitted" description="Driver management access is required." />
      ) : loading || filtered.length > 0 ? (
        <Table
          loading={loading}
          columns={[
            { key: 'driver', label: 'Driver' },
            { key: 'phone', label: 'Phone' },
            { key: 'vehicles', label: 'Assigned Vehicles' },
            { key: 'status', label: 'Status' },
            { key: 'active', label: 'Last Active' },
          ]}
        >
          {filtered.slice(0, 6).map((d, idx) => (
            <TableRow key={d.id ?? `driver-${d.phone_number}-${idx}`}>
              <td>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                  <Avatar name={d.name} size="sm" />
                  <span style={{ fontWeight: 600 }}>{d.name}</span>
                </span>
              </td>
              <td>{d.phone_number || '—'}</td>
              <td>{d.current_device_id ? 1 : 0}</td>
              <td><DriverStatusBadge status={d.status} tokens={tokens} /></td>
              <td>{d.assigned_since ? timeAgo(d.assigned_since) : '—'}</td>
            </TableRow>
          ))}
        </Table>
      ) : (
        <EmptyState title="No drivers" description="No drivers in your workspace scope." />
      )}
    </Card>
  )
}

export default DashboardDriversCard
