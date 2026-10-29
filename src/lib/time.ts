function describe(ms: number): string {
  const minutes = Math.round(ms / 60_000)
  if (minutes < 60) return `${Math.max(minutes, 1)} min`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours} h`
  return `${Math.round(hours / 24)} d`
}

export function timeAgo(iso: string, now = Date.now()): string {
  const ms = now - new Date(iso).getTime()
  if (ms < 60_000) return 'just now'
  return `${describe(ms)} ago`
}

export function expiresIn(iso: string, now = Date.now()): string {
  const ms = new Date(iso).getTime() - now
  if (ms <= 0) return 'expiring now'
  return `expires in ${describe(ms)}`
}
