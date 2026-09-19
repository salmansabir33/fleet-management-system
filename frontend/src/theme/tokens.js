// Shared, theme-independent design tokens.
// Brand/accent slices live in themes.js and are merged at runtime by
// ThemeProvider — semantic / status / severity colors here are NEVER
// altered by theme switching.

export const basePalette = {
  // Brand-independent surfaces & text — corporate SaaS neutrals (mockup-aligned).
  // Themes may only override the brand slice, not these.
  background: '#f9fafb',
  surface: '#ffffff',
  surfaceElevated: '#ffffff',
  surfaceHover: '#f3f4f6',
  border: '#e5e7eb',
  borderStrong: '#d1d5db',
  text: '#111827',
  textSecondary: '#4b5563',
  textMuted: '#6b7280',
  textDisabled: '#9ca3af',

  // Sidebar chrome (layout chrome, not brand accent)
  sidebarBg: '#111827',
  sidebarBgHover: '#1f2937',
  sidebarText: '#cbd5e1',
  sidebarTextMuted: '#64748b',
}

// Mockup accent — reference palette for the corporate indigo/blue brand.
// Runtime accent still comes from themes.js brand slice; use these only when
// defining the default indigo theme or documenting the target hue.
export const accent = {
  default: '#4f46e5',
  hover: '#4338ca',
  active: '#3730a3',
  soft: '#eef2ff',
  border: '#c7d2fe',
  focus: '#6366f1',
}

// Semantic tokens — kept SEPARATE from the brand palette.
export const semantic = {
  success: '#059669',
  warning: '#d97706',
  danger: '#dc2626',
  info: '#2563eb',
  neutral: '#6b7280',
}

export const fleetStatus = {
  moving: '#0d9488',
  idle: '#d97706',
  parked: '#6b7280',
  offline: '#dc2626',
}

export const maintenanceState = {
  ok: '#0d9488',
  dueSoon: '#d97706',
  overdue: '#dc2626',
  noBaseline: '#9ca3af',
  unknown: '#9ca3af',
}

export const alertSeverity = {
  critical: '#dc2626',
  warning: '#d97706',
  info: '#2563eb',
}

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  '2xl': 32,
}

export const typography = {
  heading: { size: 20, weight: 700 },
  body: { size: 14, weight: 400 },
  label: { size: 13, weight: 600 },
  caption: { size: 12, weight: 500 },
}

export const radius = {
  sm: 8,
  md: 12,
  lg: 16,
  pill: 999,
  // Semantic aliases — mockup scale (elements ~8px, cards ~12px)
  element: 8,
  card: 12,
  container: 16,
}

// Base elevation shadows (theme-independent). `focus` is merged at build time
// from the active brand accent — see buildTokens.js.
export const shadow = {
  xs: '0 1px 2px rgba(16, 24, 40, 0.04), 0 1px 1px rgba(16, 24, 40, 0.03)',
  sm: '0 1px 3px rgba(16, 24, 40, 0.05), 0 1px 2px rgba(16, 24, 40, 0.04)',
  md: '0 2px 4px rgba(16, 24, 40, 0.06), 0 1px 2px rgba(16, 24, 40, 0.04)',
  lg: '0 4px 8px rgba(16, 24, 40, 0.08), 0 2px 4px rgba(16, 24, 40, 0.04)',
  card: '0 4px 6px -1px rgba(16, 24, 40, 0.08), 0 1px 3px rgba(16, 24, 40, 0.04)',
  cardHover: '0 8px 20px rgba(16, 24, 40, 0.10), 0 2px 8px rgba(16, 24, 40, 0.05)',
  dropdown: '0 4px 16px rgba(16, 24, 40, 0.12), 0 2px 6px rgba(16, 24, 40, 0.08)',
  // Elevation scale — mockup-aligned (subtle card → raised/hover → modal/glass)
  elevation1: '0 1px 3px rgba(16, 24, 40, 0.05), 0 1px 2px rgba(16, 24, 40, 0.04)',
  elevation2: '0 8px 24px rgba(16, 24, 40, 0.10), 0 2px 8px rgba(16, 24, 40, 0.06)',
  elevation3: '0 16px 48px rgba(16, 24, 40, 0.14), 0 4px 16px rgba(16, 24, 40, 0.08)',
}

// Glassmorphism — nav bars, floating panels, modal chrome (mockup style).
export const glass = {
  bg: 'rgba(255, 255, 255, 0.82)',
  bgStrong: 'rgba(255, 255, 255, 0.92)',
  border: 'rgba(229, 231, 235, 0.65)',
  blur: '12px',
  blurStrong: '20px',
}

// Foreground hues for stat-card icon chips — backgrounds are tinted at build time.
export const iconChipFg = {
  blue: semantic.info,
  green: semantic.success,
  orange: semantic.warning,
  purple: '#7c3aed',
  red: semantic.danger,
  teal: fleetStatus.moving,
}

export const motion = {
  fast: '120ms',
  normal: '200ms',
  slow: '320ms',
  easing: 'cubic-bezier(0.4, 0, 0.2, 1)',
  easingOut: 'cubic-bezier(0, 0, 0.2, 1)',
  easingInOut: 'cubic-bezier(0.4, 0, 0.2, 1)',
  hoverLift: 'transform 160ms cubic-bezier(0.4, 0, 0.2, 1), box-shadow 160ms cubic-bezier(0.4, 0, 0.2, 1)',
  press: 'transform 100ms ease-out',
  dropdownEnter: 'opacity 140ms ease-out, transform 140ms cubic-bezier(0.16, 1, 0.3, 1)',
  // Standard micro-interaction bundle for hover/focus states (use in components later).
  transition: 'background 200ms cubic-bezier(0.4, 0, 0.2, 1), border-color 200ms cubic-bezier(0.4, 0, 0.2, 1), color 200ms cubic-bezier(0.4, 0, 0.2, 1), box-shadow 200ms cubic-bezier(0.4, 0, 0.2, 1), transform 200ms cubic-bezier(0.4, 0, 0.2, 1), opacity 200ms cubic-bezier(0.4, 0, 0.2, 1)',
  transitionFast: 'background 120ms cubic-bezier(0.4, 0, 0.2, 1), border-color 120ms cubic-bezier(0.4, 0, 0.2, 1), color 120ms cubic-bezier(0.4, 0, 0.2, 1), box-shadow 120ms cubic-bezier(0.4, 0, 0.2, 1), transform 120ms cubic-bezier(0.4, 0, 0.2, 1)',
}
