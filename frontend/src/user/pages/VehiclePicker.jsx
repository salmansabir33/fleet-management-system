import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { MoreHorizontal } from 'lucide-react'
import api from '../../api'
import {
  Card,
  StatusBadge,
  Table,
  TableRow,
  LoadingState,
  EmptyState,
  IconButton,
  SearchInput,
} from '../../shared/components'
import { useSelectedDevice } from '../context/SelectedDeviceContext'
import { deriveVehicleStatus } from '../utils/vehicleStatus'
import VehicleHeroArt from '../components/VehicleHeroArt'
import { vehiclePhotoSrc } from '../utils/vehiclePhoto'

const VehiclePicker = () => {
  const navigate = useNavigate()
  const { setDeviceId, deviceId: selectedId } = useSelectedDevice()
  const [devices, setDevices] = useState([])
  const [liveByDbId, setLiveByDbId] = useState({})
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')

  useEffect(() => {
    const load = async () => {
      try {
        const [devicesRes, liveRes] = await Promise.all([
          api.get('/api/fleet/devices'),
          api.get('/api/live'),
        ])
        setDevices(devicesRes.data || [])
        const byDbId = {}
        for (const item of liveRes.data.live || []) {
          if (item.db_id != null) byDbId[item.db_id] = item
        }
        setLiveByDbId(byDbId)
      } catch (err) {
        console.error('Failed to load vehicles:', err)
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return devices
    return devices.filter((d) => {
      const hay = `${d.name || ''} ${d.plate_number || ''} ${d.vehicle_type || ''}`.toLowerCase()
      return hay.includes(q)
    })
  }, [devices, query])

  const selectVehicle = (deviceId) => {
    setDeviceId(deviceId)
    navigate('/user/dashboard')
  }

  return (
    <div className="ft-page-stack">
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <SearchInput
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search vehicles"
          aria-label="Search vehicles"
          style={{ width: 260 }}
        />
      </div>

      <Card style={{ padding: loading || filtered.length === 0 ? 18 : 0 }}>
        {loading ? (
          <LoadingState label="Loading vehicles…" />
        ) : devices.length === 0 ? (
          <EmptyState
            title="No vehicles registered yet"
            description="Ask your fleet admin to assign a vehicle to your account."
          />
        ) : filtered.length === 0 ? (
          <EmptyState title="No vehicles match that search." />
        ) : (
          <Table
            className="ft-table--comfortable"
            columns={[
              { key: 'vehicle', label: 'Vehicle', width: 72 },
              { key: 'name', label: 'Name' },
              { key: 'plate', label: 'License Plate' },
              { key: 'status', label: 'Status' },
              { key: 'actions', label: '', width: 48 },
            ]}
          >
            {filtered.map((d) => {
              const live = liveByDbId[d.id]
              const status = live ? deriveVehicleStatus(live) : 'offline'
              const isSelected = selectedId != null && String(selectedId) === String(d.id)

              return (
                <TableRow
                  key={d.id}
                  clickable
                  onClick={() => selectVehicle(d.id)}
                  className={isSelected ? 'ft-table-row--selected' : undefined}
                >
                  <td>
                    <VehicleHeroArt
                      vehicleType={d.vehicle_type}
                      size="thumb"
                      src={vehiclePhotoSrc(live) || vehiclePhotoSrc(d)}
                    />
                  </td>
                  <td style={{ fontWeight: 700 }}>{d.name}</td>
                  <td style={{ color: 'var(--ft-text-secondary)' }}>{d.plate_number || '—'}</td>
                  <td><StatusBadge status={status} /></td>
                  <td onClick={(e) => e.stopPropagation()}>
                    <IconButton
                      label="Select vehicle"
                      onClick={() => selectVehicle(d.id)}
                    >
                      <MoreHorizontal size={16} />
                    </IconButton>
                  </td>
                </TableRow>
              )
            })}
          </Table>
        )}
      </Card>
    </div>
  )
}

export default VehiclePicker
