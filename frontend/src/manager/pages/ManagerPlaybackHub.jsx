import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { PlayCircle } from 'lucide-react'
import api from '../../api'
import { useTheme } from '../../theme'
import { hexToRgba } from '../../shared/utils'
import {
  Card,
  Button,
  Badge,
  StatusBadge,
  LoadingState,
  EmptyState,
  SearchInput,
  FilterBar,
} from '../../shared/components'
import { MobilePageHeading } from '../../shared/shell'
import { adminNavLabel } from '../../admin/navItems'
import VehicleHeroArt from '../../user/components/VehicleHeroArt'
import { deriveVehicleStatus } from '../../user/utils/vehicleStatus'
import { vehiclePhotoSrc } from '../../user/utils/vehiclePhoto'
import { usePanelScope } from '../hooks/usePanelScope'

const OWNER_FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'admin', label: 'Admin' },
  { key: 'user', label: 'User' },
]

const ManagerPlaybackHub = () => {
  const navigate = useNavigate()
  const { tokens } = useTheme()
  const { apiFor, basePath, can, isManager } = usePanelScope()
  const [live, setLive] = useState([])
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')
  const [ownerFilter, setOwnerFilter] = useState('all')

  useEffect(() => {
    if (!can('live_tracking')) {
      setLoading(false)
      return
    }
    let cancelled = false
    api.get(apiFor('/vehicles', '/api/live'))
      .then((res) => {
        if (!cancelled) setLive(res.data.live || [])
      })
      .catch((err) => console.error('Failed to load vehicles:', err))
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [apiFor, can])

  const mapped = useMemo(() => (
    live
      .filter((item) => item.db_id != null)
      .map((item) => ({
        id: item.db_id,
        name: item.device?.name || 'Vehicle',
        plate: item.plate_number,
        vehicleType: item.vehicle_type,
        pic: vehiclePhotoSrc(item),
        status: deriveVehicleStatus(item),
        ownerKind: item.owner ? 'user' : 'admin',
        ownerName: item.owner?.full_name || item.owner?.username || null,
      }))
  ), [live])

  const ownerCounts = useMemo(() => ({
    all: mapped.length,
    admin: mapped.filter((row) => row.ownerKind === 'admin').length,
    user: mapped.filter((row) => row.ownerKind === 'user').length,
  }), [mapped])

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase()
    return mapped.filter((row) => {
      if (!isManager && ownerFilter !== 'all' && row.ownerKind !== ownerFilter) return false
      if (!q) return true
      return `${row.name} ${row.plate || ''} ${row.ownerName || ''}`.toLowerCase().includes(q)
    })
  }, [mapped, query, ownerFilter, isManager])

  if (!can('live_tracking')) {
    return <EmptyState title="You don't have permission to replay trips." />
  }

  return (
    <div className="ft-page-stack">
      <MobilePageHeading>{adminNavLabel('/admin/playback')}</MobilePageHeading>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 12 }}>
        <SearchInput
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search vehicles…"
          style={{ maxWidth: 320 }}
        />
        {!isManager && (
          <FilterBar
            options={OWNER_FILTERS.map((opt) => ({ ...opt, count: ownerCounts[opt.key] }))}
            value={ownerFilter}
            onChange={setOwnerFilter}
          />
        )}
      </div>
      {loading ? (
        <Card><LoadingState label="Loading vehicles…" /></Card>
      ) : rows.length === 0 ? (
        <Card><EmptyState title="No vehicles available for playback." /></Card>
      ) : (
        <div className="ft-picker-grid">
          {rows.map((row) => (
            <Card key={row.id} style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 12 }}>
              <VehicleHeroArt vehicleType={row.vehicleType} size="card" src={row.pic} />
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                <div>
                  <div style={{ fontWeight: 700, color: tokens.text }}>{row.name}</div>
                  {!isManager && row.plate && (
                    <div style={{ marginTop: 2, fontSize: 12, color: tokens.textMuted }}>{row.plate}</div>
                  )}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
                    <StatusBadge status={row.status} connection />
                    {!isManager && (
                      <Badge
                        pill
                        color={row.ownerKind === 'admin' ? tokens.primary : tokens.semantic.info}
                        background={hexToRgba(
                          row.ownerKind === 'admin' ? tokens.primary : tokens.semantic.info,
                          0.14,
                        )}
                      >
                        {row.ownerKind === 'admin' ? 'Admin' : 'User'}
                      </Badge>
                    )}
                  </div>
                  {!isManager && row.ownerKind === 'user' && row.ownerName && (
                    <div style={{ marginTop: 4, fontSize: 11, color: tokens.textMuted }}>
                      {row.ownerName}
                    </div>
                  )}
                </div>
                <Button size="sm" onClick={() => navigate(`${basePath}/playback/${row.id}`)}>
                  <PlayCircle size={15} />
                  Replay
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}

export default ManagerPlaybackHub
