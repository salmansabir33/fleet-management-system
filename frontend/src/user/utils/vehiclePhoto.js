import { API_BASE_URL } from '../../api'

function resolvePhotoUrl(raw) {
  if (!raw) return undefined
  if (/^(https?:|blob:|data:)/i.test(raw)) return raw
  const path = raw.startsWith('/') ? raw : `/${raw}`
  return `${API_BASE_URL}${path}`
}

export function vehiclePhotoSrc(liveItem) {
  if (!liveItem) return undefined
  if (typeof liveItem === 'string') return resolvePhotoUrl(liveItem)

  const uploaded = liveItem.pic_url
    || liveItem.device?.pic_url
  if (uploaded) return resolvePhotoUrl(uploaded)

  const device = liveItem.device
  if (!device) return undefined
  const attrs = device.attributes || {}
  return resolvePhotoUrl(
    device.photo
    || attrs.photo
    || attrs.image
    || attrs.deviceImage
    || attrs.picture,
  )
}
