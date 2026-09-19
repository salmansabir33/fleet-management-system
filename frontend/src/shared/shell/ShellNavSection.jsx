export function ShellNavSection({ label, expanded = true }) {
  if (!expanded || !label) return null
  return <div className="ft-shell-nav-section">{label}</div>
}
