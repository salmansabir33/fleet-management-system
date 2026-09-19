import { hexToRgba } from '../shared/utils'
import {
  accent,
  alertSeverity,
  basePalette,
  fleetStatus,
  glass,
  iconChipFg,
  maintenanceState,
  motion,
  radius,
  semantic,
  shadow,
  spacing,
  typography,
} from './tokens'
import { DEFAULT_THEME_ID, themes } from './themes'

const buildIconChip = (fg) => ({
  fg,
  bg: hexToRgba(fg, 0.13),
})

export const buildTokens = (themeId) => {
  const theme = themes[themeId] || themes[DEFAULT_THEME_ID]
  const brand = theme.brand

  return {
    primary: brand.primary,
    primaryHover: brand.primaryHover,
    primaryActive: brand.primaryActive,
    primarySoft: brand.primarySoft,
    primaryBorder: brand.primaryBorder,
    background: basePalette.background,
    surface: basePalette.surface,
    surfaceElevated: basePalette.surfaceElevated,
    surfaceHover: basePalette.surfaceHover,
    border: basePalette.border,
    borderStrong: basePalette.borderStrong,
    text: basePalette.text,
    textSecondary: basePalette.textSecondary,
    textMuted: basePalette.textMuted,
    textDisabled: basePalette.textDisabled,

    navActive: brand.navActive,
    focusRing: brand.focusRing,
    link: brand.link,
    tabSelected: brand.tabSelected,
    mapAccent: brand.mapAccent,

    sidebarBg: basePalette.sidebarBg,
    sidebarBgHover: basePalette.sidebarBgHover,
    sidebarText: basePalette.sidebarText,
    sidebarTextMuted: basePalette.sidebarTextMuted,
    sidebarActiveBg: brand.navActive,
    sidebarActiveGlow: `0 0 16px ${hexToRgba(brand.navActive, 0.45)}, 0 0 4px ${hexToRgba(brand.navActive, 0.25)}`,

    semantic: { ...semantic },
    fleetStatus: { ...fleetStatus },
    maintenanceState: { ...maintenanceState },
    alertSeverity: { ...alertSeverity },

    spacing: { ...spacing },
    typography: {
      heading: { ...typography.heading },
      body: { ...typography.body },
      label: { ...typography.label },
      caption: { ...typography.caption },
    },
    motion: { ...motion },
    radius: { ...radius },
    shadow: {
      ...shadow,
      focus: `0 0 0 3px ${hexToRgba(brand.focusRing, 0.35)}`,
    },
    glass: { ...glass },
    accent: { ...accent },
    iconChip: {
      blue: buildIconChip(iconChipFg.blue),
      green: buildIconChip(iconChipFg.green),
      orange: buildIconChip(iconChipFg.orange),
      purple: buildIconChip(iconChipFg.purple),
      red: buildIconChip(iconChipFg.red),
      teal: buildIconChip(iconChipFg.teal),
    },
    trend: {
      up: semantic.success,
      down: semantic.danger,
      neutral: basePalette.textMuted,
    },
  }
}

