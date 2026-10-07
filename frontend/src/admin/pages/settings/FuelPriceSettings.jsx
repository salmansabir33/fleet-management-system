import { useEffect, useState } from 'react'
import { Pencil, Check, X } from 'lucide-react'
import api from '../../../api'
import { useTheme } from '../../../theme'
import { hexToRgba } from '../../../shared/utils'
import {
  Card,
  Button,
  IconButton,
  Input,
  Select,
  Table,
  TableRow,
  LoadingState,
  EmptyState,
  Badge,
} from '../../../shared/components'
import { useAuth } from '../../../auth/AuthContext'
import { readActingAdminId, readActingAdminLabel } from '../../../auth/actingAdminStorage'

const localTodayIso = () => {
  const d = new Date()
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${month}-${day}`
}

const dateKey = (value) => String(value || '').slice(0, 10)

const FuelPriceSettings = ({ fleetScoped = false, globalMode = false }) => {
  const { tokens } = useTheme()
  const { role } = useAuth()
  const actingAdminId = readActingAdminId()
  const actingLabel = readActingAdminLabel()
  const scopeBadgeText = role === 'super_admin' && globalMode
    ? 'Editing global prices'
    : (role === 'super_admin' && actingAdminId != null
      ? `Editing ${actingLabel || 'fleet admin'}'s override`
      : null)
  const [fuelTypes, setFuelTypes] = useState([])
  const [prices, setPrices] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [fuelTypeId, setFuelTypeId] = useState('')
  const [pricePerLiter, setPricePerLiter] = useState('')
  const [effectiveDateStart, setEffectiveDateStart] = useState(localTodayIso)
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState(null)
  const [submitNotice, setSubmitNotice] = useState(null)
  const [editingId, setEditingId] = useState(null)
  const [editPrice, setEditPrice] = useState('')
  const [editError, setEditError] = useState(null)

  const fetchPrices = async () => {
    const res = await api.get('/api/fuel-prices')
    setPrices(res.data)
  }

  useEffect(() => {
    const fetchAll = async () => {
      setLoading(true)
      setError(null)
      try {
        const [typesRes, pricesRes] = await Promise.all([
          api.get('/api/fuel-types'),
          api.get('/api/fuel-prices'),
        ])
        const types = [...(typesRes.data || [])].sort((a, b) => (
          String(a.name || '').localeCompare(String(b.name || ''), undefined, { sensitivity: 'base' })
        ))
        setFuelTypes(types)
        setPrices(pricesRes.data || [])
        if (types.length > 0) {
          setFuelTypeId(types[0].id)
        }
      } catch (err) {
        setError(err.response?.data?.detail || 'Failed to load fuel prices data')
      } finally {
        setLoading(false)
      }
    }
    fetchAll()
  }, [])

  useEffect(() => {
    if (!submitNotice) return undefined
    const timer = setTimeout(() => setSubmitNotice(null), 5000)
    return () => clearTimeout(timer)
  }, [submitNotice])

  const handleSubmit = async (e) => {
    e.preventDefault()
    setSubmitting(true)
    setSubmitError(null)
    setSubmitNotice(null)
    const typeName = getFuelTypeName(fuelTypeId)
    const existing = prices.find((price) => (
      Number(price.fuel_type_id) === Number(fuelTypeId)
      && dateKey(price.effective_date_start) === dateKey(effectiveDateStart)
    ))
    try {
      if (existing) {
        await api.patch(`/api/fuel-prices/${existing.id}`, {
          price_per_liter: Number(pricePerLiter),
        })
        setSubmitNotice(`Updated existing ${typeName} price for ${effectiveDateStart}.`)
      } else {
        await api.post('/api/fuel-prices', {
          fuel_type_id: Number(fuelTypeId),
          price_per_liter: Number(pricePerLiter),
          effective_date_start: effectiveDateStart,
        })
        setSubmitNotice(`Saved ${typeName} price for ${effectiveDateStart}.`)
      }
      await fetchPrices()
      setPricePerLiter('')
    } catch (err) {
      setSubmitError(err.response?.data?.detail || 'Failed to save price')
    } finally {
      setSubmitting(false)
    }
  }

  const visiblePrices = prices.filter((price) => {
    if (globalMode) return price.admin_id == null
    if (fleetScoped) return price.admin_id == null || price.admin_id != null
    return true
  })

  const isFleetOverride = (price) => price.admin_id != null

  const canEditPrice = (price) => {
    if (globalMode) return price.admin_id == null
    if (fleetScoped) return price.admin_id != null
    return true
  }

  const handleRevertOverride = async (price) => {
    if (!window.confirm('Revert this fleet override? Global price will apply again.')) return
    try {
      await api.delete(`/api/fuel-prices/${price.id}`)
      await fetchPrices()
    } catch (err) {
      setEditError(err.response?.data?.detail || 'Failed to revert override')
    }
  }

  const getFuelTypeName = (id) => {
    const type = fuelTypes.find((t) => Number(t.id) === Number(id))
    if (!type?.name) return `Type ${id}`
    return type.name.charAt(0).toUpperCase() + type.name.slice(1)
  }

  const handleEditClick = (price) => {
    setEditingId(price.id)
    setEditPrice(price.price_per_liter != null ? String(price.price_per_liter) : '')
    setEditError(null)
  }

  const handleCancelEdit = () => {
    setEditingId(null)
    setEditPrice('')
    setEditError(null)
  }

  const handleSaveEdit = async (price) => {
    setEditError(null)
    try {
      await api.patch(`/api/fuel-prices/${price.id}`, {
        price_per_liter: Number(editPrice),
      })
      await fetchPrices()
      setEditingId(null)
      setEditPrice('')
    } catch (err) {
      setEditError(err.response?.data?.detail || 'Failed to update price')
    }
  }

  const errorBanner = (message) => (
    <div
      style={{
        background: hexToRgba(tokens.semantic.danger, 0.12),
        color: tokens.semantic.danger,
        padding: '8px 12px',
        borderRadius: tokens.radius.sm,
        fontSize: 13,
        marginBottom: 12,
      }}
    >
      {message}
    </div>
  )

  if (loading) {
    return <Card><LoadingState label="Loading fuel prices…" /></Card>
  }

  if (error) {
    return (
      <div
        className="ft-admin-settings-error"
        style={{
          background: hexToRgba(tokens.semantic.danger, 0.12),
          color: tokens.semantic.danger,
        }}
      >
        {error}
      </div>
    )
  }

  if (fuelTypes.length === 0) {
    return (
      <Card title="Fuel Prices">
        <EmptyState
          title="No fuel types yet"
          description="Add Petrol and Diesel fuel types before you can save prices."
        />
      </Card>
    )
  }

  return (
    <div className="ft-admin-settings-grid ft-fuel-price-settings">
      {scopeBadgeText && (
        <div style={{ gridColumn: '1 / -1' }}>
          <Badge>{scopeBadgeText}</Badge>
        </div>
      )}
      {(globalMode || fleetScoped) && (
      <Card title={globalMode ? 'Add global fuel price' : 'Add fleet fuel price'}>
        <form
          onSubmit={handleSubmit}
          className="ft-fuel-price-form"
        >
          {submitError && errorBanner(submitError)}
          {submitNotice && (
            <div className="ft-fuel-price-notice">{submitNotice}</div>
          )}
          <Select
            label="Fuel type"
            value={fuelTypeId}
            onChange={(e) => setFuelTypeId(e.target.value)}
            required
          >
            {fuelTypes.map((type) => (
              <option key={type.id} value={type.id}>
                {getFuelTypeName(type.id)}
              </option>
            ))}
          </Select>
          <Input
            label="Price per liter (PKR)"
            type="number"
            step="0.01"
            min="0"
            value={pricePerLiter}
            onChange={(e) => setPricePerLiter(e.target.value)}
            required
          />
          <Input
            label="Effective from"
            type="date"
            value={effectiveDateStart}
            onChange={(e) => setEffectiveDateStart(e.target.value)}
            required
          />
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <Button type="submit" loading={submitting} disabled={!fuelTypeId || !pricePerLiter}>
              {submitting ? 'Saving…' : 'Save price'}
            </Button>
          </div>
        </form>
      </Card>
      )}

      <Card title="Price history" className="ft-fuel-price-history">
        {editError && errorBanner(editError)}
        {visiblePrices.length > 0 ? (
          <Table
            className="ft-table--comfortable ft-table-wrap--scroll"
            columns={[
              { key: 'scope', label: 'Scope' },
              { key: 'fuel', label: 'Fuel Type' },
              { key: 'price', label: 'Price (PKR)' },
              { key: 'from', label: 'From' },
              { key: 'to', label: 'To' },
              { key: 'actions', label: 'Actions' },
            ]}
          >
            {visiblePrices.map((price) => (
              <TableRow key={price.id}>
                <td>
                  {isFleetOverride(price) ? (
                    <Badge
                      color={tokens.primary}
                      background={hexToRgba(tokens.primary, 0.14)}
                    >
                      Your fleet
                    </Badge>
                  ) : (
                    <Badge
                      color={tokens.textMuted}
                      background={hexToRgba(tokens.textMuted, 0.12)}
                    >
                      Global
                    </Badge>
                  )}
                </td>
                <td>{getFuelTypeName(price.fuel_type_id)}</td>
                <td>
                  {editingId === price.id ? (
                    <Input
                      type="number"
                      step="0.01"
                      min="0"
                      value={editPrice}
                      onChange={(e) => setEditPrice(e.target.value)}
                      autoFocus
                      style={{ width: 88, marginBottom: 0 }}
                    />
                  ) : (
                    price.price_per_liter != null
                      ? Number(price.price_per_liter).toFixed(2)
                      : '--'
                  )}
                </td>
                <td>{price.effective_date_start}</td>
                <td>
                  {price.effective_date_end == null ? (
                    <Badge
                      color={tokens.semantic.success}
                      background={hexToRgba(tokens.semantic.success, 0.14)}
                    >
                      Current
                    </Badge>
                  ) : (
                    price.effective_date_end
                  )}
                </td>
                <td>
                  {canEditPrice(price) ? (
                    editingId === price.id ? (
                      <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                        <IconButton label="Save" size="sm" onClick={() => handleSaveEdit(price)}>
                          <Check size={14} color={tokens.primary} />
                        </IconButton>
                        <IconButton label="Cancel" size="sm" onClick={handleCancelEdit}>
                          <X size={14} color={tokens.textMuted} />
                        </IconButton>
                      </div>
                    ) : (
                      <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                        <IconButton label="Edit" size="sm" onClick={() => handleEditClick(price)}>
                          <Pencil size={14} />
                        </IconButton>
                        {fleetScoped && isFleetOverride(price) && (
                          <Button type="button" variant="ghost" size="sm" onClick={() => handleRevertOverride(price)}>
                            Revert
                          </Button>
                        )}
                      </div>
                    )
                  ) : (
                    <span className="ft-muted" style={{ fontSize: 12 }}>Read-only</span>
                  )}
                </td>
              </TableRow>
            ))}
          </Table>
        ) : (
          <EmptyState title="No price history yet" description="Saved petrol and diesel rates will show up here." />
        )}
      </Card>
    </div>
  )
}

export default FuelPriceSettings
