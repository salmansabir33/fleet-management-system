import { useId } from 'react'
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { Card } from '../../../shared/components'
import { Skeleton } from '../../../shared/components/Feedback'
import { useTheme } from '../../../theme'

const SERIES = [
  { key: 'distance', name: 'Distance (km)', color: '#4f46e5' },
  { key: 'fuel', name: 'Fuel (L)', color: '#059669' },
]

function UsageTooltip({ active, payload, label, tokens }) {
  if (!active || !payload?.length) return null
  return (
    <div
      style={{
        padding: '10px 12px',
        borderRadius: tokens.radius.sm,
        background: tokens.surface,
        border: `1px solid ${tokens.border}`,
        boxShadow: tokens.shadow.dropdown,
        fontSize: 12,
        minWidth: 168,
      }}
    >
      <div style={{ color: tokens.textMuted, fontWeight: 600, marginBottom: 6 }}>
        {label}
      </div>
      {payload.map((entry) => (
        <div
          key={entry.dataKey}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            marginTop: 4,
            color: tokens.text,
            fontWeight: 600,
          }}
        >
          <span
            style={{
              width: 8,
              height: 8,
              borderRadius: '50%',
              background: entry.color,
              flexShrink: 0,
            }}
          />
          <span style={{ flex: 1 }}>{entry.name}</span>
          <span>{entry.value}</span>
        </div>
      ))}
    </div>
  )
}

export function ManagerUsageChart({
  data = [],
  insights = [],
  loading = false,
  height = 280,
}) {
  const { tokens } = useTheme()
  const distanceFill = useId()
  const fuelFill = useId()
  const hasData = data.some((row) => row.distance > 0 || row.fuel > 0)

  return (
    <Card
      className="ft-md-chart"
      title="Assigned Vehicles Usage"
      subtitle="This week · distance and fuel"
    >
      {insights.length > 0 && !loading && (
        <div className="ft-md-insights">
          {insights.map((item) => (
            <div key={item.key} className="ft-md-insight">
              <span
                className="ft-md-insight__dot"
                style={{ background: item.color }}
                aria-hidden
              />
              <span className="ft-md-insight__label">{item.label}</span>
              <span className="ft-md-insight__value">{item.value}</span>
            </div>
          ))}
        </div>
      )}

      {loading ? (
        <Skeleton height={height} style={{ borderRadius: tokens.radius.sm }} />
      ) : !hasData ? (
        <div
          style={{
            height,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: tokens.textMuted,
            fontSize: 13,
          }}
        >
          No trip data this week yet
        </div>
      ) : (
        <div style={{ width: '100%', height }}>
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -4 }}>
              <defs>
                <linearGradient id={distanceFill} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={SERIES[0].color} stopOpacity={0.32} />
                  <stop offset="100%" stopColor={SERIES[0].color} stopOpacity={0} />
                </linearGradient>
                <linearGradient id={fuelFill} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={SERIES[1].color} stopOpacity={0.28} />
                  <stop offset="100%" stopColor={SERIES[1].color} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke={tokens.border} vertical={false} />
              <XAxis
                dataKey="label"
                tick={{ fill: tokens.textMuted, fontSize: 11, fontWeight: 600 }}
                axisLine={false}
                tickLine={false}
                dy={6}
              />
              <YAxis
                tick={{ fill: tokens.textMuted, fontSize: 11, fontWeight: 600 }}
                axisLine={false}
                tickLine={false}
                width={40}
              />
              <Tooltip content={<UsageTooltip tokens={tokens} />} />
              <Legend
                verticalAlign="top"
                align="right"
                iconType="circle"
                iconSize={8}
                wrapperStyle={{ fontSize: 12, fontWeight: 600, paddingBottom: 10 }}
              />
              <Area
                type="monotone"
                dataKey="distance"
                name={SERIES[0].name}
                stroke={SERIES[0].color}
                strokeWidth={2.5}
                fill={`url(#${distanceFill})`}
                dot={false}
                activeDot={{ r: 4, strokeWidth: 0 }}
              />
              <Area
                type="monotone"
                dataKey="fuel"
                name={SERIES[1].name}
                stroke={SERIES[1].color}
                strokeWidth={2.5}
                fill={`url(#${fuelFill})`}
                dot={false}
                activeDot={{ r: 4, strokeWidth: 0 }}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}
    </Card>
  )
}

export default ManagerUsageChart
