import { useEffect, useMemo, useState } from 'react'
import { Navigate, useOutletContext } from 'react-router-dom'
import { ChevronDown } from 'lucide-react'
import api from '../../api'
import { useTheme } from '../../theme'
import { hexToRgba } from '../../shared/utils'
import {
  Card,
  Button,
  Input,
  Badge,
  Table,
  TableRow,
  LoadingState,
  EmptyState,
} from '../../shared/components'
import { useMaintenanceVehicleId } from '../hooks/useMaintenanceVehicleId'
import { useMediaQuery } from '../hooks/useMediaQuery'
import { fetchMaintenanceRecords } from '../utils/maintenanceRecordsCache'

const fmtNumber = (n) => (n == null ? '—' : Number(n).toLocaleString(undefined, { maximumFractionDigits: 1 }))
const fmtRs = (n) => (n == null ? '—' : `Rs ${fmtNumber(n)}`)
const fmtRsCompact = (n) => (n == null ? '—' : fmtNumber(n))

const DUE_STATUS_META = {
  ok: { label: 'OK', token: 'ok' },
  due_soon: { label: 'Due soon', token: 'dueSoon' },
  overdue: { label: 'Overdue', token: 'overdue' },
  no_baseline: { label: 'No data', token: 'noBaseline' },
  unknown: { label: 'Unknown', token: 'unknown' },
}

const formatRemaining = (line) => {
  if (
    line == null
    || line.interval_value == null
    || line.current_value == null
    || line.last_service_value == null
  ) {
    return null
  }
  const elapsed = Math.max(0, Number(line.current_value) - Number(line.last_service_value))
  const remaining = Number(line.interval_value) - elapsed
  if (!Number.isFinite(remaining)) return null

  const unit = line.dimension === 'distance' ? 'km' : 'hrs'
  const abs = Math.abs(remaining)
  const formatted = abs >= 100
    ? Math.round(abs).toLocaleString()
    : (Math.round(abs * 10) / 10).toLocaleString()

  if (remaining > 0.05) return `${formatted} ${unit} remaining`
  if (remaining < -0.05) return `${formatted} ${unit} over`
  return `0 ${unit} remaining`
}

const STATUS_SORT_RANK = {
  overdue: 0,
  due_soon: 1,
  no_baseline: 2,
  unknown: 3,
  ok: 4,
}

const summarizeDueLines = (lines) => {
  const counts = { overdue: 0, due_soon: 0, ok: 0, other: 0 }
  for (const line of lines || []) {
    if (line.status === 'overdue') counts.overdue += 1
    else if (line.status === 'due_soon') counts.due_soon += 1
    else if (line.status === 'ok') counts.ok += 1
    else counts.other += 1
  }
  return counts
}

const formatDueSummary = (counts) => {
  const parts = []
  if (counts.overdue) parts.push(`${counts.overdue} overdue`)
  if (counts.due_soon) parts.push(`${counts.due_soon} due soon`)
  if (counts.ok) parts.push(`${counts.ok} OK`)
  if (counts.other) parts.push(`${counts.other} other`)
  return parts.length ? parts.join(' · ') : 'No data'
}

const sortDueLinesForCard = (lines) => (
  [...(lines || [])].sort((a, b) => {
    const ra = STATUS_SORT_RANK[a.status] ?? 9
    const rb = STATUS_SORT_RANK[b.status] ?? 9
    if (ra !== rb) return ra - rb
    return String(a.label || '').localeCompare(String(b.label || ''))
  })
)

const DueStatusPill = ({ line, tokens }) => {
  if (!line || line.status === 'unknown') {
    return <span className="md-due-pill md-due-pill--muted">—</span>
  }

  const meta = DUE_STATUS_META[line.status] || DUE_STATUS_META.unknown
  const color = tokens.maintenanceState[meta.token] || tokens.textMuted
  const remaining = formatRemaining(line)
  const title = remaining ? `${meta.label} · ${remaining}` : meta.label

  return (
    <span
      className="md-due-pill"
      title={title}
      style={{
        color,
        borderColor: color,
        background: hexToRgba(color, 0.08),
      }}
    >
      <span className="md-due-cell-status">{meta.label}</span>
      {remaining && <span className="md-due-cell-remain">{remaining}</span>}
    </span>
  )
}

