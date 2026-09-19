import { Cell, Pie, PieChart, ResponsiveContainer } from 'recharts'
import { useTheme } from '../../theme'

/**
 * Donut chart with legend. segments: [{ key, label, value, color }]
 */
export function DonutChart({
  segments = [],
  size = 140,
  thickness = 18,
  centerLabel,
  centerValue,
  showLegend = true,
  legendPosition = 'side',
  showPercentInLegend = true,
  showValueInLegend = true,
  emptyLabel = 'No data',
}) {
  const { tokens } = useTheme()

  const total = segments.reduce((sum, s) => sum + (Number(s.value) || 0), 0)
  const outerRadius = size / 2
  const innerRadius = Math.max(outerRadius - thickness, 0)

  const chartData = segments
    .filter((seg) => Number(seg.value) > 0)
    .map((seg) => ({
      ...seg,
      value: Number(seg.value) || 0,
    }))

  const legendBelow = legendPosition === 'bottom'

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: legendBelow ? 'column' : 'row',
        alignItems: legendBelow ? 'center' : 'center',
        gap: legendBelow ? 16 : 16,
        flexWrap: legendBelow ? 'wrap' : 'nowrap',
        minWidth: 0,
        width: '100%',
      }}
    >
      <div style={{ position: 'relative', width: size, height: size, flexShrink: 0 }}>
        {total > 0 ? (
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={chartData}
                dataKey="value"
                nameKey="label"
                cx="50%"
                cy="50%"
                innerRadius={innerRadius}
                outerRadius={outerRadius}
                paddingAngle={chartData.length > 1 ? 1.5 : 0}
                stroke="none"
                isAnimationActive={false}
              >
                {chartData.map((seg) => (
                  <Cell key={seg.key || seg.label} fill={seg.color} />
                ))}
              </Pie>
            </PieChart>
          </ResponsiveContainer>
        ) : (
          <div
            style={{
              width: size,
              height: size,
              borderRadius: '50%',
              border: `${thickness}px solid ${tokens.border}`,
              boxSizing: 'border-box',
            }}
          />
        )}

        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            pointerEvents: 'none',
            textAlign: 'center',
            padding: thickness,
          }}
        >
          {centerValue != null && (
            <div style={{ fontSize: 20, fontWeight: 800, color: tokens.text, lineHeight: 1.1 }}>
              {centerValue}
            </div>
          )}
          {centerLabel && (
            <div style={{ fontSize: 11, fontWeight: 600, color: tokens.textMuted, marginTop: 2 }}>
              {centerLabel}
            </div>
          )}
          {total === 0 && !centerValue && (
            <div style={{ fontSize: 12, color: tokens.textMuted }}>{emptyLabel}</div>
          )}
        </div>
      </div>

      {showLegend && (
        <div
          className={legendBelow ? 'ft-donut-legend--bottom' : undefined}
          style={{
            display: 'flex',
            flexDirection: 'column',
            flexWrap: 'nowrap',
            justifyContent: legendBelow ? 'center' : 'flex-start',
            gap: 8,
            minWidth: legendBelow ? 168 : 148,
            maxWidth: legendBelow ? 220 : undefined,
            flex: legendBelow ? undefined : '1 0 148px',
            width: legendBelow ? '100%' : undefined,
          }}
        >
          {segments.map((seg) => {
            const value = Number(seg.value) || 0
            const pct = total > 0 ? Math.round((value / total) * 100) : 0
            const showPct = showPercentInLegend && seg.showPercent !== false && total > 0
            return (
              <div
                key={seg.key || seg.label}
                className="ft-donut-legend-item"
                style={{
                  display: 'grid',
                  gridTemplateColumns: '8px minmax(64px, 1fr) auto',
                  alignItems: 'center',
                  columnGap: 8,
                  width: '100%',
                  fontSize: 13,
                }}
              >
                <span
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: '50%',
                    background: seg.color,
                    flexShrink: 0,
                  }}
                />
                <span style={{ color: tokens.textSecondary, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {seg.label}
                </span>
                {showValueInLegend && (
                  <span
                    style={{
                      fontWeight: 700,
                      color: tokens.text,
                      textAlign: 'right',
                      whiteSpace: 'nowrap',
                      fontVariantNumeric: 'tabular-nums',
                    }}
                  >
                    {value}
                    {showPct ? (
                      <span style={{ fontWeight: 500, color: tokens.textMuted }}> ({pct}%)</span>
                    ) : null}
                  </span>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

export default DonutChart
