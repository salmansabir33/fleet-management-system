import { LogOut } from 'lucide-react'
import { ShellHelpCard } from './ShellHelpCard'
import { ShellProfileBlock } from './ShellProfileBlock'

export function ShellSidebarFooter({
  name,
  roleLabel,
  avatarSrc,
  expanded = true,
  onLogout,
  onContactSupport,
  showHelpCard = true,
  version = 'Fleet Tracker v1.0.0',
  copyright = '© 2024 All rights reserved',
}) {
  return (
    <div className="ft-shell-sidebar-footer">
      {showHelpCard && (
        <ShellHelpCard expanded={expanded} onContactSupport={onContactSupport} />
      )}

      <div className="ft-shell-profile-row">
        <ShellProfileBlock
          name={name}
          roleLabel={roleLabel}
          avatarSrc={avatarSrc}
          expanded={expanded}
        />
        {expanded && onLogout && (
          <button
            type="button"
            className="ft-shell-profile-logout"
            title="Logout"
            aria-label="Logout"
            onClick={onLogout}
          >
            <LogOut size={16} />
          </button>
        )}
      </div>

      {expanded && (
        <div className="ft-shell-version">
          {version}
          <br />
          {copyright}
        </div>
      )}
    </div>
  )
}
