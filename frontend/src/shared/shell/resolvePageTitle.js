/**
 * Pick the best-matching nav label for the current pathname.
 * Longer paths are checked first so nested routes resolve correctly.
 */
export function resolvePageTitle(pathname, navItems, fallback = 'Dashboard') {
  const sorted = [...navItems]
    .filter((item) => item.to && !item.disabled)
    .sort((a, b) => b.to.length - a.to.length)

  const match = sorted.find((item) => (
    pathname === item.to || pathname.startsWith(`${item.to}/`)
  ))

  return match?.label ?? fallback
}
