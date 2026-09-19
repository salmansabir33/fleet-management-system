import { useNavigate } from 'react-router-dom'
import { Building2, Car, Contact, Users, Plus } from 'lucide-react'
import { useTheme } from '../../../theme'
import { hexToRgba } from '../../../shared/utils'
import { Card, Button, Badge } from '../../../shared/components'
import { useManagerScope } from '../../context/ManagerScopeContext'

/** Single-workspace summary — the Manager model has no multi-region workspaces. */
const WorkspaceSummaryCard = ({ driverCount, loading: parentLoading = false }) => {
  const navigate = useNavigate()
  const { tokens } = useTheme()
  const {
    managerName,
    assignedUserCount,
    totalVehicleCount,
    loading: scopeLoading,
  } = useManagerScope()
  const loading = parentLoading || scopeLoading

  return (
    <Card badge={1} title="Workspace" loading={loading} skeletonLines={5}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              padding: '12px 14px',
              borderRadius: tokens.radius.md,
              border: `1px solid ${tokens.primary}`,
              background: tokens.primarySoft,
              marginBottom: 12,
            }}
          >
            <div
              style={{
                width: 40,
                height: 40,
                borderRadius: tokens.radius.md,
                background: tokens.surface,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
              }}
            >
              <Building2 size={20} color={tokens.primary} />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 14, fontWeight: 700, color: tokens.text }}>
                  {managerName || 'Workspace'}
                </span>
                <Badge
                  color={tokens.semantic.success}
                  background={hexToRgba(tokens.semantic.success, 0.14)}
                >
                  Active
                </Badge>
              </div>
              <div
                style={{
                  display: 'flex',
                  flexWrap: 'wrap',
                  gap: 12,
                  marginTop: 6,
                  fontSize: 12,
                  color: tokens.textSecondary,
                }}
              >
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                  <Car size={12} />
                  {totalVehicleCount ?? '—'} Vehicles
                </span>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                  <Contact size={12} />
                  {driverCount ?? '—'} Drivers
                </span>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                  <Users size={12} />
                  {assignedUserCount ?? '—'} Users
                </span>
              </div>
            </div>
          </div>

          <p style={{ fontSize: 12, color: tokens.textMuted, margin: '0 0 12px' }}>
            Each manager account maps to one workspace. Switch accounts from the picker.
          </p>

          <Button
            variant="secondary"
            style={{ width: '100%' }}
            onClick={() => navigate('/manager/select')}
          >
            <Plus size={16} />
            Add / Switch Workspace
          </Button>
    </Card>
  )
}

export default WorkspaceSummaryCard
