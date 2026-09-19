import { useId } from 'react'
import {
  Area,
  AreaChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { useTheme } from '../../theme'

function SignalTooltip({ active, payload, label, tokens }) {
  if (!active || !payload?.length) return null
  return (
    <div
      style={{
        padding: '8px 12px',
        borderRadius: tokens.radius.sm,
        background: tokens.surface,
        border: `1px solid ${tokens.border}`,
        boxShadow: tokens.shadow.dropdown,
        fontSize: 12,
      }}
    >
      <div style={{ color: tokens.textMuted, fontWeight: 600, marginBottom: 6 }}>{label}</div>
      {payload.map((entry) => (
        <div
          key={entry.dataKey}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            color: tokens.text,
            fontWeight: 700,
            marginTop: 2,
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
          {entry.name}: {entry.value}
        </div>
      ))}
    </div>
  )
}

/** Isolated so recharts stays out of the maintenance overview chunk until needed. */
export default function MaintenanceSignalHistoryChart({ data }) {
  const { tokens } = useTheme()
  const odoGradientId = useId()
  const hoursGradientId = useId()

  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={data} margin={{ top: 8, right: 12, bottom: 4, left: 0 }}>
        <defs>
          <linearGradient id={odoGradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={tokens.primary} stopOpacity={0.35} />
            <stop offset="100%" stopColor={tokens.primary} stopOpacity={0} />
          </linearGradient>
          <linearGradient id={hoursGradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={tokens.semantic.warning} stopOpacity={0.3} />
            <stop offset="100%" stopColor={tokens.semantic.warning} stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid
          stroke={tokens.border}
          strokeDasharray="3 3"
          vertical={false}
        />
        <XAxis
          dataKey="label"
          tick={{ fill: tokens.textMuted, fontSize: 11, fontWeight: 600 }}
          axisLine={false}
          tickLine={false}
          dy={6}
        />
        <YAxis
          yAxisId="km"
          tick={{ fill: tokens.primary, fontSize: 10, fontWeight: 600 }}
          axisLine={false}
          tickLine={false}
          width={44}
          tickFormatter={(v) => `${v}`}
        />
        <YAxis
          yAxisId="hrs"
          orientation="right"
          tick={{ fill: tokens.semantic.warning, fontSize: 10, fontWeight: 600 }}
          axisLine={false}
          tickLine={false}
          width={36}
          tickFormatter={(v) => `${v}`}
        />
        <Tooltip content={<SignalTooltip tokens={tokens} />} />
        <Legend
          verticalAlign="bottom"
          height={28}
          iconType="circle"
          iconSize={8}
          formatter={(value) => (
            <span style={{ color: tokens.textSecondary, fontSize: 11, fontWeight: 600 }}>
              {value}
            </span>
          )}
        />
        <Area
          yAxisId="km"
          type="monotone"
          dataKey="odometer"
          name="Odometer (km)"
          stroke={tokens.primary}
          strokeWidth={2.5}
          fill={`url(#${odoGradientId})`}
          dot={{ r: 3.5, fill: tokens.primary, strokeWidth: 0 }}
          connectNulls
          isAnimationActive={false}
        />
        <Area
          yAxisId="hrs"
          type="monotone"
          dataKey="hours"
          name="Engine hours"
          stroke={tokens.semantic.warning}
          strokeWidth={2.5}
          fill={`url(#${hoursGradientId})`}
          dot={{ r: 3.5, fill: tokens.semantic.warning, strokeWidth: 0 }}
          connectNulls
          isAnimationActive={false}
        />
      </AreaChart>
    </ResponsiveContainer>
  )
}
