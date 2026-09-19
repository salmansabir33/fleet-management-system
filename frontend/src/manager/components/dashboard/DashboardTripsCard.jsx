import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Upload } from 'lucide-react'
import { useTheme } from '../../../theme'
import { hexToRgba } from '../../../shared/utils'
import {
  Card,
  Button,
  Table,
  TableRow,
  Badge,
  FilterBar,
  EmptyState,
  Pagination,
} from '../../../shared/components'
import { usePanelScope } from '../../hooks/usePanelScope'
import { fmtTime, formatDuration, fmtNum } from '../../utils/dashboardFormatters'

const STATUS_FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'in_progress', label: 'In Progress' },
  { key: 'completed', label: 'Completed' },
]

const TRIPS_PAGE_SIZE = 5
/** Shell / layout mobile breakpoint */
const MOBILE_MQ = '(max-width: 820px)'

const DashboardTripsCard = ({ trips, canTrips, loading = false }) => {
  const { tokens } = useTheme()
  const { basePath } = usePanelScope()
  const [statusFilter, setStatusFilter] = useState('all')
  const [page, setPage] = useState(1)
  const [isMobile, setIsMobile] = useState(() => (
    typeof window !== 'undefined' ? window.matchMedia(MOBILE_MQ).matches : false
  ))

  useEffect(() => {
    const mq = window.matchMedia(MOBILE_MQ)
    const sync = () => setIsMobile(mq.matches)
    sync()
    mq.addEventListener('change', sync)
    return () => mq.removeEventListener('change', sync)
  }, [])

  const filtered = useMemo(() => trips.filter((trip) => {
    if (statusFilter === 'all') return true
    return trip.status === statusFilter
  }), [trips, statusFilter])

  const pageCount = Math.max(1, Math.ceil(filtered.length / TRIPS_PAGE_SIZE))
  const listItems = isMobile
    ? filtered
    : filtered.slice((page - 1) * TRIPS_PAGE_SIZE, page * TRIPS_PAGE_SIZE)

  return (
    <Card
      badge={6}
      title="Trips (Today)"
      right={(
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Button variant="secondary" size="sm" disabled title="Trip export endpoint is not available">
            <Upload size={14} />
            Export
          </Button>
          <Link
            to={`${basePath}/trips`}
            style={{ fontSize: 12, fontWeight: 600, color: tokens.primary, textDecoration: 'none' }}
          >
            View all trips
          </Link>
        </div>
      )}
    >
      <div style={{ marginBottom: 12 }}>
        <FilterBar
          options={STATUS_FILTERS}
          value={statusFilter}
          onChange={(v) => { setStatusFilter(v); setPage(1) }}
        />
      </div>

      {!canTrips ? (
        <EmptyState title="Not permitted" description="Trip history access is required." />
      ) : loading || filtered.length > 0 ? (
        <>
          <Table
            loading={loading}
            columns={[
              { key: 'id', label: 'Trip ID' },
              { key: 'vehicle', label: 'Vehicle' },
              { key: 'driver', label: 'Driver' },
              { key: 'start', label: 'Start' },
              { key: 'end', label: 'End' },
              { key: 'distance', label: 'Distance', align: 'right' },
              { key: 'duration', label: 'Duration', align: 'right' },
              { key: 'status', label: 'Status' },
            ]}
          >
            {listItems.map((trip, idx) => {
              const completed = trip.status === 'completed'
              const statusColor = completed ? tokens.semantic.success : tokens.semantic.warning
              return (
                <TableRow key={trip.id ?? `trip-${trip.trip_number}-${idx}`}>
                  <td style={{ fontWeight: 600 }}>{trip.trip_number ?? trip.id}</td>
                  <td>{trip.vehicle_name}</td>
                  <td>{trip.driver_name || 'Unassigned'}</td>
                  <td>{fmtTime(trip.start_time)}</td>
                  <td>{fmtTime(trip.end_time)}</td>
                  <td style={{ textAlign: 'right' }}>{fmtNum(trip.distance_km, 1)} km</td>
                  <td style={{ textAlign: 'right' }}>{formatDuration(trip.duration_min)}</td>
                  <td>
                    <Badge color={statusColor} background={hexToRgba(statusColor, 0.14)} pill>
                      {completed ? 'Completed' : 'In Progress'}
                    </Badge>
                  </td>
                </TableRow>
              )
            })}
          </Table>
          {!isMobile && pageCount > 1 && !loading && (
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 12 }}>
              <Pagination page={page} pageCount={pageCount} onPageChange={setPage} />
            </div>
          )}
        </>
      ) : (
        <EmptyState title="No trips" description="No trips match your filters for this period." />
      )}
    </Card>
  )
}

export default DashboardTripsCard
