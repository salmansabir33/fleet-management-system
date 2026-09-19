import { useNavigate } from 'react-router-dom'
import { Building2, Car, Contact, Users, Plus } from 'lucide-react'
import { Badge, Button } from '../components'
import { useTheme } from '../../theme'
import { hexToRgba } from '../utils'
import { ShellNavSection } from './ShellNavSection'

export function ShellWorkspacePanel({
  expanded = true,
  workspaceName,
  vehicleCount,
  userCount,
  driverCount = null,
  active = true,
  loading = false,
}) {
  const navigate = useNavigate()
  const { tokens } = useTheme()

  if (!expanded) return null

  const stats = [
    { icon: Car, label: 'Vehicles', value: loading ? '—' : (vehicleCount ?? '—') },
    { icon: Contact, label: 'Drivers', value: loading ? '—' : (driverCount ?? '—') },
    { icon: Users, label: 'Users', value: loading ? '—' : (userCount ?? '—') },
  ]

  return (
    <div className="ft-shell-workspace">
      <ShellNavSection label="Workspace" expanded />

      <div className="ft-shell-workspace-card">
        <div className="ft-shell-workspace-card-head">
          <div className="ft-shell-workspace-icon" aria-hidden>
            <Building2 size={16} />
          </div>
          <div className="ft-shell-workspace-meta">
            <div className="ft-shell-workspace-name">
              {loading ? 'Loading…' : (workspaceName || 'Workspace')}
            </div>
            {active && (
              <Badge
                pill
                color={tokens.semantic.success}
                background={hexToRgba(tokens.semantic.success, 0.18)}
              >
                Active
              </Badge>
            )}
          </div>
        </div>

        <div className="ft-shell-workspace-stats">
          {stats.map(({ icon: Icon, label, value }) => (
            <div key={label} className="ft-shell-workspace-stat">
              <Icon size={12} className="ft-shell-workspace-stat-icon" />
              <span className="ft-shell-workspace-stat-value">{value}</span>
              <span className="ft-shell-workspace-stat-label">{label}</span>
            </div>
          ))}
        </div>
      </div>

      <Button
        type="button"
        variant="secondary"
        size="sm"
        className="ft-shell-workspace-switch"
        onClick={() => navigate('/manager/select')}
      >
        <Plus size={14} />
        Add / Switch Workspace
      </Button>
    </div>
  )
}
