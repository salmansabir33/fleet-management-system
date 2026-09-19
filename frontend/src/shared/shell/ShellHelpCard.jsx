import { Card, Button } from '../components'

export function ShellHelpCard({ expanded = true, onContactSupport }) {
  if (!expanded) return null

  return (
    <Card className="ft-shell-help-card">
      <div className="ft-shell-help-card-title">Need Help?</div>
      <p className="ft-shell-help-card-text">
        Contact our support team for any assistance.
      </p>
      <Button
        type="button"
        variant="primary"
        size="sm"
        className="ft-shell-help-card-btn"
        onClick={onContactSupport}
      >
        Contact Support
      </Button>
    </Card>
  )
}
