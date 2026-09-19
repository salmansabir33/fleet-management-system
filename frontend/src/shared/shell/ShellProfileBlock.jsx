import { Avatar } from '../components/Avatar'

export function ShellProfileBlock({ name, roleLabel, avatarSrc, expanded = true }) {
  return (
    <div className="ft-shell-profile-block" title={name}>
      <Avatar name={name} size="md" src={avatarSrc} />
      {expanded && (
        <div className="ft-shell-profile-meta">
          <div className="ft-shell-profile-name">
            {name}
            <span className="ft-shell-online-dot" title="Online" aria-label="Online" />
          </div>
          {roleLabel && <div className="ft-shell-profile-role">{roleLabel}</div>}
        </div>
      )}
    </div>
  )
}
