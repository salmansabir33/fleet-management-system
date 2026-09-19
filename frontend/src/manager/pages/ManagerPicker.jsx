import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Building2, Car, Users } from 'lucide-react'
import api from '../../api'
import { useTheme } from '../../theme'
import {
  PageHeader,
  Card,
  Button,
  Badge,
  LoadingState,
  EmptyState,
  Avatar,
  SearchInput,
  FilterBar,
} from '../../shared/components'
import { ShellBrand } from '../../shared/shell'
import { hexToRgba } from '../../shared/utils'

const LAST_WORKSPACE_KEY = 'ft.manager.lastWorkspaceId'

const FILTER_OPTIONS = [
  { key: 'all', label: 'All' },
  { key: 'active', label: 'Recent' },
]

const ManagerPicker = () => {
  const navigate = useNavigate()
  const { tokens } = useTheme()
  const [managers, setManagers] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState('all')
  const [lastId, setLastId] = useState(() => {
    try {
      return localStorage.getItem(LAST_WORKSPACE_KEY)
    } catch {
      return null
    }
  })

  useEffect(() => {
    const load = async () => {
      try {
        const res = await api.get('/api/managers')
        setManagers(res.data || [])
      } catch (err) {
        console.error('Failed to load managers:', err)
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  const selectManager = (managerId) => {
    try {
      localStorage.setItem(LAST_WORKSPACE_KEY, String(managerId))
    } catch {
      // ignore quota / private mode
    }
    setLastId(String(managerId))
    navigate(`/manager/${managerId}/dashboard`)
  }

  useEffect(() => {
    try {
      localStorage.setItem('ft.manager.lastLoginAt', new Date().toISOString())
    } catch {
      // ignore
    }
  }, [])

  const filteredManagers = useMemo(() => {
    let rows = managers
    if (filter === 'active' && lastId) {
      rows = rows.filter((m) => String(m.id) === String(lastId))
      if (rows.length === 0) rows = managers.slice(0, 3)
    }
    const q = search.trim().toLowerCase()
    if (!q) return rows
    return rows.filter((m) => {
      const name = (m.full_name || m.username || '').toLowerCase()
      return name.includes(q)
    })
  }, [managers, search, filter, lastId])

  return (
    <div
      style={{
        minHeight: '100vh',
        background: tokens.background,
        padding: '28px 24px 40px',
      }}
    >
      <div style={{ maxWidth: 960, margin: '0 auto' }}>
        <div style={{ marginBottom: 24 }}>
          <ShellBrand portalLabel="Manager Portal" expanded />
        </div>

        <PageHeader
          title="Manager Picker"
          subtitle="Choose a workspace, then select vehicles and users inside the portal."
        />

        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            gap: 12,
            marginBottom: 16,
          }}
        >
          <SearchInput
            placeholder="Search workspaces…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ flex: '1 1 220px', maxWidth: 360 }}
          />
          <FilterBar
            options={FILTER_OPTIONS}
            value={filter}
            onChange={setFilter}
          />
        </div>

        {loading ? (
          <Card>
            <LoadingState label="Loading workspaces…" />
          </Card>
        ) : filteredManagers.length === 0 ? (
          <Card>
            <EmptyState
              title="No workspaces found"
              description={managers.length === 0
                ? 'Promote a user from the Admin panel first.'
                : 'Try a different search or filter.'}
            />
          </Card>
        ) : (
          <div
            className="ft-picker-grid"
          >
            {filteredManagers.map((m) => {
              const isActive = lastId != null && String(m.id) === String(lastId)
              const name = m.full_name || m.username
              const vehicleCount = m.total_vehicle_count ?? 0
              const userCount = m.assigned_user_count ?? 0

              return (
                <Card
                  key={m.id}
                  interactive
                  className="ft-quick-tile"
                  onClick={() => selectManager(m.id)}
                  style={{
                    padding: 16,
                    borderColor: isActive ? tokens.primary : undefined,
                    boxShadow: isActive
                      ? `0 0 0 1px ${tokens.primary}, var(--ft-shadow-card)`
                      : undefined,
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: 14 }}>
                    <Avatar name={name} size="lg" />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div
                        style={{
                          fontSize: 15,
                          fontWeight: 700,
                          color: tokens.text,
                          marginBottom: 4,
                        }}
                      >
                        {name}
                      </div>
                      <div style={{ fontSize: 12, color: tokens.textMuted }}>
                        Fleet workspace
                      </div>
                      {isActive && (
                        <Badge
                          color={tokens.semantic.success}
                          background={hexToRgba(tokens.semantic.success, 0.14)}
                          style={{ marginTop: 6 }}
                        >
                          Active
                        </Badge>
                      )}
                    </div>
                  </div>

                  <div
                    style={{
                      display: 'flex',
                      flexWrap: 'wrap',
                      gap: 12,
                      fontSize: 12,
                      color: tokens.textMuted,
                      marginBottom: 14,
                    }}
                  >
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                      <Car size={12} />
                      {vehicleCount} Vehicles
                    </span>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                      <Users size={12} />
                      {userCount} Users
                    </span>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                      <Building2 size={12} />
                      Workspace
                    </span>
                  </div>

                  <Button
                    variant={isActive ? 'primary' : 'secondary'}
                    size="sm"
                    style={{ width: '100%' }}
                    onClick={(e) => {
                      e.stopPropagation()
                      selectManager(m.id)
                    }}
                  >
                    Select
                  </Button>
                </Card>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

export default ManagerPicker
