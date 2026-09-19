import { Card } from '../../shared/components'
import { AppearancePicker } from '../../shared/shell/AppearancePicker'

/** Surfaces the shared theme picker on the dashboard (shell ProfileMenu also has it). */
export function DashboardAppearanceCard() {
  return (
    <Card title="Appearance">
      <AppearancePicker />
    </Card>
  )
}

export default DashboardAppearanceCard
