// Legacy design tokens — exact values previously exported from
// src/user/theme.js. Kept byte-stable so existing importers and
// inline styles see no visual change while the new token system lands.

export const colors = {
  sidebarBg: '#111827',
  sidebarBgHover: '#1f2937',
  sidebarText: '#cbd5e1',
  sidebarTextMuted: '#64748b',
  accent: '#0d9488',
  accentSoft: '#ccfbf1',

  bg: '#f3f4f6',
  surface: '#ffffff',
  border: '#e5e7eb',

  text: '#111827',
  textMuted: '#6b7280',
  textFaint: '#9ca3af',

  statusMoving: '#0d9488',
  statusIdle: '#d97706',
  statusParked: '#6b7280',
  statusOffline: '#dc2626',

  critical: '#dc2626',
  criticalSoft: '#fee2e2',
  warning: '#d97706',
  warningSoft: '#fef3c7',
  info: '#2563eb',
  infoSoft: '#dbeafe',
}

export const severityMeta = {
  critical: { label: 'Critical', color: colors.critical, bg: colors.criticalSoft },
  warning: { label: 'Warning', color: colors.warning, bg: colors.warningSoft },
  info: { label: 'Info', color: colors.info, bg: colors.infoSoft },
}

export const statusMeta = {
  moving: { label: 'Moving', color: colors.statusMoving },
  idle: { label: 'Idle', color: colors.statusIdle },
  stopped: { label: 'Parked', color: colors.statusParked },
  offline: { label: 'Offline', color: colors.statusOffline },
}

export const maintenanceStatusMeta = {
  ok: { label: 'OK', color: colors.statusMoving, bg: colors.accentSoft },
  due_soon: { label: 'Due soon', color: colors.warning, bg: colors.warningSoft },
  overdue: { label: 'Overdue', color: colors.critical, bg: colors.criticalSoft },
  no_baseline: { label: 'No data', color: colors.textFaint, bg: colors.bg },
  unknown: { label: 'Unknown', color: colors.textFaint, bg: colors.bg },
}

export const radius = {
  sm: 6,
  md: 10,
  lg: 16,
}

export const shadow = {
  card: '0 1px 2px rgba(16,24,40,0.06), 0 1px 3px rgba(16,24,40,0.08)',
}
