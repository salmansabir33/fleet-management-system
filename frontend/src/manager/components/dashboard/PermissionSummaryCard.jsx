import { useEffect, useMemo, useState } from 'react'
import { Shield, ShieldOff } from 'lucide-react'
import api from '../../../api'
import { useTheme } from '../../../theme'
import { hexToRgba } from '../../../shared/utils'
import { Card, Badge, Button, Skeleton } from '../../../shared/components'
import { useManagerScope } from '../../context/ManagerScopeContext'

const formatPermissionLabel = (key) => key
  .split('_')
  .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
  .join(' ')

const AccessBadge = ({ granted, tokens }) => {
  if (granted) {
    return (
      <Badge color={tokens.semantic.success} background={hexToRgba(tokens.semantic.success, 0.14)}>
        Full Access
      </Badge>
    )
  }
  return (
    <Badge color={tokens.semantic.danger} background={hexToRgba(tokens.semantic.danger, 0.14)}>
      No Access
    </Badge>
  )
}

const PermissionSummaryCard = () => {
  const { tokens } = useTheme()
  const { permissions, loading: scopeLoading } = useManagerScope()
  const [catalog, setCatalog] = useState([])
  const [catalogLoading, setCatalogLoading] = useState(true)
  const [showAll, setShowAll] = useState(false)

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        const res = await api.get('/api/settings/permissions')
        if (!cancelled) {
          setCatalog((res.data || []).filter((row) => row.is_active !== false))
        }
      } catch (err) {
        console.error('Failed to load permission catalog:', err)
        try {
          const fallback = await api.get('/api/managers/permission-keys')
          if (!cancelled) {
            setCatalog((fallback.data?.keys || []).map((key) => ({ key, label: formatPermissionLabel(key) })))
          }
        } catch {
          if (!cancelled) setCatalog([])
        }
      } finally {
        if (!cancelled) setCatalogLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [])

  const rows = useMemo(() => {
    const permMap = permissions || {}
    const fromCatalog = catalog.map((row) => ({
      key: row.key,
      label: row.label || formatPermissionLabel(row.key),
      granted: Boolean(permMap[row.key]),
    }))
    if (fromCatalog.length > 0) return fromCatalog

    return Object.keys(permMap).sort().map((key) => ({
      key,
      label: formatPermissionLabel(key),
      granted: Boolean(permMap[key]),
    }))
  }, [catalog, permissions])

  const visibleRows = showAll ? rows : rows.slice(0, 8)
  const loading = scopeLoading || catalogLoading

  return (
    <Card
      badge={12}
      title="Permission Summary"
      right={(
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setShowAll((v) => !v)}
          style={{ color: tokens.primary }}
        >
          {showAll ? 'Show less' : 'View Full Permissions'}
        </Button>
      )}
    >
      {loading ? (
        <div aria-hidden style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} height={20} />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <p style={{ fontSize: 13, color: tokens.textMuted, margin: 0 }}>No permission keys defined.</p>
      ) : (
        <div>
          {visibleRows.map((row, idx) => (
            <div
              key={row.key || row.label}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 10,
                padding: '10px 0',
                borderBottom: idx < visibleRows.length - 1 ? `1px solid ${tokens.border}` : 'none',
              }}
            >
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 600 }}>
                {row.granted
                  ? <Shield size={14} color={tokens.semantic.success} />
                  : <ShieldOff size={14} color={tokens.semantic.danger} />}
                {row.label}
              </span>
              <AccessBadge granted={row.granted} tokens={tokens} />
            </div>
          ))}
        </div>
      )}
    </Card>
  )
}

export default PermissionSummaryCard