export const applyCssVariables = (tokens) => {
  const root = document.documentElement
  const set = (name, value) => root.style.setProperty(name, String(value))

  set('--ft-primary', tokens.primary)
  set('--ft-primary-hover', tokens.primaryHover)
  set('--ft-primary-active', tokens.primaryActive)
  set('--ft-primary-soft', tokens.primarySoft)
  set('--ft-primary-border', tokens.primaryBorder)
  set('--ft-background', tokens.background)
  set('--ft-surface', tokens.surface)
  set('--ft-surface-elevated', tokens.surfaceElevated)
  set('--ft-surface-hover', tokens.surfaceHover)
  set('--ft-border', tokens.border)
  set('--ft-border-strong', tokens.borderStrong)
  set('--ft-text', tokens.text)
  set('--ft-text-secondary', tokens.textSecondary)
  set('--ft-text-muted', tokens.textMuted)
  set('--ft-text-disabled', tokens.textDisabled)
  set('--ft-nav-active', tokens.navActive)
  set('--ft-focus-ring', tokens.focusRing)
  set('--ft-link', tokens.link)
  set('--ft-tab-selected', tokens.tabSelected)
  set('--ft-map-accent', tokens.mapAccent)
  set('--ft-sidebar-bg', tokens.sidebarBg)
  set('--ft-sidebar-bg-hover', tokens.sidebarBgHover)
  set('--ft-sidebar-text', tokens.sidebarText)
  set('--ft-sidebar-text-muted', tokens.sidebarTextMuted)
  set('--ft-sidebar-active-bg', tokens.sidebarActiveBg)
  set('--ft-sidebar-active-glow', tokens.sidebarActiveGlow)

  set('--ft-semantic-success', tokens.semantic.success)
  set('--ft-semantic-warning', tokens.semantic.warning)
  set('--ft-semantic-danger', tokens.semantic.danger)
  set('--ft-semantic-info', tokens.semantic.info)
  set('--ft-semantic-neutral', tokens.semantic.neutral)

  set('--ft-status-moving', tokens.fleetStatus.moving)
  set('--ft-status-idle', tokens.fleetStatus.idle)
  set('--ft-status-parked', tokens.fleetStatus.parked)
  set('--ft-status-offline', tokens.fleetStatus.offline)

  set('--ft-maint-ok', tokens.maintenanceState.ok)
  set('--ft-maint-due-soon', tokens.maintenanceState.dueSoon)
  set('--ft-maint-overdue', tokens.maintenanceState.overdue)
  set('--ft-maint-no-baseline', tokens.maintenanceState.noBaseline)
  set('--ft-maint-unknown', tokens.maintenanceState.unknown)

  set('--ft-alert-critical', tokens.alertSeverity.critical)
  set('--ft-alert-warning', tokens.alertSeverity.warning)
  set('--ft-alert-info', tokens.alertSeverity.info)

  set('--ft-space-xs', `${tokens.spacing.xs}px`)
  set('--ft-space-sm', `${tokens.spacing.sm}px`)
  set('--ft-space-md', `${tokens.spacing.md}px`)
  set('--ft-space-lg', `${tokens.spacing.lg}px`)
  set('--ft-space-xl', `${tokens.spacing.xl}px`)
  set('--ft-space-2xl', `${tokens.spacing['2xl']}px`)

  set('--ft-motion-fast', tokens.motion.fast)
  set('--ft-motion-normal', tokens.motion.normal)
  set('--ft-motion-slow', tokens.motion.slow)
  set('--ft-motion-easing', tokens.motion.easing)
  set('--ft-motion-easing-out', tokens.motion.easingOut)
  set('--ft-motion-easing-in-out', tokens.motion.easingInOut)
  set('--ft-motion-hover-lift', tokens.motion.hoverLift)
  set('--ft-motion-press', tokens.motion.press)
  set('--ft-motion-dropdown-enter', tokens.motion.dropdownEnter)
  set('--ft-motion-transition', tokens.motion.transition)
  set('--ft-motion-transition-fast', tokens.motion.transitionFast)

  set('--ft-radius-sm', `${tokens.radius.sm}px`)
  set('--ft-radius-md', `${tokens.radius.md}px`)
  set('--ft-radius-lg', `${tokens.radius.lg}px`)
  set('--ft-radius-pill', `${tokens.radius.pill}px`)
  set('--ft-radius-element', `${tokens.radius.element}px`)
  set('--ft-radius-card', `${tokens.radius.card}px`)
  set('--ft-radius-container', `${tokens.radius.container}px`)

  set('--ft-shadow-xs', tokens.shadow.xs)
  set('--ft-shadow-sm', tokens.shadow.sm)
  set('--ft-shadow-md', tokens.shadow.md)
  set('--ft-shadow-lg', tokens.shadow.lg)
  set('--ft-shadow-card', tokens.shadow.card)
  set('--ft-shadow-card-hover', tokens.shadow.cardHover)
  set('--ft-shadow-dropdown', tokens.shadow.dropdown)
  set('--ft-shadow-focus', tokens.shadow.focus)
  set('--ft-shadow-elevation-1', tokens.shadow.elevation1)
  set('--ft-shadow-elevation-2', tokens.shadow.elevation2)
  set('--ft-shadow-elevation-3', tokens.shadow.elevation3)

  set('--ft-glass-bg', tokens.glass.bg)
  set('--ft-glass-bg-strong', tokens.glass.bgStrong)
  set('--ft-glass-border', tokens.glass.border)
  set('--ft-glass-blur', tokens.glass.blur)
  set('--ft-glass-blur-strong', tokens.glass.blurStrong)

  set('--ft-accent-default', tokens.accent.default)
  set('--ft-accent-hover', tokens.accent.hover)
  set('--ft-accent-active', tokens.accent.active)
  set('--ft-accent-soft', tokens.accent.soft)
  set('--ft-accent-border', tokens.accent.border)
  set('--ft-accent-focus', tokens.accent.focus)

  set('--ft-trend-up', tokens.trend.up)
  set('--ft-trend-down', tokens.trend.down)
  set('--ft-trend-neutral', tokens.trend.neutral)

  const iconChipKeys = ['blue', 'green', 'orange', 'purple', 'red', 'teal']
  iconChipKeys.forEach((key) => {
    set(`--ft-icon-chip-${key}-fg`, tokens.iconChip[key].fg)
    set(`--ft-icon-chip-${key}-bg`, tokens.iconChip[key].bg)
  })
}
