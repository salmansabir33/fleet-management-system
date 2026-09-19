import { useEffect, useState } from 'react'
import api from '../../api'
import { Button } from './Button'

export const parseCost = (value) => {
  if (value === null || value === undefined || value === '') return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

export const tripTotalCostPkr = (trip) => {
  const parts = [trip?.fuel_cost_pkr, trip?.toll_tax_pkr, trip?.challan_pkr]
  if (parts.every((part) => part == null)) return null
  return Math.round(parts.reduce((sum, part) => sum + (Number(part) || 0), 0) * 100) / 100
}

export const formatPkr = (value) => {
  if (value == null || value === '') return '—'
  const n = Number(value)
  if (!Number.isFinite(n)) return '—'
  return `${n.toLocaleString('en-US')} PKR`
}

export function TripCostsBox({ trip, apiFor, onSaved }) {
  const [toll, setToll] = useState(trip.toll_tax_pkr ?? '')
  const [challan, setChallan] = useState(trip.challan_pkr ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    setToll(trip.toll_tax_pkr ?? '')
    setChallan(trip.challan_pkr ?? '')
    setError('')
  }, [trip.id, trip.toll_tax_pkr, trip.challan_pkr])

  const draftTrip = {
    ...trip,
    toll_tax_pkr: parseCost(toll),
    challan_pkr: parseCost(challan),
  }
  const dirty = (
    parseCost(toll) !== parseCost(trip.toll_tax_pkr)
    || parseCost(challan) !== parseCost(trip.challan_pkr)
  )

  const save = async () => {
    if (saving || !dirty) return
    setSaving(true)
    setError('')
    try {
      const url = apiFor
        ? apiFor(`/trips/${trip.id}`, `/api/trips/${trip.id}`)
        : `/api/trips/${trip.id}`
      const res = await api.patch(url, {
        toll_tax_pkr: parseCost(toll),
        challan_pkr: parseCost(challan),
      })
      onSaved({
        ...trip,
        toll_tax_pkr: res.data.toll_tax_pkr,
        challan_pkr: res.data.challan_pkr,
      })
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to save trip costs.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="at-trips-cost-box">
      <div className="at-trips-cost-fields">
        <label className="at-trips-cost-field">
          <span>Toll tax</span>
          <span className="at-trips-cost-input-wrap">
            <input
              type="number"
              min="0"
              step="0.01"
              inputMode="decimal"
              value={toll}
              onChange={(e) => setToll(e.target.value)}
              onBlur={save}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); save() } }}
              aria-label="Toll tax"
            />
            <span>PKR</span>
          </span>
        </label>
        <label className="at-trips-cost-field">
          <span>Challan</span>
          <span className="at-trips-cost-input-wrap">
            <input
              type="number"
              min="0"
              step="0.01"
              inputMode="decimal"
              value={challan}
              onChange={(e) => setChallan(e.target.value)}
              onBlur={save}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); save() } }}
              aria-label="Challan"
            />
            <span>PKR</span>
          </span>
        </label>
      </div>
      <div className="at-trips-cost-total">
        <span>Total cost</span>
        <strong>{formatPkr(tripTotalCostPkr(draftTrip))}</strong>
      </div>
      <div className="at-trips-cost-actions">
        <Button size="sm" onClick={save} disabled={saving || !dirty}>
          {saving ? 'Saving…' : 'Save costs'}
        </Button>
        {error && <span className="at-trips-cost-error">{error}</span>}
      </div>
    </div>
  )
}
