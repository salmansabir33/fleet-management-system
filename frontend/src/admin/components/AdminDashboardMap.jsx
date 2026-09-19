import { lazy, Suspense, useMemo } from 'react'
import { Map } from 'lucide-react'
import { EmptyState, LoadingState } from '../../shared/components'
import LiveBadge from '../../user/components/LiveBadge'
import { statusMeta } from '../../theme'
import { liveToMapVehicles } from '../utils/liveToMapVehicles'

const VehicleMap = lazy(() => import('../../user/components/VehicleMap'))

const STATUS_CHIPS = [
  { key: 'moving', label: 'Moving' },
  { key: 'idle', label: 'Idle' },
  { key: 'stopped', label: 'Parked' },
  { key: 'offline', label: 'Offline' },
]

const MapFallback = () => (
  <div className="ft-admin-fleet-map__fallback">
    <LoadingState label="Loading map…" />
  </div>
)

const AdminDashboardMap = ({
  live,
  loading,
  statusCounts,
  onOpenMap,
  onVehicleDetails,
}) => {
  const vehicles = useMemo(() => liveToMapVehicles(live), [live])
  const located = vehicles.length
  const total = live.length

  return (
    <section className="ft-admin-fleet-map" aria-label="Fleet map">
      <div className="ft-admin-fleet-map__head">
        <div className="ft-admin-fleet-map__heading">
          <h3 className="ft-admin-widget__title">Fleet map</h3>
          <LiveBadge offline={total === 0 && !loading} />
        </div>
        {onOpenMap && (
          <button type="button" className="ft-admin-fleet-map__open" onClick={onOpenMap}>
            <Map size={14} aria-hidden />
            Full map
          </button>
        )}
      </div>

      <div className="ft-admin-fleet-map__canvas">
        <div className="ft-admin-fleet-map__chips" aria-label="Fleet status">
          {STATUS_CHIPS.map((chip) => (
            <span key={chip.key} className="ft-admin-fleet-map__chip">
              <span
                className="ft-admin-fleet-map__chip-dot"
                style={{ background: statusMeta[chip.key]?.color }}
              />
              {chip.label}
              <strong>{loading && total === 0 ? '—' : (statusCounts[chip.key] || 0)}</strong>
            </span>
          ))}
        </div>
        {loading && total === 0 ? (
          <MapFallback />
        ) : located === 0 ? (
          <div className="ft-admin-fleet-map__fallback">
            <EmptyState
              title="No live positions"
              description="Vehicles appear here once they report GPS coordinates."
            />
          </div>
        ) : (
          <Suspense fallback={<MapFallback />}>
            <VehicleMap
              vehicles={vehicles}
              height="100%"
              fitAllVehicles
              showLegend={false}
              zoomPosition="topright"
              onMoreDetails={onVehicleDetails}
              className="ft-admin-fleet-map__leaflet"
            />
          </Suspense>
        )}
      </div>
    </section>
  )
}

export default AdminDashboardMap
