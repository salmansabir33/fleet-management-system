import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Plus, User, ShieldAlert, AlertTriangle, Info as InfoIcon,
  Wrench,
} from 'lucide-react'
import api from '../../../api'
import { useTheme } from '../../../theme'
import {
  Card,
  Button,
  SearchInput,
  FilterBar,
  StatusBadge,
  Tabs,
  AlertRow,
  EmptyState,
  Skeleton,
} from '../../../shared/components'
import VehicleMap from '../../../user/components/VehicleMap'
import { usePanelScope } from '../../hooks/usePanelScope'
import { timeAgo, fmtNum } from '../../utils/dashboardFormatters'
import CreateUserModal from '../../../admin/components/CreateUserModal'
import { ALERT_TYPE_LABELS } from '../../../admin/utils/notificationDisplayPrefs'
import {
  matchesVehicleStatusFilter,
  tallyVehicleStatusCounts,
  VEHICLE_STATUS_FILTERS,
} from '../../../user/utils/vehicleStatus'
import VehicleHeroArt from '../../../user/components/VehicleHeroArt'
import { vehiclePhotoSrc } from '../../../user/utils/vehiclePhoto'

const VEHICLE_FILTERS = VEHICLE_STATUS_FILTERS

const TYPE_FILTERS = [
  { key: 'all', label: 'All types' },
  { key: 'truck', label: 'Truck' },
  { key: 'car', label: 'Car' },
  { key: 'van', label: 'Van' },
  { key: 'bike', label: 'Bike' },
]

const SEVERITY_ICONS = {
  critical: ShieldAlert,
  warning: AlertTriangle,
  info: InfoIcon,
}

const DETAIL_TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'tracking', label: 'Live Tracking' },
  { id: 'trips', label: 'Trips' },
  { id: 'alerts', label: 'Alerts' },
  { id: 'maintenance', label: 'Maintenance' },
]

const StatLine = ({ label, value, tokens }) => (
  <div
    style={{
      display: 'flex',
      justifyContent: 'space-between',
      gap: 8,
      padding: '8px 0',
      borderBottom: `1px solid ${tokens.border}`,
      fontSize: 13,
    }}
  >
    <span style={{ color: tokens.textMuted }}>{label}</span>
    <span style={{ fontWeight: 600, color: tokens.text }}>{value}</span>
  </div>
)

