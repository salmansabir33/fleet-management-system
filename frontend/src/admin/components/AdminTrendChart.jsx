import { useEffect, useId, useMemo, useState } from 'react'
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { useTheme } from '../../theme'
import { Select } from '../../shared/components/Form'
import { Skeleton } from '../../shared/components/Feedback'
import { TREND_PERIODS } from '../utils/dashboardPeriod'

const ANIM_MS = 600

function trimNum(n) {
  if (Number.isInteger(n)) return String(n)
  return n.toFixed(1).replace(/\.0$/, '')
}

function fmtCompact(value) {
  const n = Number(value)
  if (!Number.isFinite(n)) return '0'
  const abs = Math.abs(n)
  if (abs >= 1_000_000) return `${trimNum(n / 1_000_000)}M`
  if (abs >= 1_000) return `${trimNum(n / 1_000)}k`
  return trimNum(n)
}

function fmtFull(value, item) {
  const n = Number(value)
  const safe = Number.isFinite(n) ? n : 0
  if (item.format === 'pkr') {
    return `PKR ${Math.round(safe).toLocaleString()}`
  }
  const formatted = safe.toLocaleString(undefined, {
    maximumFractionDigits: item.key === 'visits' ? 0 : 1,
  })
  if (item.key === 'visits') return `${formatted} ${safe === 1 ? 'visit' : 'visits'}`
  return item.unit ? `${formatted} ${item.unit}` : formatted
}

function fmtChip(sum, item) {
  if (item.format === 'pkr') return `PKR ${fmtCompact(sum)}`
  if (item.unit) return `${fmtCompact(sum)} ${item.unit}`
  return fmtCompact(sum)
}

function fmtAxisTick(value, item) {
  if (item?.format === 'pkr') return fmtCompact(value)
  if (item?.unit === 'km') return fmtCompact(value)
  return fmtCompact(value)
}

/** Keep bars narrow with generous category gaps; stay readable when dense. */
function barLayout(pointCount, seriesCount) {
  const dense = pointCount > 20
  const medium = pointCount > 10
  return {
    maxBarSize: dense ? 10 : medium ? 16 : 26,
    barCategoryGap: dense ? '28%' : medium ? '34%' : '44%',
    barGap: seriesCount > 1 ? (dense ? 2 : 4) : 0,
    radius: dense ? [4, 4, 0, 0] : [7, 7, 0, 0],
  }
}

function TrendTooltip({ active, payload, label, tokens, seriesByKey }) {
  if (!active || !payload?.length) return null
  // Bar + Line share the same dataKey — keep one row per metric.
  const seen = new Set()
  const rows = payload.filter((entry) => {
    if (seen.has(entry.dataKey)) return false
    seen.add(entry.dataKey)
    return seriesByKey[entry.dataKey]
  })
  if (!rows.length) return null
  return (
    <div
      className="ft-admin-trend-chart__tooltip"
      style={{
        padding: '10px 12px',
        borderRadius: 10,
        background: tokens.surface,
        border: `1px solid ${tokens.border}`,
        boxShadow: '0 4px 14px rgba(17, 24, 39, 0.08)',
        fontSize: 12,
        minWidth: 156,
        lineHeight: 1.35,
      }}
    >
      <div
        style={{
          color: tokens.textMuted,
          fontWeight: 600,
          marginBottom: 6,
          letterSpacing: '-0.01em',
        }}
      >
        {label}
      </div>
      {rows.map((entry) => {
        const item = seriesByKey[entry.dataKey]
        return (
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
                borderRadius: 2,
                background: item.color,
                flexShrink: 0,
              }}
            />
            <span style={{ flex: 1, color: tokens.textSecondary, fontWeight: 600 }}>
              {entry.name}
            </span>
            <span style={{ fontWeight: 700 }}>{fmtFull(entry.value, item)}</span>
          </div>
        )
      })}
    </div>
  )
}

/** Single-metric series used on the simplified admin dashboard. */
export const FLEET_DISTANCE_SERIES = [
  {
    key: 'distance',
    name: 'Distance (km)',
    chipLabel: 'Distance',
    color: '#4f46e5',
    gradientTop: '#3730a3',
    gradientBottom: '#a5b4fc',
    yAxisId: 'left',
    format: 'number',
    unit: 'km',
  },
]

export const FLEET_FUEL_COST_SERIES = [
  {
    key: 'fuelCost',
    name: 'Fuel Cost (PKR)',
    chipLabel: 'Fuel Cost',
    color: '#d97706',
    gradientTop: '#b45309',
    gradientBottom: '#fcd34d',
    yAxisId: 'left',
    format: 'pkr',
  },
]

