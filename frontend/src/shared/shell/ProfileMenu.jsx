import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  User, Palette, Settings, HelpCircle, LogOut, ChevronRight, ChevronDown,
} from 'lucide-react'
import { Avatar } from '../components/Avatar'
import { Dropdown, DropdownItem } from '../components/Dropdown'
import { AppearancePicker } from './AppearancePicker'

/**
 * Topbar avatar trigger + dropdown matching the portal mockups.
 * Appearance submenu is wired to useTheme()/setTheme via AppearancePicker.
 */
export function ProfileMenu({
  name,
  roleLabel,
  avatarSrc,
  settingsPath,
  onLogout,
  align = 'right',
}) {
  const navigate = useNavigate()
  const [appearanceOpen, setAppearanceOpen] = useState(false)

  const trigger = (
    <button type="button" className="ft-shell-profile-trigger">
      <Avatar name={name} size="md" src={avatarSrc} />
      <span className="ft-shell-profile-trigger-meta">
        <span className="ft-shell-profile-trigger-name">{name}</span>
        {roleLabel && (
          <span className="ft-shell-profile-trigger-role">{roleLabel}</span>
        )}
      </span>
      <ChevronDown size={14} color="var(--ft-text-muted)" />
    </button>
  )

  return (
    <Dropdown
      align={align}
      trigger={trigger}
      className="ft-profile-menu-root"
    >
      {(close) => {
        const dismiss = () => {
          setAppearanceOpen(false)
          close()
        }
        return (
          <div className="ft-profile-menu">
            <div className="ft-profile-menu-header">
              <Avatar name={name} size="md" src={avatarSrc} />
              <div>
                <div className="ft-profile-menu-header-name">{name}</div>
                {roleLabel && (
                  <div className="ft-profile-menu-header-role">{roleLabel}</div>
                )}
              </div>
            </div>

            <div className="ft-profile-menu-body">
              <DropdownItem onClick={dismiss}>
                <User size={15} />
                Profile
              </DropdownItem>

              <div
                className={`ft-profile-menu-item${appearanceOpen ? ' ft-profile-menu-item--active' : ''}`}
                onMouseEnter={() => setAppearanceOpen(true)}
                onMouseLeave={() => setAppearanceOpen(false)}
              >
                <DropdownItem
                  aria-expanded={appearanceOpen}
                  aria-haspopup="menu"
                  onClick={(event) => {
                    event.preventDefault()
                    event.stopPropagation()
                    setAppearanceOpen((open) => !open)
                  }}
                >
                  <Palette size={15} />
                  Appearance
                  <ChevronRight size={14} style={{ marginLeft: 'auto' }} />
                </DropdownItem>
                {appearanceOpen && (
                  <AppearancePicker onPicked={dismiss} />
                )}
              </div>

              <DropdownItem
                onClick={() => {
                  dismiss()
                  if (settingsPath) navigate(settingsPath)
                }}
              >
                <Settings size={15} />
                Settings
              </DropdownItem>

              <DropdownItem onClick={dismiss}>
                <HelpCircle size={15} />
                Help & Support
              </DropdownItem>
            </div>

            <div className="ft-profile-menu-footer">
              <DropdownItem
                danger
                onClick={() => {
                  dismiss()
                  onLogout?.()
                }}
              >
                <LogOut size={15} />
                Logout
              </DropdownItem>
            </div>
          </div>
        )
      }}
    </Dropdown>
  )
}
