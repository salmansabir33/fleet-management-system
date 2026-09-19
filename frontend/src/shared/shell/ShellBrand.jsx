import { Shield } from 'lucide-react'

export function ShellBrand({ portalLabel, expanded = true }) {
  return (
    <div className="ft-shell-brand">
      <div className="ft-shell-logo" aria-hidden>
        <Shield size={18} strokeWidth={2.25} />
      </div>
      {expanded && (
        <div className="ft-shell-brand-text">
          <span className="ft-shell-brand-name">FLEET TRACKER</span>
          {portalLabel && (
            <span className="ft-shell-brand-portal">{portalLabel}</span>
          )}
        </div>
      )}
    </div>
  )
}
