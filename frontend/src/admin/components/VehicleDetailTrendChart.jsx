import { useId } from 'react'
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  XAxis,
  YAxis,
} from 'recharts'
import { useTheme } from '../../theme'

/**
 * Mockup-style area chart for the vehicle detail sidebar.
 * `points` — array of { date, distance_km } from the trend API.
 */
export function VehicleDetailTrendChart({ points = [], height = 160 }) {
  const { tokens } = useTheme()
  const gradientId = useId()

  const data = points.map((p) => ({
    label: new Date(p.date).toLocaleDateString('en', { month: 'short' }),
    value: Number(p.distance_km) || 0,
  }))

  if (data.length === 0) {
    return (
      <div
        className="vd-chart-wrap"
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: tokens.textMuted,
          fontSize: 12,
        }}
      >
        No distance data yet
      </div>
    )
  }

  return (
    <div className="vd-chart-wrap" style={{ height }} aria-hidden>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 6, right: 4, bottom: 0, left: -18 }}>
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={tokens.primary} stopOpacity={0.3} />
              <stop offset="100%" stopColor={tokens.primary} stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke={tokens.border} strokeDasharray="3 3" vertical={false} />
          <XAxis
            dataKey="label"
            tick={{ fill: tokens.textMuted, fontSize: 10, fontWeight: 500 }}
            axisLine={false}
            tickLine={false}
            dy={4}
            interval="preserveStartEnd"
          />
          <YAxis
            tick={{ fill: tokens.textMuted, fontSize: 10, fontWeight: 500 }}
            axisLine={false}
            tickLine={false}
            width={32}
            tickFormatter={(v) => (v >= 1000 ? `${(v / 1000).toFixed(0)}k` : v)}
          />
          <Area
            type="monotone"
            dataKey="value"
            stroke={tokens.primary}
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

export default VehicleDetailTrendChart
