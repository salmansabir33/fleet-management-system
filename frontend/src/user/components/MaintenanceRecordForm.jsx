import { useEffect, useMemo, useState } from 'react'
import { Pencil, X, Check } from 'lucide-react'
import api from '../../api'
import { colors, radius, maintenanceStatusMeta } from '../theme'

// Shared helpers + form pieces used by both the baseline-setup page
// (MaintenanceBaseline.jsx) and the regular entry page (Maintenance.jsx) —
// pulled out of Maintenance.jsx so neither page has to duplicate the
// record form, interval editor, or odometer/engine-hours fields.

export const fmtNumber = (n) => (n == null ? null : Number(n).toLocaleString(undefined, { maximumFractionDigits: 1 }))

export const unitFor = (dimension) => (dimension === 'distance' ? 'km' : 'hrs')

export const StatusDot = ({ status }) => {
  const meta = maintenanceStatusMeta[status] || maintenanceStatusMeta.unknown
  return (
    <span style={{ ...pillStyles.pill, color: meta.color, background: meta.bg }}>
      <span style={{ ...pillStyles.dot, background: meta.color }} />
      {meta.label}
    </span>
  )
}

// The interval-override mini-form, opened via the pencil icon next to
// an item's interval label. PUT/DELETE against
// /api/maintenance/devices/{id}/settings/{item_id} — see §5.6/§7.3.1.
export const IntervalEditor = ({ deviceId, item, onClose, onSaved }) => {
  const [dimension, setDimension] = useState(item.dimension)
  const [value, setValue] = useState(String(item.interval_value))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  const save = async () => {
    setSaving(true)
    setError(null)
    try {
      await api.put(`/api/maintenance/devices/${deviceId}/settings/${item.item_id}`, {
        dimension,
        interval_value: Number(value),
      })
      onSaved()
      onClose()
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to save override')
    } finally {
      setSaving(false)
    }
  }

  const removeOverride = async () => {
    setSaving(true)
    setError(null)
    try {
      await api.delete(`/api/maintenance/devices/${deviceId}/settings/${item.item_id}`)
      onSaved()
      onClose()
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to remove override')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="md-maint-interval-editor" style={formStyles.editorBox}>
      {error && <div style={formStyles.editorError}>{error}</div>}
      <div style={formStyles.editorRow}>
        <div
          className="md-maint-unit-toggle"
          style={formStyles.unitToggle}
          role="group"
          aria-label="Interval unit"
        >
          <button
            type="button"
            onClick={() => setDimension('distance')}
            aria-pressed={dimension === 'distance'}
            style={{
              ...formStyles.unitBtn,
              ...(dimension === 'distance' ? formStyles.unitBtnActive : null),
            }}
          >
            km
          </button>
          <button
            type="button"
            onClick={() => setDimension('engine_hours')}
            aria-pressed={dimension === 'engine_hours'}
            style={{
              ...formStyles.unitBtn,
              ...(dimension === 'engine_hours' ? formStyles.unitBtnActive : null),
            }}
          >
            hrs
          </button>
        </div>
        <input
          type="number"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          style={formStyles.editorInput}
          min="0"
          inputMode="decimal"
          aria-label="Interval value"
        />
        <button type="button" onClick={save} disabled={saving} style={formStyles.editorSaveBtn} aria-label="Save interval">
          <Check size={14} />
        </button>
        <button type="button" onClick={onClose} style={formStyles.editorCancelBtn} aria-label="Cancel">
          <X size={14} />
        </button>
      </div>
      {item.interval_source === 'vehicle' && (
        <button type="button" onClick={removeOverride} disabled={saving} style={formStyles.editorRemoveLink}>
          Revert to default
        </button>
      )}
    </div>
  )
}

// The reusable record form — used both for the mandatory baseline
// submission and every regular "log maintenance" visit after that.
export const RecordForm = ({ deviceId, items, isBaseline, recordDate, onSubmitted }) => {
  const [lines, setLines] = useState({}) // item_id -> { price, checked }
  const [customLabel, setCustomLabel] = useState('')
  const [customPrice, setCustomPrice] = useState('')
  const [customChecked, setCustomChecked] = useState(false)
  const [notes, setNotes] = useState('')
  const [totalOverride, setTotalOverride] = useState(null)
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState(null)
  const [submitOk, setSubmitOk] = useState(false)
  const [editingItemId, setEditingItemId] = useState(null)

  const computedSum = useMemo(() => {
    let sum = 0
    Object.values(lines).forEach((l) => {
      if (l.checked) sum += Number(l.price) || 0
    })
    if (customChecked) sum += Number(customPrice) || 0
    return sum
  }, [lines, customChecked, customPrice])

  // Any checked line's price changing invalidates a manual total
  // override — recompute the live sum again, per the confirmed
  // requirement ("doesn't auto-recompute again unless a line changes").
  useEffect(() => {
    setTotalOverride(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [computedSum])

  const displayedTotal = totalOverride !== null ? totalOverride : String(computedSum)

  const setItemPrice = (itemId, value) => {
    setLines((prev) => {
      const existing = prev[itemId] || { price: '', checked: false }
      const numeric = parseFloat(value)
      const autoCheck = value !== '' && !isNaN(numeric) && numeric !== 0
      return { ...prev, [itemId]: { price: value, checked: autoCheck ? true : existing.checked } }
    })
  }

  const toggleItemChecked = (itemId) => {
    setLines((prev) => {
      const existing = prev[itemId] || { price: '', checked: false }
      const nextChecked = !existing.checked
      return { ...prev, [itemId]: { price: nextChecked ? existing.price : '', checked: nextChecked } }
    })
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setSubmitError(null)
    setSubmitOk(false)
    setSubmitting(true)

    const payloadLines = []
    Object.entries(lines).forEach(([itemId, l]) => {
      if (!l.checked) return
      payloadLines.push({
        item_id: Number(itemId),
        price: Number(l.price) || 0,
        checked: true,
      })
    })
    if (customChecked && (customLabel.trim() || Number(customPrice) > 0)) {
      payloadLines.push({
        item_id: null,
        custom_label: customLabel.trim() || 'Other repair',
        price: Number(customPrice) || 0,
        checked: true,
      })
    }

    try {
      await api.post(`/api/maintenance/devices/${deviceId}/records`, {
        odometer_km: Number(recordDate.odometer_km),
        engine_hours: recordDate.engine_hours != null && recordDate.engine_hours !== ''
          ? Number(recordDate.engine_hours) : null,
        notes: notes || null,
        lines: payloadLines,
        total_cost: Number(displayedTotal) || 0,
      })
      setSubmitOk(true)
      // Repeatable action — clear price/checkbox inputs, keep the item
      // list visible.
      setLines({})
      setCustomLabel('')
      setCustomPrice('')
      setCustomChecked(false)
      setNotes('')
      setTotalOverride(null)
      onSubmitted()
    } catch (err) {
      setSubmitError(err.response?.data?.detail || 'Failed to save maintenance record')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      {submitError && <div style={formStyles.error}>{submitError}</div>}
      {submitOk && <div style={formStyles.success}>Saved.</div>}

      <div style={formStyles.itemList}>
        {items.map((item) => {
          const line = lines[item.item_id] || { price: '', checked: false }
          const isEditing = editingItemId === item.item_id
          return (
            <div key={item.item_id} className="md-maint-item" style={formStyles.itemOuter}>
              <div className="md-maint-item-main" style={formStyles.itemRow}>
                <StatusDot status={item.status} />
                <div style={formStyles.itemLabelBlock}>
                  <div style={formStyles.itemLabel}>{item.label}</div>
                  <div style={formStyles.itemInterval}>
                    every {fmtNumber(item.interval_value)} {unitFor(item.dimension)}
                    <button
                      type="button"
                      onClick={() => setEditingItemId(isEditing ? null : item.item_id)}
                      style={formStyles.pencilBtn}
                      title="Edit interval for this vehicle"
                      aria-expanded={isEditing}
                    >
                      <Pencil size={11} />
                    </button>
                  </div>
                </div>
                <input
                  type="number"
                  className="md-maint-price"
                  placeholder="Price"
                  value={line.price}
                  onChange={(e) => setItemPrice(item.item_id, e.target.value)}
                  style={formStyles.priceInput}
                  min="0"
                  inputMode="decimal"
                />
                <input
                  type="checkbox"
                  checked={line.checked}
                  onChange={() => toggleItemChecked(item.item_id)}
                  style={formStyles.checkbox}
                />
              </div>
              {isEditing && (
                <IntervalEditor
                  deviceId={deviceId}
                  item={item}
                  onClose={() => setEditingItemId(null)}
                  onSaved={onSubmitted}
                />
              )}
            </div>
          )
        })}

        <div className="md-maint-item" style={formStyles.itemOuter}>
          <div className="md-maint-item-main" style={formStyles.itemRow}>
            <input
              type="text"
              placeholder="Other repair — describe"
              value={customLabel}
              onChange={(e) => setCustomLabel(e.target.value)}
              style={{ ...formStyles.itemLabelBlock, ...formStyles.customLabelInput }}
            />
            <input
              type="number"
              className="md-maint-price"
              placeholder="Price"
              value={customPrice}
              onChange={(e) => {
                const v = e.target.value
                setCustomPrice(v)
                const numeric = parseFloat(v)
                if (v !== '' && !isNaN(numeric) && numeric !== 0) setCustomChecked(true)
              }}
              style={formStyles.priceInput}
              min="0"
              inputMode="decimal"
            />
            <input
              type="checkbox"
              checked={customChecked}
              onChange={() => {
                setCustomChecked((prev) => {
                  const next = !prev
                  if (!next) setCustomPrice('')
                  return next
                })
              }}
              style={formStyles.checkbox}
            />
          </div>
        </div>
      </div>

      <div style={formStyles.calculatedTotalRow}>
        Calculated total: Rs {fmtNumber(computedSum) ?? 0}
      </div>

      <div style={formStyles.totalRow}>
        <span style={formStyles.totalLabel}>Total</span>
        <input
          type="number"
          value={displayedTotal}
          onChange={(e) => setTotalOverride(e.target.value)}
          style={formStyles.totalInput}
          min="0"
        />
      </div>

      <textarea
        placeholder="Notes (optional)"
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        style={formStyles.notes}
        rows={3}
      />

      <button type="submit" disabled={submitting} style={formStyles.submitBtn}>
        {submitting ? 'Saving...' : isBaseline ? 'Save Baseline' : 'Log Maintenance'}
      </button>
    </form>
  )
}

// Small controlled wrapper for the odometer/engine-hours inputs that
// seed each record submission — pre-filled from the live GPS odometer
// (status.odometer_km) but user-editable, since the device GPS
// odometer can lag reality. Render-prop so RecordForm always gets the
// current typed values without lifting all of the page's state.
export const BaselineOdometerFields = ({ value, odometerFromGps, children }) => {
  const [odometer, setOdometer] = useState(value.odometer_km)
  const [engineHours, setEngineHours] = useState(value.engine_hours)

  return (
    <div>
      <div className="md-odo-row" style={formStyles.odoRow}>
        <div style={formStyles.odoField}>
          <label style={formStyles.odoLabel}>Odometer reading (km)</label>
          <input
            type="number"
            value={odometer}
            onChange={(e) => setOdometer(e.target.value)}
            style={formStyles.odoInput}
            min="0"
            required
          />
          {odometerFromGps == null && (
            <span style={formStyles.odoHint}>No GPS data yet — enter manually.</span>
          )}
        </div>
        <div style={formStyles.odoField}>
          <label style={formStyles.odoLabel}>Total engine hours</label>
          <input
            type="number"
            value={engineHours}
            onChange={(e) => setEngineHours(e.target.value)}
            style={formStyles.odoInput}
            min="0"
          />
        </div>
      </div>
      {children({ odometer_km: odometer, engine_hours: engineHours })}
    </div>
  )
}

export const pillStyles = {
  pill: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 5,
    padding: '2px 8px',
    borderRadius: 999,
    fontSize: 11,
    fontWeight: 700,
    flexShrink: 0,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: '50%',
    display: 'inline-block',
  },
}

export const formStyles = {
  error: {
    padding: '8px 12px',
    borderRadius: radius.sm,
    background: colors.criticalSoft,
    color: colors.critical,
    fontSize: 13,
    marginBottom: 12,
  },
  success: {
    padding: '8px 12px',
    borderRadius: radius.sm,
    background: colors.accentSoft,
    color: colors.accent,
    fontSize: 13,
    marginBottom: 12,
  },
  odoRow: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: 12,
    marginBottom: 16,
  },
  odoField: {
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
    minWidth: 0,
  },
  odoLabel: {
    fontSize: 12,
    fontWeight: 600,
    color: colors.textMuted,
    lineHeight: 1.3,
  },
  odoInput: {
    width: '100%',
    boxSizing: 'border-box',
    padding: '8px 10px',
    borderRadius: radius.sm,
    border: `1px solid ${colors.border}`,
    fontSize: 14,
  },
  odoHint: {
    fontSize: 11,
    color: colors.textFaint,
  },
  itemList: {
    display: 'flex',
    flexDirection: 'column',
    gap: 2,
    marginBottom: 16,
  },
  itemOuter: {
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
    padding: '10px 4px',
    borderBottom: `1px solid ${colors.border}`,
  },
  itemRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    minWidth: 0,
    width: '100%',
  },
  itemLabelBlock: {
    flex: 1,
    minWidth: 0,
  },
  itemLabel: {
    fontSize: 13,
    fontWeight: 600,
    color: colors.text,
    overflowWrap: 'anywhere',
  },
  itemInterval: {
    fontSize: 11,
    color: colors.textFaint,
    display: 'flex',
    alignItems: 'center',
    gap: 4,
    flexWrap: 'wrap',
  },
  pencilBtn: {
    display: 'inline-flex',
    alignItems: 'center',
    background: 'none',
    border: 'none',
    padding: 2,
    cursor: 'pointer',
    color: colors.textFaint,
    flexShrink: 0,
  },
  customLabelInput: {
    padding: '6px 10px',
    borderRadius: radius.sm,
    border: `1px solid ${colors.border}`,
    fontSize: 13,
  },
  priceInput: {
    width: 90,
    maxWidth: '28%',
    boxSizing: 'border-box',
    padding: '6px 8px',
    borderRadius: radius.sm,
    border: `1px solid ${colors.border}`,
    fontSize: 13,
    flexShrink: 0,
  },
  checkbox: {
    width: 16,
    height: 16,
    flexShrink: 0,
  },
  editorBox: {
    width: '100%',
    boxSizing: 'border-box',
    padding: 10,
    borderRadius: radius.sm,
    background: colors.bg,
    border: `1px solid ${colors.border}`,
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
  },
  editorRow: {
    display: 'flex',
    gap: 8,
    alignItems: 'center',
    minWidth: 0,
    width: '100%',
  },
  unitToggle: {
    display: 'inline-flex',
    flexShrink: 0,
    borderRadius: 6,
    border: `1px solid ${colors.border}`,
    overflow: 'hidden',
    background: colors.surface,
  },
  unitBtn: {
    appearance: 'none',
    border: 'none',
    margin: 0,
    padding: '8px 10px',
    fontSize: 12,
    fontWeight: 700,
    lineHeight: 1,
    cursor: 'pointer',
    background: 'transparent',
    color: colors.textMuted,
    minWidth: 40,
  },
  unitBtnActive: {
    background: colors.accent,
    color: '#fff',
  },
  editorInput: {
    flex: 1,
    minWidth: 0,
    width: '100%',
    boxSizing: 'border-box',
    padding: '8px 10px',
    borderRadius: 6,
    border: `1px solid ${colors.border}`,
    fontSize: 13,
    background: colors.surface,
  },
  editorSaveBtn: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    width: 36,
    height: 36,
    padding: 0,
    borderRadius: 6,
    border: 'none',
    background: colors.accent,
    color: '#fff',
    cursor: 'pointer',
  },
  editorCancelBtn: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    width: 36,
    height: 36,
    padding: 0,
    borderRadius: 6,
    border: `1px solid ${colors.border}`,
    background: colors.surface,
    color: colors.textMuted,
    cursor: 'pointer',
  },
  editorRemoveLink: {
    alignSelf: 'flex-start',
    fontSize: 11,
    color: colors.critical,
    background: 'none',
    border: 'none',
    padding: 0,
    cursor: 'pointer',
    textDecoration: 'underline',
  },
  editorError: {
    fontSize: 12,
    color: colors.critical,
    lineHeight: 1.35,
  },
  calculatedTotalRow: {
    textAlign: 'right',
    fontSize: 12,
    color: colors.textFaint,
    marginBottom: 6,
  },
  totalRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 10,
    marginBottom: 12,
  },
  totalLabel: {
    fontSize: 13,
    fontWeight: 700,
    color: colors.text,
  },
  totalInput: {
    width: 120,
    padding: '8px 10px',
    borderRadius: radius.sm,
    border: `1px solid ${colors.border}`,
    fontSize: 14,
    fontWeight: 700,
  },
  notes: {
    width: '100%',
    padding: '8px 10px',
    borderRadius: radius.sm,
    border: `1px solid ${colors.border}`,
    fontSize: 13,
    marginBottom: 12,
    fontFamily: 'inherit',
    resize: 'vertical',
  },
  submitBtn: {
    padding: '9px 20px',
    borderRadius: radius.sm,
    border: 'none',
    background: colors.accent,
    color: '#fff',
    fontSize: 13,
    fontWeight: 700,
    cursor: 'pointer',
  },
}