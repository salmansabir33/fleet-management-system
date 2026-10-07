import { useEffect, useState, useCallback } from 'react'
import {
  Plus, ShieldCheck, Users, Truck, Car, Bike, UserMinus, Phone, X,
  ChevronRight, Search, Bell,
} from 'lucide-react'
import api from '../../api'
import {
  Button,
  LoadingState,
  Avatar,
  Modal,
} from '../../shared/components'
import { MobilePageHeading } from '../../shared/shell'
import { adminNavLabel } from '../navItems'
import { useSaAdminListParams } from '../hooks/useSaAdminListParams'
import AdminFilterBar from '../components/AdminFilterBar'
import AddManagerModal from '../components/AddManagerModal'
import PermissionsModal from '../components/PermissionsModal'
import NotificationsModal from '../components/NotificationsModal'
import AssignUsersModal from '../components/AssignUsersModal'
import { userPicSrc } from '../utils/userPic'
import '../styles/admin-trips.css'
import '../styles/admin-managers.css'

const VEHICLE_TYPE_ICON = {
  truck: Truck,
  van: Truck,
  car: Car,
  bike: Bike,
  motorcycle: Bike,
}

const Managers = () => {
  const saListParams = useSaAdminListParams()
  const [managers, setManagers] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [selectedId, setSelectedId] = useState(null)
  const [detail, setDetail] = useState(null)
  const [detailLoading, setDetailLoading] = useState(false)

  const [showAddModal, setShowAddModal] = useState(false)
  const [showPermissionsModal, setShowPermissionsModal] = useState(false)
  const [showNotificationsModal, setShowNotificationsModal] = useState(false)
  const [showAssignModal, setShowAssignModal] = useState(false)
  const [demoting, setDemoting] = useState(false)
  const [unassigningId, setUnassigningId] = useState(null)

  const loadManagers = useCallback(async (q) => {
    setLoading(true)
    try {
      const params = { ...saListParams, ...(q ? { q } : {}) }
      const res = await api.get('/api/managers', { params })
      setManagers(res.data)
    } catch (err) {
      console.error('Failed to load managers:', err)
    } finally {
      setLoading(false)
    }
  }, [saListParams])

  const loadDetail = useCallback(async (id) => {
    if (id == null) { setDetail(null); return }
    setDetailLoading(true)
    try {
      const res = await api.get(`/api/managers/${id}`)
      setDetail(res.data)
    } catch (err) {
      console.error('Failed to load manager detail:', err)
      setDetail(null)
    } finally {
      setDetailLoading(false)
    }
  }, [])

  useEffect(() => {
    const handle = setTimeout(() => loadManagers(search), 250)
    return () => clearTimeout(handle)
  }, [search, loadManagers])

  useEffect(() => {
    loadDetail(selectedId)
  }, [selectedId, loadDetail])

  const refreshAfterChange = () => {
    loadManagers(search)
    loadDetail(selectedId)
  }

  const handlePromoted = () => {
    refreshAfterChange()
  }

  const closeDetail = () => {
    setSelectedId(null)
    setDetail(null)
  }

  const handleDemote = async () => {
    if (!detail) return
    if (!window.confirm(`Demote ${detail.full_name || detail.username}? Their assigned users will become unassigned.`)) return
    setDemoting(true)
    try {
      await api.delete(`/api/managers/${detail.id}`)
      closeDetail()
      loadManagers(search)
    } catch (err) {
      console.error('Failed to demote manager:', err)
    } finally {
      setDemoting(false)
    }
  }

  const handleUnassignUser = async (userId) => {
    if (!detail) return
    setUnassigningId(userId)
    try {
      await api.post(`/api/managers/${detail.id}/unassign-user`, { user_id: userId })
      refreshAfterChange()
    } catch (err) {
      console.error('Failed to unassign user:', err)
    } finally {
      setUnassigningId(null)
    }
  }

  const stopRowAction = (event) => {
    event.stopPropagation()
  }

  const totalVehicles = (detail?.assigned_users || []).flatMap((u) => (u.vehicles || []).map((v) => ({ ...v, ownerName: u.full_name || u.username })))

  const emptyMessage = search ? 'No managers match the current search.' : 'No managers yet. Promote a user to get started.'

  return (
    <div className="at-trips-page amg-page">
      <MobilePageHeading>{adminNavLabel('/admin/managers')}</MobilePageHeading>
      <div className="at-trips-panel">
        <div className="at-trips-toolbar">
          <div className="at-trips-search ft-search">
            <Search size={16} color="var(--ft-text-disabled)" />
            <input
              type="search"
              placeholder="Search managers..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          <AdminFilterBar inline className="amg-admin-filter" />

          <div className="at-trips-toolbar-actions amg-toolbar-actions">
            <button
              type="button"
              className="amg-add-btn"
              onClick={() => setShowAddModal(true)}
            >
              <Plus size={16} />
              Add New Manager
            </button>
          </div>
        </div>

        {loading && managers.length === 0 ? (
          <LoadingState label="Loading managers…" />
        ) : managers.length === 0 ? (
          <div className="at-trips-empty">{emptyMessage}</div>
        ) : (
          <div className="at-trips-table-section amg-list-section">
            <div className="amg-cards" aria-label="Managers">
              {managers.map((m, i) => {
                const displayName = m.full_name || m.username
                const isSelected = selectedId === m.id
                return (
                  <article
                    key={m.id}
                    className={`amg-card${isSelected ? ' amg-card--selected' : ''}`}
                    role="button"
                    tabIndex={0}
                    onClick={() => setSelectedId(m.id)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault()
                        setSelectedId(m.id)
                      }
                    }}
                  >
                    <div className="amg-card-header">
                      <span className="amg-card-identity">
                        <span className="amg-card-num">#{i + 1}</span>
                        <Avatar name={displayName} size="md" src={userPicSrc(m.pic_url)} />
                        <span className="amg-card-name-block">
                          <span className="amg-card-name">{displayName}</span>
                          <span className="amg-card-user">@{m.username}</span>
                        </span>
                      </span>
                      <span className="amg-vehicles amg-vehicles--card" title="Assigned vehicles">
                        <Truck size={12} aria-hidden />
                        {m.total_vehicle_count}
                      </span>
                    </div>

                    <div
                      className="amg-card-actions"
                      onClick={stopRowAction}
                      onKeyDown={stopRowAction}
                    >
                      <button
                        type="button"
                        className="amg-card-details-btn"
                        onClick={() => setSelectedId(m.id)}
                      >
                        Details
                        <ChevronRight size={14} />
                      </button>
                    </div>
                  </article>
                )
              })}
            </div>
          </div>
        )}
      </div>

      <Modal
        open={!!selectedId}
        onClose={closeDetail}
        title={detail ? (detail.full_name || detail.username) : 'Manager details'}
        size="lg"
      >
        {detailLoading && !detail ? (
          <LoadingState label="Loading…" />
        ) : !detail ? (
          <p className="amg-detail-empty">Could not load this manager.</p>
        ) : (
          <div className="amg-detail">
            <div className="amg-detail-head">
              <Avatar name={detail.full_name || detail.username} size="xl" src={userPicSrc(detail.pic_url)} />
              <div className="amg-detail-identity">
                <div className="amg-detail-name">{detail.full_name || detail.username}</div>
                <div className="amg-detail-user">@{detail.username}</div>
                {detail.phone_number && (
                  <div className="amg-detail-phone">
                    <Phone size={12} />
                    {detail.phone_number}
                  </div>
                )}
              </div>
              <Button variant="danger" size="sm" onClick={handleDemote} loading={demoting}>
                <UserMinus size={13} />
                Demote
              </Button>
            </div>

            <div className="amg-detail-actions">
              <Button variant="secondary" onClick={() => setShowPermissionsModal(true)}>
                <ShieldCheck size={15} />
                Permissions
              </Button>
              <Button variant="secondary" onClick={() => setShowNotificationsModal(true)}>
                <Bell size={15} />
                Notifications
              </Button>
              <Button variant="secondary" onClick={() => setShowAssignModal(true)}>
                <Users size={15} />
                Assign Users
              </Button>
            </div>

            <div>
              <h3 className="amg-detail-section-title">
                Assigned Users ({detail.assigned_users?.length || 0})
              </h3>
              {(!detail.assigned_users || detail.assigned_users.length === 0) ? (
                <p className="amg-detail-empty">No users assigned yet.</p>
              ) : (
                <div className="amg-user-grid">
                  {detail.assigned_users.map((u) => (
                    <div key={u.id} className="amg-user-card">
                      <Avatar name={u.full_name || u.username} size="sm" src={userPicSrc(u.pic_url)} />
                      <div className="amg-user-card-text">
                        <div className="amg-user-card-name">{u.full_name || u.username}</div>
                        <div className="amg-user-card-meta">{u.vehicles?.length || 0} vehicle(s)</div>
                      </div>
                      {u.id !== detail.user_id && (
                        <button
                          type="button"
                          className="amg-unassign-btn"
                          aria-label={`Unassign ${u.full_name || u.username}`}
                          onClick={() => handleUnassignUser(u.id)}
                          disabled={unassigningId === u.id}
                        >
                          <X size={12} />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div>
              <h3 className="amg-detail-section-title">
                Total Vehicles ({totalVehicles.length})
              </h3>
              {totalVehicles.length === 0 ? (
                <p className="amg-detail-empty">No vehicles under this manager yet.</p>
              ) : (
                <div className="amg-vehicle-list">
                  {totalVehicles.map((v) => {
                    const TypeIcon = VEHICLE_TYPE_ICON[(v.vehicle_type || '').toLowerCase()] || Truck
                    return (
                      <div key={v.id} className="amg-vehicle-row">
                        <div className="amg-vehicle-icon">
                          <TypeIcon size={16} />
                        </div>
                        <div>
                          <div className="amg-vehicle-name">{v.name}</div>
                          <div className="amg-vehicle-meta">
                            {v.plate_number || 'No plate'} · owned by {v.ownerName}
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          </div>
        )}
      </Modal>

      {showAddModal && (
        <AddManagerModal
          onClose={() => setShowAddModal(false)}
          onPromoted={handlePromoted}
        />
      )}
      {showPermissionsModal && detail && (
        <PermissionsModal
          manager={detail}
          onClose={() => setShowPermissionsModal(false)}
          onSaved={refreshAfterChange}
        />
      )}
      {showNotificationsModal && detail && (
        <NotificationsModal
          manager={detail}
          onClose={() => setShowNotificationsModal(false)}
          onSaved={refreshAfterChange}
        />
      )}
      {showAssignModal && detail && (
        <AssignUsersModal
          manager={detail}
          onClose={() => setShowAssignModal(false)}
          onAssigned={refreshAfterChange}
        />
      )}
    </div>
  )
}

export default Managers
