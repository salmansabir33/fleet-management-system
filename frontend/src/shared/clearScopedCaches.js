import { clearPlaybackCaches } from '../user/utils/playbackCache'
import { invalidateMaintenanceStatus } from '../user/utils/maintenanceStatusCache'
import { invalidateMaintenanceRecords } from '../user/utils/maintenanceRecordsCache'

export function clearAllScopedCaches() {
  clearPlaybackCaches()
  invalidateMaintenanceStatus(null)
  invalidateMaintenanceRecords(null)
}
