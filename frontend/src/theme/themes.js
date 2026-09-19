// Brand/accent slices only. A theme must NEVER change layout, routes,
// permissions, business logic, or semantic/status/severity colors.

export const DEFAULT_THEME_ID = 'indigo'

export const themes = {
  indigo: {
    id: 'indigo',
    name: 'Indigo',
    brand: {
      primary: '#4f46e5',
      primaryHover: '#4338ca',
      primaryActive: '#3730a3',
      primarySoft: '#eef2ff',
      primaryBorder: '#c7d2fe',
      navActive: '#4f46e5',
      focusRing: '#6366f1',
      link: '#4f46e5',
      tabSelected: '#4f46e5',
      mapAccent: '#4f46e5',
    },
  },
  ocean: {
    id: 'ocean',
    name: 'Ocean',
    brand: {
      primary: '#0d9488',
      primaryHover: '#0f766e',
      primaryActive: '#115e59',
      primarySoft: '#ccfbf1',
      primaryBorder: '#99f6e4',
      navActive: '#0d9488',
      focusRing: '#14b8a6',
      link: '#0d9488',
      tabSelected: '#0d9488',
      mapAccent: '#0d9488',
    },
  },
  emerald: {
    id: 'emerald',
    name: 'Emerald',
    brand: {
      primary: '#059669',
      primaryHover: '#047857',
      primaryActive: '#065f46',
      primarySoft: '#d1fae5',
      primaryBorder: '#a7f3d0',
      navActive: '#059669',
      focusRing: '#10b981',
      link: '#059669',
      tabSelected: '#059669',
      mapAccent: '#059669',
    },
  },
  crimson: {
    id: 'crimson',
    name: 'Crimson',
    brand: {
      primary: '#dc2626',
      primaryHover: '#b91c1c',
      primaryActive: '#991b1b',
      primarySoft: '#fee2e2',
      primaryBorder: '#fecaca',
      navActive: '#dc2626',
      focusRing: '#ef4444',
      link: '#dc2626',
      tabSelected: '#dc2626',
      mapAccent: '#dc2626',
    },
  },
  violet: {
    id: 'violet',
    name: 'Violet',
    brand: {
      primary: '#7c3aed',
      primaryHover: '#6d28d9',
      primaryActive: '#5b21b6',
      primarySoft: '#ede9fe',
      primaryBorder: '#ddd6fe',
      navActive: '#7c3aed',
      focusRing: '#8b5cf6',
      link: '#7c3aed',
      tabSelected: '#7c3aed',
      mapAccent: '#7c3aed',
    },
  },
  amber: {
    id: 'amber',
    name: 'Amber',
    brand: {
      primary: '#d97706',
      primaryHover: '#b45309',
      primaryActive: '#92400e',
      primarySoft: '#fef3c7',
      primaryBorder: '#fde68a',
      navActive: '#d97706',
      focusRing: '#f59e0b',
      link: '#d97706',
      tabSelected: '#d97706',
      mapAccent: '#d97706',
    },
  },
  slate: {
    id: 'slate',
    name: 'Slate',
    brand: {
      primary: '#475569',
      primaryHover: '#334155',
      primaryActive: '#1e293b',
      primarySoft: '#e2e8f0',
      primaryBorder: '#cbd5e1',
      navActive: '#475569',
      focusRing: '#64748b',
      link: '#475569',
      tabSelected: '#475569',
      mapAccent: '#475569',
    },
  },
}

export const availableThemes = Object.values(themes).map(({ id, name }) => ({ id, name }))

export const isValidThemeId = (id) => Boolean(id && themes[id])
