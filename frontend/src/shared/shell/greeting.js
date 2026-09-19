const HOUR_MSGS = [
  { before: 12, greeting: 'Good morning' },
  { before: 17, greeting: 'Good afternoon' },
  { before: 24, greeting: 'Good evening' },
]

export function getTimeGreeting(name) {
  const hour = new Date().getHours()
  const base = HOUR_MSGS.find((slot) => hour < slot.before)?.greeting || 'Hello'
  const display = name ? `${base}, ${name}` : base
  return `${display}!`
}
