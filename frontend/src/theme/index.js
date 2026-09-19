// Theme system public surface. Existing `src/user/theme.js` re-exports
// the legacy tokens from here so no importer path breaks.

export {
  colors,
  severityMeta,
  statusMeta,
  maintenanceStatusMeta,
} from './legacy'

export {
  basePalette,
  accent,
  semantic,
  fleetStatus,
  maintenanceState,
  alertSeverity,
  spacing,
  typography,
  motion,
  glass,
  shadow,
  radius,
} from './tokens'

export {
  themes,
  availableThemes,
  DEFAULT_THEME_ID,
  isValidThemeId,
} from './themes'

export {
  ThemeProvider,
  useTheme,
} from './ThemeContext'

export { THEME_STORAGE_KEY, detectPortal, storageKeyFor } from './storage'

export { buildTokens, applyCssVariables } from './buildTokens'

export { default as AppearanceMenu } from './AppearanceMenu'
