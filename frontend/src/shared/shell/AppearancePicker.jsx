import { themes } from '../../theme/themes'
import { useTheme } from '../../theme'
import { Check } from 'lucide-react'
import { Switch } from '../components/Form'

const THEME_LABELS = {
  ocean: 'Ocean Blue',
  emerald: 'Emerald Green',
  crimson: 'Crimson Red',
  violet: 'Violet Purple',
  amber: 'Amber Orange',
  slate: 'Slate Gray',
}

/**
 * Theme swatch picker for the avatar Appearance submenu.
 * Wires to useTheme()/setTheme(); status/severity colors are untouched.
 */
export function AppearancePicker({ onPicked }) {
  const { themeId, setTheme, availableThemes } = useTheme()

  return (
    <div className="ft-appearance-flyout" role="menu" aria-label="Appearance">
      {availableThemes.map((theme) => {
        const active = theme.id === themeId
        const color = themes[theme.id]?.brand?.primary || 'var(--ft-primary)'
        return (
          <button
            key={theme.id}
            type="button"
            role="menuitemradio"
            aria-checked={active}
            className={`ft-appearance-swatch${active ? ' ft-appearance-swatch--active' : ''}`}
            onClick={() => {
              setTheme(theme.id)
              onPicked?.()
            }}
          >
            <span className="ft-appearance-dot" style={{ background: color }} />
            {THEME_LABELS[theme.id] || theme.name}
            {active && <Check size={14} className="ft-appearance-check" strokeWidth={2.5} />}
          </button>
        )
      })}
      <div className="ft-appearance-soon">
        <span>Dark Mode</span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          <span>Soon</span>
          <Switch
            checked={false}
            disabled
            onChange={() => {}}
            aria-label="Dark mode (coming soon)"
          />
        </span>
      </div>
    </div>
  )
}

export default AppearancePicker
