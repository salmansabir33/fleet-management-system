import { useId } from 'react'
import { Area, AreaChart, ResponsiveContainer } from 'recharts'
import { useTheme } from '../../theme'

function toChartData(points) {
  return points.map((value, index) => ({
    index,
    value: Number(value) || 0,
  }))
}

/**
 * Compact inline trend line for cards and table cells.
 * `points` is an array of numbers, oldest first.
 */
export function Sparkline({
  points = [],
  color,
  width = 220,
  height = 48,
  className,
  style,
}) {
  const { tokens } = useTheme()
  const gradientId = useId()
  const stroke = color || tokens.primary
  const data = toChartData(points)

  if (data.length === 0) {
    return (
      <div
        className={className}
        style={{
          width,
          height,
          display: 'flex',
          alignItems: 'center',
          fontSize: 12,
          color: tokens.textMuted,
          ...style,
        }}
      >
        No data yet
      </div>
    )
  }

  return (
    <div
      className={className}
      style={{ width, height, ...style }}
      aria-hidden
    >
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 2, right: 2, bottom: 2, left: 2 }}>
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={stroke} stopOpacity={0.22} />
              <stop offset="100%" stopColor={stroke} stopOpacity={0} />
            </linearGradient>
          </defs>
          <Area
            type="monotone"
            dataKey="value"
            stroke={stroke}
            strokeWidth={2}
            fill={`url(#${gradientId})`}
            dot={false}
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}

export default Sparkline
