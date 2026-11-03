function describe(ms: number): string {
  const minutes = Math.round(ms / 60_000)
  if (minutes < 60) return `${Math.max(minutes, 1)} min`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours} h`
  return `${Math.round(hours / 24)} d`
}

// Rounded to whole minutes, since a driving estimate isn't more exact than that
export function routeDuration(seconds: number): string {
  const minutes = Math.max(1, Math.round(seconds / 60))
  if (minutes < 60) return `about ${minutes} min`
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return rest ? `about ${hours} h ${rest} min` : `about ${hours} h`
}

const colombo = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Colombo',
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
  hour12: true,
})

// The API sends UTC; people here think in Sri Lanka time wherever their phone is set
export function sriLankaTime(iso: string): string {
  return `${colombo.format(new Date(iso))} (Sri Lanka time)`
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
