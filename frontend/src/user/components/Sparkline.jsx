// Minimal inline SVG sparkline — no charting library needed for a
// single trend line. `points` is an array of numbers, oldest first.
const Sparkline = ({ points = [], color = '#0d9488', width = 220, height = 48 }) => {
  if (points.length === 0) {
    return <div style={{ height, display: 'flex', alignItems: 'center', fontSize: 12, color: '#9ca3af' }}>No data yet</div>
  }

  const max = Math.max(...points, 0.0001)
  const min = 0 // metrics here (distance/cost) are always >= 0 — anchor the baseline at 0
  const range = max - min || 1
  const stepX = points.length > 1 ? width / (points.length - 1) : 0

  const coords = points.map((v, i) => {
    const x = points.length > 1 ? i * stepX : width / 2
    const y = height - ((v - min) / range) * (height - 6) - 3
    return [x, y]
  })

  const linePath = coords.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ')
  const areaPath = `${linePath} L${coords[coords.length - 1][0].toFixed(1)},${height} L0,${height} Z`

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} style={{ display: 'block', overflow: 'visible' }}>
      <path d={areaPath} fill={color} opacity={0.12} />
      <path d={linePath} fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
      {coords.map(([x, y], i) => (
        <circle key={i} cx={x} cy={y} r={i === coords.length - 1 ? 3 : 0} fill={color} />
      ))}
    </svg>
  )
}

export default Sparkline
