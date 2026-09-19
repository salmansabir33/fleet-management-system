import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Filter, MoreVertical, Search } from 'lucide-react'
import api from '../../api'
import {
  Button,
  LoadingState,
  EmptyState,
  Avatar,
  Dropdown,
  DropdownItem,
  IconButton,
  Card,
} from '../../shared/components'
import VehicleHeroArt from '../../user/components/VehicleHeroArt'
import {
  deriveVehicleStatus,
  isVehicleOnline,
  matchesVehicleStatusFilter,
  VEHICLE_STATUS_FILTERS,
} from '../../user/utils/vehicleStatus'
import { usePanelScope } from '../hooks/usePanelScope'
import { userPicSrc } from '../../admin/utils/userPic'
import { vehiclePhotoSrc } from '../../user/utils/vehiclePhoto'
import '../styles/manager-users.css'

const STATUS_FILTERS = VEHICLE_STATUS_FILTERS.map((opt) => (
  opt.key === 'all' ? { ...opt, label: 'All statuses' } : opt
))

const ManagerAssetPicker = () => {
  const navigate = useNavigate()
  const { apiFor, basePath, can } = usePanelScope()
  const [live, setLive] = useState([])
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')

  useEffect(() => {
    if (!can('live_tracking')) {
      setLoading(false)
      return
    }
    let cancelled = false
    const load = async () => {
      try {
        const res = await api.get(apiFor('/vehicles', '/api/live'))
        if (!cancelled) setLive(res.data.live || [])
      } catch (err) {
        console.error('Failed to load vehicles:', err)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [apiFor, can])

  const rows = useMemo(() => live
    .filter((item) => item.db_id != null)
    .map((item) => {
      const ownerName = item.owner?.full_name || item.owner?.username
      const driverName = item.active_driver?.name
      const vehicleName = item.device?.name || 'Vehicle'
      const assignedName = ownerName || driverName || vehicleName
      const status = deriveVehicleStatus(item)
      return {
        id: item.db_id,
        name: vehicleName,
        assignedName,
        plate: item.plate_number,
        vehicleType: item.vehicle_type,
        driver: driverName,
        ownerId: item.owner?.id,
        ownerPic: userPicSrc(item.owner?.pic_url),
        driverPic: userPicSrc(item.active_driver?.pic_url),
        pic: vehiclePhotoSrc(item),
        status,
        online: isVehicleOnline(status),
      }
    }), [live])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return rows.filter((row) => {
      if (!matchesVehicleStatusFilter(row.status, statusFilter)) return false
      if (!q) return true
      const hay = `${row.name} ${row.assignedName} ${row.plate || ''} ${row.driver || ''}`.toLowerCase()
      return hay.includes(q)
    })
  }, [rows, query, statusFilter])

  const selectVehicle = (id) => navigate(`${basePath}/vehicles/${id}`)
  const openUser = (ownerId) => navigate(`${basePath}/users/${ownerId}`)
  const canOpenUser = (row) => row.ownerId != null && can('user_management')
  const selectUser = (row) => {
    if (!canOpenUser(row)) return
    openUser(row.ownerId)
  }
  const activeFilter = STATUS_FILTERS.find((opt) => opt.key === statusFilter) || STATUS_FILTERS[0]

  if (!can('live_tracking')) {
    return <EmptyState title="You don't have permission to view vehicles." />
  }

  return (
    <div className="ft-page-stack mu-users-page">
      <div className="mu-users-heading">
        <p className="mu-users-kicker">Assigned Users</p>
      </div>

      <div className="mu-users-toolbar">
        <div className="mu-users-search ft-search">
          <Search size={16} color="var(--ft-text-disabled)" aria-hidden />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter"
            aria-label="Filter assigned users"
          />
          <Dropdown
            align="right"
            className="mu-users-filter-mobile"
            trigger={(
              <button
                type="button"
                className={[
                  'mu-users-filter-icon-btn',
                  statusFilter !== 'all' ? 'mu-users-filter-icon-btn--active' : '',
                ].filter(Boolean).join(' ')}
                aria-label={`Status filter: ${activeFilter.label}`}
              >
                <Filter size={16} />
              </button>
            )}
          >
            {(close) => (
              <div className="mu-users-filter-menu">
                {STATUS_FILTERS.map((opt) => (
                  <DropdownItem
                    key={opt.key}
                    className={`mu-users-filter-item${statusFilter === opt.key ? ' mu-users-filter-item--active' : ''}`}
                    onClick={() => {
                      setStatusFilter(opt.key)
                      close()
                    }}
                  >
                    {opt.label}
                  </DropdownItem>
                ))}
              </div>
            )}
          </Dropdown>
        </div>

        <Dropdown
          align="left"
          className="mu-users-filter-desktop"
          trigger={(
            <button type="button" className="mu-users-filter-btn">
              <Filter size={15} />
              {activeFilter.label}
            </button>
          )}
        >
          {(close) => (
            <div className="mu-users-filter-menu">
              {STATUS_FILTERS.map((opt) => (
                <DropdownItem
                  key={opt.key}
                  className={`mu-users-filter-item${statusFilter === opt.key ? ' mu-users-filter-item--active' : ''}`}
                  onClick={() => {
                    setStatusFilter(opt.key)
                    close()
                  }}
                >
                  {opt.label}
                </DropdownItem>
              ))}
            </div>
          )}
        </Dropdown>
      </div>

      {loading ? (
        <Card><LoadingState label="Loading users…" /></Card>
      ) : filtered.length === 0 ? (
        <Card>
          <EmptyState
            title={rows.length === 0 ? 'No assigned users' : 'No users match that filter.'}
          />
        </Card>
      ) : (
        <div className="mu-users-grid">
          {filtered.map((row) => (
            <Card
              key={row.id}
              interactive={canOpenUser(row)}
              className="mu-users-card ft-quick-tile"
              style={{ padding: 14 }}
              onClick={canOpenUser(row) ? () => selectUser(row) : undefined}
            >
              <div className="mu-users-card__head">
                <Avatar
                  name={row.assignedName}
                  src={row.ownerPic || row.driverPic}
                  size="md"
                />
                <div className="mu-users-card__identity">
                  <p className="mu-users-card__name">{row.assignedName}</p>
                  <p
                    className={`mu-users-card__status ${
                      row.online ? 'mu-users-card__status--online' : 'mu-users-card__status--offline'
                    }`}
                  >
                    {row.online ? 'Online' : 'Offline'}
                  </p>
                </div>
                <div className="mu-users-card__menu" onClick={(e) => e.stopPropagation()}>
                  <Dropdown
                    align="right"
                    trigger={(
                      <IconButton label="More actions" size="sm">
                        <MoreVertical size={16} />
                      </IconButton>
                    )}
                  >
                    {canOpenUser(row) && (
                      <DropdownItem onClick={() => selectUser(row)}>
                        View user
                      </DropdownItem>
                    )}
                    <DropdownItem onClick={() => selectVehicle(row.id)}>
                      View vehicle
                    </DropdownItem>
                  </Dropdown>
                </div>
              </div>

              <div className="mu-users-card__hero">
                <VehicleHeroArt vehicleType={row.vehicleType} plate={row.plate} size="card" src={row.pic} />
              </div>

              <div className="mu-users-card__foot">
                <div>
                  <p className="mu-users-card__vehicle">{row.name}</p>
                  <p className="mu-users-card__meta">Vehicle</p>
                </div>
                <Button
                  size="sm"
                  variant="secondary"
                  className="mu-users-card__select"
                  disabled={!canOpenUser(row)}
                  onClick={(e) => {
                    e.stopPropagation()
                    selectUser(row)
                  }}
                >
                  Select
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}

export default ManagerAssetPicker