/** Default dashboard fleet series (distance + fuel cost, no dual-axis liters). */
export const FLEET_TREND_SERIES = [
  ...FLEET_DISTANCE_SERIES,
  ...FLEET_FUEL_COST_SERIES,
]

export const MAINTENANCE_TREND_SERIES = [
  {
    key: 'visits',
    name: 'Visits',
    chipLabel: 'Visits',
    color: '#0f766e',
    gradientTop: '#0f766e',
    gradientBottom: '#5eead4',
    yAxisId: 'left',
    format: 'number',
  },
  {
    key: 'cost',
    name: 'Cost (PKR)',
    chipLabel: 'Cost',
    color: '#d97706',
    gradientTop: '#b45309',
    gradientBottom: '#fcd34d',
    yAxisId: 'right',
    format: 'pkr',
  },
]

export function AdminTrendChart({
  title = 'Fleet Trends',
  data = [],
  period,
  onPeriodChange,
  loading = false,
  height = 200,
  fill = false,
  series = FLEET_TREND_SERIES,
  emptyMessage = 'No trip data for this period',
  className,
  periodAriaLabel = 'Trend period',
  showPeriodSelect = true,
}) {
  const { tokens } = useTheme()
  const gradientUid = useId().replace(/:/g, '')
  const [tooltipTrigger, setTooltipTrigger] = useState('hover')
  const [reduceMotion, setReduceMotion] = useState(false)
  const hasRightAxis = series.some((item) => item.yAxisId === 'right')
  const leftSeries = series.find((item) => (item.yAxisId || 'left') === 'left') || series[0]
  const rightSeries = series.find((item) => item.yAxisId === 'right')
  const hasData = data.some((row) =>
    series.some((item) => Number(row[item.key]) > 0),
  )
  const seriesByKey = useMemo(
    () => Object.fromEntries(series.map((item) => [item.key, item])),
    [series],
  )
  const totals = useMemo(() => {
    if (!hasData) return []
    return series.map((item) => ({
      key: item.key,
      label: item.chipLabel || item.name,
      color: item.color,
      value: fmtChip(
        data.reduce((acc, row) => acc + (Number(row[item.key]) || 0), 0),
        item,
      ),
    }))
  }, [data, hasData, series])

  const layout = useMemo(
    () => barLayout(data.length, series.length),
    [data.length, series.length],
  )

  const animate = !reduceMotion
  const dense = data.length > 20
  const dotR = dense ? 2.25 : 3.25

  useEffect(() => {
    const pointerMq = window.matchMedia('(pointer: coarse)')
    const motionMq = window.matchMedia('(prefers-reduced-motion: reduce)')
    const syncPointer = () => setTooltipTrigger(pointerMq.matches ? 'click' : 'hover')
    const syncMotion = () => setReduceMotion(motionMq.matches)
    syncPointer()
    syncMotion()
    pointerMq.addEventListener('change', syncPointer)
    motionMq.addEventListener('change', syncMotion)
    return () => {
      pointerMq.removeEventListener('change', syncPointer)
      motionMq.removeEventListener('change', syncMotion)
    }
  }, [])

  const classes = [
    'ft-admin-widget',
    'ft-admin-trend-chart',
    fill && 'ft-admin-trend-chart--fill',
    className,
  ].filter(Boolean).join(' ')

  const yTick = {
    fill: tokens.textDisabled || '#9ca3af',
    fontSize: 11,
    fontWeight: 500,
  }
  const xTick = {
    fill: tokens.textSecondary || '#4b5563',
    fontSize: 11,
    fontWeight: 600,
  }
  const cursorFill = tokens.background || 'rgba(15, 23, 42, 0.04)'
  const gridStroke = tokens.border || '#e5e7eb'

  return (
    <div className={classes}>
      {(title || showPeriodSelect) && (
        <div className="ft-admin-trend-chart__head">
          {title ? <h3 className="ft-admin-widget__title">{title}</h3> : <span />}
          {showPeriodSelect && (
            <Select
              value={period}
              onChange={(e) => onPeriodChange?.(e.target.value)}
              className="ft-admin-trend-chart__select"
              aria-label={periodAriaLabel}
            >
              {TREND_PERIODS.map((p) => (
                <option key={p.key} value={p.key}>{p.label}</option>
              ))}
            </Select>
          )}
        </div>
      )}

      {!loading && hasData && totals.length > 0 && (
        <div className="ft-admin-trend-chart__totals">
          {totals.map((item) => (
            <div key={item.key} className="ft-admin-trend-chart__total">
              <span
                className="ft-admin-trend-chart__total-dot"
                style={{ background: item.color }}
                aria-hidden
              />
              <span className="ft-admin-trend-chart__total-label">{item.label}</span>
              <span className="ft-admin-trend-chart__total-value">{item.value}</span>
            </div>
          ))}
        </div>
      )}

      {loading ? (
        <Skeleton height={fill ? '100%' : height} style={{ borderRadius: tokens.radius.sm, flex: fill ? 1 : undefined }} />
      ) : !hasData ? (
        <div
          className="ft-admin-trend-chart__empty"
          style={{ height: fill ? '100%' : height, color: tokens.textMuted, flex: fill ? 1 : undefined }}
        >
          {emptyMessage}
        </div>
      ) : (
        <div
          className="ft-admin-trend-chart__plot"
          style={{ width: '100%', height: fill ? '100%' : height, flex: fill ? 1 : undefined, minHeight: fill ? 0 : undefined }}
        >
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart
              data={data}
              margin={{ top: 8, right: hasRightAxis ? 12 : 6, bottom: 2, left: 0 }}
              barCategoryGap={layout.barCategoryGap}
              barGap={layout.barGap}
            >
              <defs>
                {series.map((item) => {
                  const id = `bar-fill-${gradientUid}-${item.key}`
                  const top = item.gradientTop || item.color
                  const bottom = item.gradientBottom || item.color
                  return (
                    <linearGradient key={id} id={id} x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={top} stopOpacity={1} />
                      <stop offset="55%" stopColor={item.color} stopOpacity={0.92} />
                      <stop offset="100%" stopColor={bottom} stopOpacity={0.85} />
                    </linearGradient>
                  )
                })}
              </defs>
              <CartesianGrid
                stroke={gridStroke}
                strokeDasharray="4 4"
                strokeOpacity={0.7}
                vertical={false}
              />
              <XAxis
                dataKey="label"
                tick={xTick}
                axisLine={false}
                tickLine={false}
                dy={6}
                interval={data.length > 12 ? 'preserveStartEnd' : 0}
                minTickGap={data.length > 14 ? 22 : 14}
                angle={0}
                height={28}
              />
              <YAxis
                yAxisId="left"
                tick={yTick}
                axisLine={false}
                tickLine={false}
                tickCount={4}
                tickFormatter={(value) => fmtAxisTick(value, leftSeries)}
                width={44}
              />
              {hasRightAxis && rightSeries && (
                <YAxis
                  yAxisId="right"
                  orientation="right"
                  tick={yTick}
                  axisLine={false}
                  tickLine={false}
                  tickCount={4}
                  tickFormatter={(value) => fmtAxisTick(value, rightSeries)}
                  width={44}
                />
              )}
              <Tooltip
                content={<TrendTooltip tokens={tokens} seriesByKey={seriesByKey} />}
                cursor={{ fill: cursorFill, radius: 4 }}
                trigger={tooltipTrigger}
                wrapperStyle={{ outline: 'none' }}
              />
              {series.map((item) => {
                const gradientId = `bar-fill-${gradientUid}-${item.key}`
                return (
                  <Bar
                    key={`bar-${item.key}`}
                    yAxisId={item.yAxisId || 'left'}
                    dataKey={item.key}
                    name={item.name}
                    fill={`url(#${gradientId})`}
                    maxBarSize={layout.maxBarSize}
                    radius={layout.radius}
                    isAnimationActive={animate}
                    animationDuration={ANIM_MS}
                    animationEasing="ease-out"
                  />
                )
              })}
              {series.map((item) => (
                <Line
                  key={`line-${item.key}`}
                  yAxisId={item.yAxisId || 'left'}
                  type="linear"
                  dataKey={item.key}
                  name={item.name}
                  stroke={item.color}
                  strokeWidth={2}
                  strokeDasharray="5 4"
                  strokeOpacity={0.72}
                  dot={{
                    r: dotR,
                    fill: item.color,
                    stroke: tokens.surface,
                    strokeWidth: 1.5,
                  }}
                  activeDot={{
                    r: dotR + 1.5,
                    fill: item.color,
                    stroke: tokens.surface,
                    strokeWidth: 2,
                  }}
                  isAnimationActive={animate}
                  animationDuration={ANIM_MS}
                  animationBegin={animate ? 80 : 0}
                  animationEasing="ease-out"
                  legendType="none"
                />
              ))}
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  )
}

export default AdminTrendChart
