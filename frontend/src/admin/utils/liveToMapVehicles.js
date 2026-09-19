import { deriveVehicleStatus } from '../../user/utils/vehicleStatus'

/** Map `/api/live` rows to the shape VehicleMap expects. */
export function liveToMapVehicles(live) {
  return (live || [])
    .filter((item) => item.position?.latitude != null && item.position?.longitude != null)
    .map((item) => {
      const attrs = item.position?.attributes || {}
      return {
        id: item.db_id ?? item.device?.id,
        name: item.device?.name,
        lat: item.position.latitude,
        lon: item.position.longitude,
        status: deriveVehicleStatus(item),
        speedKmh: item.position.speed_kmh,
        ignition: attrs.ignition,
        batteryLevel: attrs.batteryLevel,
        lastUpdate: item.position.fixTime || item.position.deviceTime,
        heading: item.position.course,
        vehicleType: item.vehicle_type,
        plateNumber: item.plate_number,
      }
    })
}