const VehicleDetailPanel = ({ vehicle, basePath, canAlerts, canMaintenance, apiFor, listLoading = false }) => {
  const { tokens } = useTheme()
  const navigate = useNavigate()
  const [tab, setTab] = useState('overview')
  const [report, setReport] = useState(null)
  const [alerts, setAlerts] = useState([])
  const [loading, setLoading] = useState(false)

  const deviceId = vehicle?.db_id

  useEffect(() => {
    if (!deviceId) {
      setReport(null)
      setAlerts([])
      return undefined
    }
    let cancelled = false
    const load = async () => {
      setLoading(true)
      try {
        const tasks = [
          api.get(`/api/vehicle-report/${deviceId}`),
        ]
        if (canAlerts) {
          tasks.push(
            api.get(apiFor('/alerts', '/api/alerts'), { params: { device_id: deviceId, limit: 5 } }),
          )
        }
        const [reportRes, alertsRes] = await Promise.all(tasks)
        if (!cancelled) {
          setReport(reportRes.data)
          setAlerts(alertsRes?.data || [])
        }
      } catch (err) {
        console.error('Failed to load vehicle detail:', err)
        if (!cancelled) {
          setReport(null)
          setAlerts([])
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [deviceId, canAlerts, apiFor])

  if (!vehicle) {
    return (
      <Card
        badge={4}
        title="Vehicle Detail"
        style={{ minHeight: 320 }}
        loading={listLoading}
        skeletonLines={8}
      >
        <EmptyState title="Select a vehicle" description="Click a row in the vehicles table to inspect it here." />
      </Card>
    )
  }

  const attrs = vehicle.position?.attributes || {}
  const pos = vehicle.position || {}
  const metrics = report?.report

  const mapVehicles = pos.latitude != null && pos.longitude != null
    ? [{
      id: deviceId,
      name: vehicle.device?.name,
      lat: pos.latitude,
      lon: pos.longitude,
      status: vehicle.status,
      speedKmh: pos.speed_kmh,
      heading: pos.course,
      vehicleType: vehicle.vehicle_type,
    }]
    : []

  const recentTrips = report?.trips ? [...report.trips].reverse().slice(0, 5) : []

  return (
    <Card badge={4} title="Vehicle Detail" style={{ minHeight: 320 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: 14 }}>
        <div
          style={{
            width: 48,
            height: 48,
            borderRadius: tokens.radius.md,
            background: tokens.primarySoft,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
          }}
        >
        <VehicleHeroArt
          vehicleType={vehicle.vehicle_type}
          size="thumb"
          src={vehiclePhotoSrc(vehicle)}
        />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: tokens.text }}>
            {vehicle.device?.name}
            {vehicle.plate_number ? ` (${vehicle.plate_number})` : ''}
          </div>
          <div style={{ marginTop: 6 }}>
            <StatusBadge status={vehicle.status} connection />
          </div>
        </div>
      </div>

      <Tabs items={DETAIL_TABS} value={tab} onChange={setTab} style={{ marginBottom: 14 }} />

      {loading ? (
        <div aria-hidden style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} height={12} width={i === 5 ? '60%' : '100%'} />
          ))}
        </div>
      ) : (
        <>
          {tab === 'overview' && (
            <>
              <StatLine label="Speed" value={pos.speed_kmh != null ? `${fmtNum(pos.speed_kmh, 1)} km/h` : '—'} tokens={tokens} />
              <StatLine label="Heading" value={pos.course != null ? `${fmtNum(pos.course, 0)}°` : '—'} tokens={tokens} />
              <StatLine label="Fuel Used" value={metrics?.total_fuel_liters != null ? `${fmtNum(metrics.total_fuel_liters, 1)} L` : '—'} tokens={tokens} />
              <StatLine label="Engine Hours" value={metrics?.engine_hours != null ? fmtNum(metrics.engine_hours, 1) : '—'} tokens={tokens} />
              <StatLine label="Odometer" value={metrics?.db_total_distance != null ? `${fmtNum(metrics.db_total_distance, 1)} km` : '—'} tokens={tokens} />
              <StatLine label="Battery" value={attrs.batteryLevel != null ? `${attrs.batteryLevel}%` : '—'} tokens={tokens} />
              <StatLine label="Ignition" value={attrs.ignition == null ? '—' : (attrs.ignition ? 'On' : 'Off')} tokens={tokens} />
              <StatLine label="Last Update" value={timeAgo(pos.fixTime || pos.deviceTime)} tokens={tokens} />

              <div style={{ marginTop: 16 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: tokens.text, marginBottom: 8 }}>
                  Today&apos;s Summary
                </div>
                <div style={{ fontSize: 12, color: tokens.textMuted }}>
                  Distance: {metrics?.today_distance_km != null ? `${fmtNum(metrics.today_distance_km, 1)} km` : '—'}
                  {' · '}
                  Trips: {metrics?.today_trip_count ?? '—'}
                </div>
              </div>

              {canAlerts && alerts.length > 0 && (
                <div style={{ marginTop: 16 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: tokens.text, marginBottom: 8 }}>
                    Recent Alerts
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {alerts.slice(0, 3).map((alert, idx) => (
                      <AlertRow
                        key={alert.id ?? `${alert.alert_type}-${alert.triggered_at}-${idx}`}
                        severity={alert.severity || 'info'}
                        icon={SEVERITY_ICONS[alert.severity] || InfoIcon}
                        title={alert.message || ALERT_TYPE_LABELS[alert.alert_type] || alert.alert_type}
                        subtitle={vehicle.device?.name}
                        timestamp={timeAgo(alert.triggered_at)}
                      />
                    ))}
                  </div>
                </div>
              )}
            </>
          )}

          {tab === 'tracking' && (
            mapVehicles.length > 0 ? (
              <VehicleMap vehicles={mapVehicles} height={220} />
            ) : (
              <EmptyState title="No position" description="This vehicle has no live coordinates." />
            )
          )}

          {tab === 'trips' && (
            recentTrips.length === 0 ? (
              <EmptyState title="No trips" description="No trip history for this vehicle yet." />
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {recentTrips.map((trip, idx) => (
                  <div
                    key={trip.id ?? `trip-${trip.trip_number}-${idx}`}
                    style={{
                      padding: '8px 10px',
                      borderRadius: tokens.radius.sm,
                      background: tokens.background,
                      fontSize: 12,
                    }}
                  >
                    <div style={{ fontWeight: 600 }}>{trip.trip_number ?? trip.id}</div>
                    <div style={{ color: tokens.textMuted, marginTop: 2 }}>
                      {fmtNum(trip.distance_km, 1)} km · {trip.status || '—'}
                    </div>
                  </div>
                ))}
              </div>
            )
          )}

          {tab === 'alerts' && (
            !canAlerts ? (
              <EmptyState title="Not permitted" description="Alerts access is not granted." />
            ) : alerts.length === 0 ? (
              <EmptyState title="No alerts" description="No recent alerts for this vehicle." />
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {alerts.map((alert, idx) => (
                  <AlertRow
                    key={alert.id ?? `${alert.alert_type}-${alert.triggered_at}-${idx}`}
                    severity={alert.severity || 'info'}
                    icon={SEVERITY_ICONS[alert.severity] || InfoIcon}
                    title={alert.message || ALERT_TYPE_LABELS[alert.alert_type] || alert.alert_type}
                    timestamp={timeAgo(alert.triggered_at)}
                  />
                ))}
              </div>
            )
          )}

          {tab === 'maintenance' && (
            canMaintenance ? (
              <div style={{ textAlign: 'center', padding: '20px 0' }}>
                <Wrench size={28} color={tokens.textMuted} style={{ marginBottom: 8 }} />
                <p style={{ fontSize: 13, color: tokens.textMuted, margin: '0 0 12px' }}>
                  Open the full maintenance workspace for this vehicle.
                </p>
                <Button variant="secondary" size="sm" onClick={() => navigate(`${basePath}/maintenance/${deviceId}`)}>
                  View Maintenance
                </Button>
              </div>
            ) : (
              <EmptyState title="Not permitted" description="Maintenance access is not granted." />
            )
          )}
        </>
      )}
    </Card>
  )
}

