import { API_BASE_URL } from '../../api'

export function userPicSrc(picUrl) {
  if (!picUrl) return undefined
  if (
    picUrl.startsWith('http://')
    || picUrl.startsWith('https://')
    || picUrl.startsWith('blob:')
    || picUrl.startsWith('data:')
  ) {
    return picUrl
  }
  return `${API_BASE_URL}${picUrl}`
}

export async function uploadUserPhoto(apiClient, apiFor, userId, file) {
  if (!file || !userId) return
  const data = new FormData()
  data.append('pic', file)
  await apiClient.post(
    apiFor(`/users/${userId}/photo`, `/api/users/${userId}/photo`),
    data,
  )
}

export async function uploadVehiclePhoto(apiClient, apiFor, deviceId, file) {
  if (!file || !deviceId) return
  const data = new FormData()
  data.append('pic', file)
  await apiClient.post(
    apiFor(`/vehicles/${deviceId}/photo`, `/api/fleet/devices/${deviceId}/photo`),
    data,
  )
}
