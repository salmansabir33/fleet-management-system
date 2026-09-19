/** Curated map-readable colors — distinct hues, no near-black / near-white. */
export const VEHICLE_MARKER_PALETTE = [
  '#0d9488', // teal
  '#2563eb', // blue
  '#7c3aed', // violet
  '#db2777', // pink
  '#ea580c', // orange
  '#ca8a04', // gold
  '#16a34a', // green
  '#0891b2', // cyan
  '#dc2626', // red
  '#4f46e5', // indigo
  '#c026d3', // fuchsia
  '#65a30d', // lime
  '#0284c7', // sky
  '#9333ea', // purple
  '#d97706', // amber
  '#059669', // emerald
]

/** Stable FNV-1a-ish hash → palette index. Same id always yields the same color. */
export function colorFromVehicleId(id) {
  const str = id == null ? '' : String(id)
  let hash = 2166136261
  for (let i = 0; i < str.length; i += 1) {
    hash ^= str.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  const index = Math.abs(hash) % VEHICLE_MARKER_PALETTE.length
  return VEHICLE_MARKER_PALETTE[index]
}