const DueStatusCell = ({ line, tokens }) => (
  <td className="md-due-cell">
    <DueStatusPill line={line} tokens={tokens} />
  </td>
)

/** Short column headers for the pivoted history table; full label in title tooltip. */
const SERVICE_COLUMN_SHORT_LABELS = {
  engine_oil: 'Eng Oil',
  air_filter: 'Air Filt',
  ac_filter: 'AC Filt',
  fuel_filter: 'Fuel Filt',
  tyres: 'Tyres',
  brake_pads: 'Brk Pads',
  brake_fluid: 'Brk Fluid',
  coolant: 'Coolant',
  battery: 'Battery',
  spark_plugs: 'Sp Plugs',
  wiper_blades: 'Wipers',
  wheel_alignment: 'Align/Bal',
}

const shortServiceLabel = (item) => (
  SERVICE_COLUMN_SHORT_LABELS[item.key] || item.label
)

const historyCardLines = (row, serviceItems) => {
  const lines = []
  for (const item of serviceItems) {
    const amount = row.byItem[item.item_id]
    if (amount == null) continue
    lines.push({ key: `item-${item.item_id}`, label: item.label, amount })
  }
  if (row.other != null) {
    lines.push({ key: 'other', label: 'Other', amount: row.other })
  }
  return lines
}

const doneLinesForRecord = (record) => {
  const lines = record.lines || []
  const checked = lines.filter((l) => l.checked)
  const priced = lines.filter((l) => Number(l.price) > 0)
  return checked.length ? checked : priced
}

const splitLines = (record, knownItemIds) => {
  const byItem = {}
  let other = null
  for (const line of doneLinesForRecord(record)) {
    const price = Number(line.price) || 0
    if (line.item_id != null && (!knownItemIds || knownItemIds.has(line.item_id))) {
      byItem[line.item_id] = (byItem[line.item_id] || 0) + price
    } else {
      other = (other ?? 0) + price
    }
  }
  return { byItem, other }
}