const DashboardVehiclesSection = ({ vehicleRows, canLive, loading = false, onUserCreated }) => {
  const { tokens } = useTheme()
  const navigate = useNavigate()
  const { basePath, apiFor, can } = usePanelScope()
  const canAlerts = can('alerts_notifications')
  const canMaintenance = can('maintenance')
  const canAddUser = can('user_management')

  const [search, setSearch] = useState('')
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [statusFilter, setStatusFilter] = useState('all')
  const [typeFilter, setTypeFilter] = useState('all')
  const [selectedId, setSelectedId] = useState(null)

  const statusCounts = useMemo(
    () => tallyVehicleStatusCounts(vehicleRows.map((row) => row.status)),
    [vehicleRows],
  )

  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase()
    return vehicleRows.filter((row) => {
      if (!matchesVehicleStatusFilter(row.status, statusFilter)) return false
      if (typeFilter !== 'all' && (row.vehicle_type || '').toLowerCase() !== typeFilter) return false
      if (!q) return true
      const name = (row.device?.name || '').toLowerCase()
      const plate = (row.plate_number || '').toLowerCase()
      const driver = (row.active_driver?.name || '').toLowerCase()
      return name.includes(q) || plate.includes(q) || driver.includes(q)
    })
  }, [vehicleRows, statusFilter, typeFilter, search])

  const selectedVehicle = filteredRows.find((r) => r.db_id === selectedId)
    || vehicleRows.find((r) => r.db_id === selectedId)
    || null

  const filterOptions = VEHICLE_FILTERS.map((f) => ({
    ...f,
    count: statusCounts[f.key] || 0,
  }))

  return (
    <div
      className="ft-split-layout"
      style={{
        display: 'grid',
        gridTemplateColumns: 'minmax(0, 1fr) minmax(280px, 360px)',
        gap: 16,
        alignItems: 'start',
      }}
    >
      {showCreateModal && (
        <CreateUserModal
          onClose={() => setShowCreateModal(false)}
          onCreated={() => {
            setShowCreateModal(false)
            onUserCreated?.()
          }}
        />
      )}
      <Card badge={3} title="Vehicles" loading={loading} skeletonLines={6}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 12 }}>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <SearchInput
              placeholder="Search vehicle, plate, driver…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{ flex: 1, minWidth: 180 }}
            />
            {canAddUser && (
              <Button variant="secondary" size="sm" onClick={() => setShowCreateModal(true)}>
                <Plus size={14} />
                Add user
              </Button>
            )}
          </div>
          <FilterBar options={filterOptions} value={statusFilter} onChange={setStatusFilter} />
          <FilterBar options={TYPE_FILTERS} value={typeFilter} onChange={setTypeFilter} />
        </div>

        {!canLive ? (
          <EmptyState title="Not permitted" description="Live tracking access is required." />
        ) : filteredRows.length === 0 ? (
          <EmptyState title="No vehicles" description="No vehicles match your filters." />
        ) : (
          <div style={{ maxHeight: 360, overflowY: 'auto' }}>
            {filteredRows.map((row) => {
              const isSelected = selectedId === row.db_id
              return (
                <div
                  key={row.db_id}
                  role="button"
                  tabIndex={0}
                  onClick={() => setSelectedId(row.db_id)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      setSelectedId(row.db_id)
                    }
                  }}
                  style={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: 10,
                    padding: '12px 10px',
                    borderBottom: `1px solid ${tokens.border}`,
                    cursor: 'pointer',
                    background: isSelected ? tokens.primarySoft : 'transparent',
                  }}
                >
                  <div
                    style={{
                      width: 32,
                      height: 32,
                      borderRadius: tokens.radius.sm,
                      background: tokens.primarySoft,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      flexShrink: 0,
                    }}
                  >
                    <VehicleHeroArt
                      vehicleType={row.vehicle_type}
                      size="thumb"
                      src={vehiclePhotoSrc(row)}
                    />
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                      <span style={{ fontWeight: 700, fontSize: 13 }}>{row.device?.name}</span>
                      <StatusBadge status={row.status} connection />
                    </div>
                    <div style={{ fontSize: 12, color: tokens.textMuted, marginTop: 4 }}>
                      <User size={11} style={{ marginRight: 3, verticalAlign: -2 }} />
                      {row.active_driver?.name || 'Unassigned'}
                      {' · '}
                      {timeAgo(row.position?.fixTime || row.position?.deviceTime)}
                    </div>
                    <div style={{ fontSize: 11, color: tokens.textDisabled, marginTop: 2 }}>
                      {row.position?.address || (row.position?.latitude != null
                        ? `${fmtNum(row.position.latitude, 4)}, ${fmtNum(row.position.longitude, 4)}`
                        : 'Location unavailable')}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </Card>

      <VehicleDetailPanel
        vehicle={selectedVehicle}
        basePath={basePath}
        canAlerts={canAlerts}
        canMaintenance={canMaintenance}
        apiFor={apiFor}
        listLoading={loading}
      />
    </div>
  )
}

export default DashboardVehiclesSection
