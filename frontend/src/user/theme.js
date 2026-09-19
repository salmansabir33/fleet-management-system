// Shared design tokens — source of truth now lives in src/theme/.
// This file re-exports the same public API so every existing
// `from '../theme'` / `from '../../user/theme'` import keeps working.

export {
  colors,
  severityMeta,
  statusMeta,
  maintenanceStatusMeta,
  radius,
  shadow,
  basePalette,
  semantic,
  fleetStatus,
  maintenanceState,
  alertSeverity,
  spacing,
  typography,
  motion,
  themes,
  availableThemes,
  DEFAULT_THEME_ID,
  isValidThemeId,
  ThemeProvider,
  useTheme,
  THEME_STORAGE_KEY,
  buildTokens,
  applyCssVariables,
  AppearanceMenu,
} from '../theme'
