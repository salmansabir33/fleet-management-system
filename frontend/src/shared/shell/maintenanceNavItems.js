// Single source of truth for the per-vehicle Maintenance tab list
// (in-page tabs + Admin/Manager sidebar). User sidebar reuses the
// entry/report labels from here so they cannot drift.

export const MAINTENANCE_NAV_LABELS = {
  overview: 'Overview',
  baseline: 'Baseline Setup',
  entry: 'Add Maintenance',
  report: 'Maintenance Report',
}

export const buildMaintenanceNavItems = (paths, hasBaseline) => {
  const items = [
    { to: paths.index, label: MAINTENANCE_NAV_LABELS.overview, end: true },
    { to: paths.baseline, label: MAINTENANCE_NAV_LABELS.baseline },
    { to: paths.entry, label: MAINTENANCE_NAV_LABELS.entry },
    { to: paths.report, label: MAINTENANCE_NAV_LABELS.report },
  ]
  if (hasBaseline) return items.filter((item) => item.to !== paths.baseline)
  return items
}