const MaintenanceReport = () => {
  const { deviceId, paths, isUserShell } = useMaintenanceVehicleId()
  const {
    refreshToken,
    status: sharedStatus,
    statusLoading,
    vehicle: sharedVehicle,
    records: sharedRecords,
    recordsLoading: sharedRecordsLoading,
  } = useOutletContext() || {}
  const { tokens } = useTheme()
  const isNarrow = useMediaQuery('(max-width: 640px)')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')

  const [dueColumns, setDueColumns] = useState([])
  const [dueRows, setDueRows] = useState([])
  const [records, setRecords] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [expandedHistoryIds, setExpandedHistoryIds] = useState(() => new Set())
  const [expandedDueDates, setExpandedDueDates] = useState(() => new Set())

  const hasBaseline = sharedStatus == null ? null : Boolean(sharedStatus.has_baseline)
  const serviceItems = sharedStatus?.items || []
  const deviceName = sharedVehicle?.name || 'Vehicle'
  const hasDateFilter = Boolean(startDate || endDate)

  const toggleHistoryCard = (id) => {
    setExpandedHistoryIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const toggleDueCard = (dateKey) => {
    setExpandedDueDates((prev) => {
      const next = new Set(prev)
      if (next.has(dateKey)) next.delete(dateKey)
      else next.add(dateKey)
      return next
    })
  }

  useEffect(() => {
    if (!deviceId) return undefined
    // Wait for layout-shared records when no date filter (avoid treating [] as final).
    if (!hasDateFilter && sharedRecordsLoading) return undefined

    let cancelled = false
    const load = async () => {
      setLoading(true)
      setError(null)
      try {
        const params = {}
        if (startDate) params.start = startDate
        if (endDate) params.end = endDate

        const duePromise = api.get(`/api/maintenance/devices/${deviceId}/due-report`, { params })
        const recordsPromise = hasDateFilter
          ? fetchMaintenanceRecords(deviceId, { params })
          : Promise.resolve({ data: { records: sharedRecords || [] } })

        const [dueRes, recordsRes] = await Promise.all([duePromise, recordsPromise])
        if (cancelled) return
        setDueColumns(dueRes.data.items || [])
        setDueRows(dueRes.data.rows || [])
        setRecords(recordsRes.data.records || [])
      } catch (err) {
        if (!cancelled) setError(err.response?.data?.detail || 'Failed to load maintenance report')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [
    deviceId,
    startDate,
    endDate,
    refreshToken,
    hasDateFilter,
    sharedRecords,
    sharedRecordsLoading,
  ])

  useEffect(() => {
    setExpandedHistoryIds(new Set())
  }, [deviceId, startDate, endDate, records])

  useEffect(() => {
    setExpandedDueDates(new Set())
  }, [deviceId, startDate, endDate, dueRows])

  const knownItemIds = useMemo(
    () => new Set(serviceItems.map((item) => item.item_id)),
    [serviceItems],
  )

  const historyRows = useMemo(() => (
    records.map((record) => {
      const { byItem, other } = splitLines(record, knownItemIds)
      return {
        id: record.id,
        vehicle: deviceName,
        date: record.record_date,
        byItem,
        other,
        cost: record.total_cost,
        isBaseline: record.is_baseline,
      }
    })
  ), [records, deviceName, knownItemIds])

  const showOther = useMemo(
    () => historyRows.some((row) => row.other != null),
    [historyRows],
  )

  const columnTotals = useMemo(() => {
    const byItem = {}
    serviceItems.forEach((item) => { byItem[item.item_id] = 0 })
    let other = 0
    let cost = 0
    historyRows.forEach((row) => {
      serviceItems.forEach((item) => {
        byItem[item.item_id] += row.byItem[item.item_id] || 0
      })
      other += row.other || 0
      cost += row.cost || 0
    })
    return { byItem, other, cost }
  }, [historyRows, serviceItems])

  const grandTotal = columnTotals.cost

  const historyColumns = useMemo(() => ([
    { key: 'vehicle', label: 'Vehicle', className: 'md-history-sticky-vehicle' },
    { key: 'date', label: 'Date', className: 'md-history-sticky-date' },
    ...serviceItems.map((item) => ({
      key: `item-${item.item_id}`,
      label: shortServiceLabel(item),
      title: item.label,
      align: 'right',
      className: 'md-history-service',
    })),
    ...(showOther ? [{ key: 'other', label: 'Other', align: 'right', className: 'md-history-service' }] : []),
    { key: 'cost', label: 'Cost', align: 'right', className: 'md-history-sticky-cost' },
  ]), [serviceItems, showOther])

  if (!deviceId) {
    if (isUserShell) {
      return (
        <EmptyState
          title="No vehicle assigned"
          description="This user does not have a vehicle yet."
        />
      )
    }
    return <Navigate to={paths.picker} replace />
  }
  if (statusLoading && sharedStatus == null) {
    return <LoadingState label="Loading maintenance…" />
  }
  if (hasBaseline === false) return <Navigate to={paths.baseline} replace />

  return (
    <div className="ft-page-stack">
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 14, flexWrap: 'wrap' }}>
        <Input
          label="From"
          type="date"
          value={startDate}
          onChange={(e) => setStartDate(e.target.value)}
          style={{ width: 160 }}
        />
        <Input
          label="To"
          type="date"
          value={endDate}
          onChange={(e) => setEndDate(e.target.value)}
          style={{ width: 160 }}
        />
        {(startDate || endDate) && (
          <Button variant="secondary" size="sm" onClick={() => { setStartDate(''); setEndDate('') }}>
            Clear
          </Button>
        )}
      </div>

      {error && (
        <div style={{
          padding: '8px 12px',
          borderRadius: tokens.radius.sm,
          background: hexToRgba(tokens.semantic.danger, 0.12),
          color: tokens.semantic.danger,
          fontSize: 13,
        }}
        >
          {error}
        </div>
      )}

      <Card
        title="Maintenance History"
        className={loading || historyRows.length === 0 ? undefined : 'md-history-card'}
        right={grandTotal > 0 ? (
          <span style={{ fontSize: 13, fontWeight: 700, color: tokens.text }}>
            Total: Rs {fmtNumber(grandTotal)}
          </span>
        ) : null}
        style={{ padding: loading || historyRows.length === 0 ? 18 : 0 }}
      >
        {loading ? (
          <LoadingState label="Loading…" />
        ) : historyRows.length === 0 ? (
          <EmptyState title="No maintenance records in this range." />
        ) : isNarrow ? (
          <div className="md-history-cards" aria-label="Maintenance history" style={{ display: 'flex' }}>
            <div className="md-history-cards-scroll">
              {historyRows.map((row) => {
                const lines = historyCardLines(row, serviceItems)
                const expanded = expandedHistoryIds.has(row.id)
                const canExpand = lines.length > 0
                return (
                  <article
                    key={row.id}
                    className={`md-history-card-item${expanded ? ' md-history-card-item--open' : ''}`}
                  >
                    <div className="md-history-card-head">
                      <div className="md-history-card-identity">
                        <span className="md-history-card-date">{row.date}</span>
                        {row.isBaseline && (
                          <Badge
                            color={tokens.semantic.info}
                            background={hexToRgba(tokens.semantic.info, 0.14)}
                            className="md-history-baseline-badge"
                          >
                            Base
                          </Badge>
                        )}
                      </div>
                      <span className="md-history-card-cost">
                        {row.cost != null ? fmtRs(row.cost) : '—'}
                      </span>
                    </div>
                    <div className="md-history-card-meta">{row.vehicle}</div>
                    {canExpand && (
                      <button
                        type="button"
                        className="md-history-card-details-btn"
                        aria-expanded={expanded}
                        onClick={() => toggleHistoryCard(row.id)}
                      >
                        {expanded ? 'Hide details' : 'Details'}
                        <ChevronDown size={14} className="md-history-card-details-chevron" />
                      </button>
                    )}
                    {canExpand && expanded && (
                      <div className="md-history-card-lines">
                        {lines.map((line) => (
                          <div key={line.key} className="md-history-card-line">
                            <span className="md-history-card-line-label">{line.label}</span>
                            <span className="md-history-card-line-value">{fmtRs(line.amount)}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </article>
                )
              })}
            </div>
            <div className="md-history-cards-total">
              <span>Total</span>
              <strong>{fmtRs(columnTotals.cost)}</strong>
            </div>
          </div>
        ) : (
          <Table
            className="md-history-table"
            columns={historyColumns}
            style={{ display: 'block' }}
            footer={(
              <tr>
                <td className="md-history-sticky-vehicle">Total</td>
                <td className="md-history-sticky-date md-history-empty">—</td>
                {serviceItems.map((item) => (
                  <td key={item.item_id} className="md-history-service md-history-cell-num">
                    {fmtRsCompact(columnTotals.byItem[item.item_id] || 0)}
                  </td>
                ))}
                {showOther && (
                  <td className="md-history-service md-history-cell-num">
                    {fmtRsCompact(columnTotals.other)}
                  </td>
                )}
                <td className="md-history-sticky-cost md-history-cell-cost">
                  {fmtRs(columnTotals.cost)}
                </td>
              </tr>
            )}
          >
            {historyRows.map((row) => (
              <TableRow key={row.id}>
                <td className="md-history-sticky-vehicle md-history-cell-vehicle" title={row.vehicle}>
                  {row.vehicle}
                </td>
                <td className="md-history-sticky-date">
                  <span className="md-history-date">{row.date}</span>
                  {row.isBaseline && (
                    <Badge
                      color={tokens.semantic.info}
                      background={hexToRgba(tokens.semantic.info, 0.14)}
                      className="md-history-baseline-badge"
                    >
                      Base
                    </Badge>
                  )}
                </td>
                {serviceItems.map((item) => {
                  const amount = row.byItem[item.item_id]
                  return (
                    <td
                      key={item.item_id}
                      className={`md-history-service md-history-cell-num${amount == null ? ' md-history-empty' : ''}`}
                      title={amount != null ? `${item.label}: Rs ${fmtNumber(amount)}` : undefined}
                    >
                      {fmtRsCompact(amount)}
                    </td>
                  )
                })}
                {showOther && (
                  <td
                    className={`md-history-service md-history-cell-num${row.other == null ? ' md-history-empty' : ''}`}
                    title={row.other != null ? `Other: Rs ${fmtNumber(row.other)}` : undefined}
                  >
                    {fmtRsCompact(row.other)}
                  </td>
                )}
                <td className="md-history-sticky-cost md-history-cell-cost">
                  {row.cost != null ? fmtRs(row.cost) : '—'}
                </td>
              </TableRow>
            ))}
          </Table>
        )}
      </Card>

      {dueRows.length > 0 && (
        <Card title="Due Status Snapshots" className="md-due-card">
          {isNarrow ? (
            <div className="md-due-cards" aria-label="Due status snapshots" style={{ display: 'flex' }}>
              <div className="md-due-cards-scroll">
                {dueRows.map((row) => {
                  const dateKey = String(row.snapshot_date)
                  const counts = summarizeDueLines(row.lines)
                  const sortedLines = sortDueLinesForCard(row.lines)
                  const expanded = expandedDueDates.has(dateKey)
                  return (
                    <article
                      key={dateKey}
                      className={`md-due-card-item${expanded ? ' md-due-card-item--open' : ''}`}
                    >
                      <div className="md-due-card-head">
                        <span className="md-due-card-date">{row.snapshot_date}</span>
                      </div>
                      <div className="md-due-card-summary">{formatDueSummary(counts)}</div>
                      <button
                        type="button"
                        className="md-due-card-details-btn"
                        aria-expanded={expanded}
                        onClick={() => toggleDueCard(dateKey)}
                      >
                        {expanded ? 'Hide details' : 'Details'}
                        <ChevronDown size={14} className="md-due-card-details-chevron" />
                      </button>
                      {expanded && (
                        <div className="md-due-card-lines">
                          {sortedLines.map((line) => (
                            <div key={line.item_id || line.key} className="md-due-card-line">
                              <span className="md-due-card-line-label">{line.label}</span>
                              <DueStatusPill line={line} tokens={tokens} />
                            </div>
                          ))}
                        </div>
                      )}
                    </article>
                  )
                })}
              </div>
            </div>
          ) : (
            <Table
              className="md-due-table"
              style={{ display: 'block' }}
              columns={[
                { key: 'date', label: 'Date', className: 'md-due-sticky-date' },
                ...dueColumns.map((item) => ({
                  key: String(item.id),
                  label: item.label,
                  className: 'md-due-service-col',
                })),
              ]}
              loading={loading}
            >
              {dueRows.map((row) => {
                const lineByItem = {}
                row.lines.forEach((l) => { lineByItem[l.item_id] = l })
                return (
                  <TableRow key={row.snapshot_date}>
                    <td className="md-due-sticky-date">{row.snapshot_date}</td>
                    {dueColumns.map((item) => (
                      <DueStatusCell
                        key={item.id}
                        line={lineByItem[item.id]}
                        tokens={tokens}
                      />
                    ))}
                  </TableRow>
                )
              })}
            </Table>
          )}
        </Card>
      )}
    </div>
  )
}

export default MaintenanceReport
