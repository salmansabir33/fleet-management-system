// Back-compat shim — Batch C shells use AppearancePicker in ProfileMenu.
// Keep this export so any older import of AppearanceMenu still resolves.
export { AppearancePicker as default, AppearancePicker as AppearanceMenu } from '../shared/shell/AppearancePicker'
