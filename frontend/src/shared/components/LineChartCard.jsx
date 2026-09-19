import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { useId } from 'react'
import { useTheme } from '../../theme'
import { Card } from './Card'
import { Skeleton } from './Feedback'

function ChartTooltip({ active, payload, label, tokens, formatter }) {
  if (!active || !payload?.length) return null
  const raw = payload[0].value
  const display = formatter ? formatter(raw) : raw
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
      <div style={{ color: tokens.textMuted, fontWeight: 600, marginBottom: 2 }}>
        {label}
      </div>
      <div style={{ color: tokens.text, fontWeight: 700 }}>
        {display}
      </div>
    </div>
  )
}

/**
 * Trend line chart inside an elevated card — utilization, fuel, etc.
 */
export function LineChartCard({
  title,
  subtitle,
  right,
  data = [],
  xKey = 'label',
  yKey = 'value',
  color,
  height = 220,
  loading = false,
  skeletonLines = 4,
  yFormatter,
  yDomain,
  yTicks,
  showGrid = true,
  gridDasharray = '3 3',
  showDots = true,
  variant = 'area',
  className,
  style,
  children,
}) {
  const { tokens } = useTheme()
  const gradientId = useId()
  const stroke = color || tokens.primary

  return (
    <Card
      title={title}
      subtitle={subtitle}
      right={right}
      loading={loading}
      skeletonLines={skeletonLines}
      className={className}
      style={style}
    >
      {loading ? (
        <Skeleton height={height} style={{ borderRadius: tokens.radius.sm }} />
      ) : data.length === 0 ? (
        children || (
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
            No data yet
          </div>
        )
      ) : (
        <div style={{ width: '100%', height }}>
          <ResponsiveContainer width="100%" height="100%">
            {variant === 'bar' ? (
              <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 4 }}>
                {showGrid && (
                  <CartesianGrid
                    stroke={tokens.border}
                    strokeDasharray={gridDasharray}
                    vertical={false}
                  />
                )}
                <XAxis
                  dataKey={xKey}
                  tick={{ fill: tokens.textMuted, fontSize: 11, fontWeight: 600 }}
                  axisLine={false}
                  tickLine={false}
                  dy={6}
                />
                <YAxis
                  tick={{ fill: tokens.textMuted, fontSize: 11, fontWeight: 600 }}
                  axisLine={false}
                  tickLine={false}
                  tickFormatter={yFormatter}
                  width={56}
                  domain={yDomain}
                  ticks={yTicks}
                />
                <Tooltip
                  content={<ChartTooltip tokens={tokens} formatter={yFormatter} />}
                  cursor={{ fill: tokens.primarySoft }}
                />
                <Bar dataKey={yKey} fill={stroke} radius={[6, 6, 0, 0]} maxBarSize={36} />
              </BarChart>
            ) : (
              <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 4 }}>
                <defs>
                  <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={stroke} stopOpacity={0.35} />
                    <stop offset="100%" stopColor={stroke} stopOpacity={0} />
                  </linearGradient>
                </defs>
                {showGrid && (
                  <CartesianGrid
                    stroke={tokens.border}
                    strokeDasharray={gridDasharray}
                    vertical={false}
                  />
                )}
                <XAxis
                  dataKey={xKey}
                  tick={{ fill: tokens.textMuted, fontSize: 11, fontWeight: 600 }}
                  axisLine={false}
                  tickLine={false}
                  dy={6}
                />
                <YAxis
                  tick={{ fill: tokens.textMuted, fontSize: 11, fontWeight: 600 }}
                  axisLine={false}
                  tickLine={false}
                  tickFormatter={yFormatter}
                  width={56}
                  domain={yDomain}
                  ticks={yTicks}
                />
                <Tooltip
                  content={<ChartTooltip tokens={tokens} formatter={yFormatter} />}
                  cursor={{ stroke: tokens.border, strokeWidth: 1 }}
                />
                <Area
                  type="monotone"
                  dataKey={yKey}
                  stroke={stroke}
                  strokeWidth={3}
                  fill={`url(#${gradientId})`}
                  dot={showDots ? { r: 3, fill: stroke, strokeWidth: 0 } : false}
                  activeDot={{ r: 5, fill: stroke, stroke: tokens.surface, strokeWidth: 2 }}
                />
              </AreaChart>
            )}
          </ResponsiveContainer>
        </div>
      )}
    </Card>
  )
}

export default LineChartCard
