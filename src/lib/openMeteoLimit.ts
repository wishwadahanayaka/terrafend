// Open-Meteo is free but limited per IP address (a request for many places counts once per
// place). When it answers 429 (Too Many Requests), asking again straight away only makes
// it worse, so the app waits before the next try, for the island forecast and the route
// forecast alike. These are the pieces of that, kept free of the network so they can be tested.

const KEY = 'terrafend:open-meteo-wait-until'

// The shortest wait after a 429, whatever the answer says
export const RATE_LIMIT_WAIT_MS = 10 * 60_000
const HOURLY_WAIT_MS = 30 * 60_000
const DAILY_WAIT_MS = 60 * 60_000
// A wait longer than this isn't believed (a daily limit would say "try again tomorrow")
const MAX_WAIT_MS = 6 * 3_600_000

export class OpenMeteoError extends Error {
  status: number
  // Open-Meteo's own words for why it said no, if it said
  reason: string | null
  // For a 429: when it is fine to ask again
  retryAt: number | null

  constructor(message: string, status: number, reason: string | null, retryAt: number | null) {
    super(message)
    this.name = 'OpenMeteoError'
    this.status = status
    this.reason = reason
    this.retryAt = retryAt
  }
}

// Errors come as {"error": true, "reason": "Minutely API request limit exceeded..."}
export function limitReason(body: unknown): string | null {
  if (typeof body !== 'object' || body === null) return null
  const reason = (body as { reason?: unknown }).reason
  return typeof reason === 'string' && reason.trim() !== '' ? reason.trim().slice(0, 200) : null
}

// Retry-After is a number of seconds or a date. Null when it is missing or makes no sense.
export function parseRetryAfter(header: string | null, now: number): number | null {
  const text = header?.trim()
  if (!text) return null
  const seconds = Number(text)
  if (Number.isFinite(seconds)) return seconds >= 0 ? seconds * 1000 : null
  const date = Date.parse(text)
  return Number.isFinite(date) ? Math.max(0, date - now) : null
}

// How long to leave Open-Meteo alone: at least 10 minutes, longer if it says so (in
// Retry-After) or if the reason says the hourly or daily allowance is gone.
export function rateLimitWait(reason: string | null, retryAfterMs: number | null): number {
  const base = /daily/i.test(reason ?? '') ? DAILY_WAIT_MS : /hourly/i.test(reason ?? '') ? HOURLY_WAIT_MS : RATE_LIMIT_WAIT_MS
  return Math.min(Math.max(base, retryAfterMs ?? 0), MAX_WAIT_MS)
}

export const isRateLimit = (error: unknown): error is OpenMeteoError =>
  error instanceof OpenMeteoError && error.status === 429

export const retryAtOf = (error: unknown): number | null => (isRateLimit(error) ? error.retryAt : null)

// A failed forecast request is tried once more after a pause, except a 429: that one waits
export function shouldRetry(failureCount: number, error: Error): boolean {
  return !isRateLimit(error) && failureCount < 1
}

// How long until the forecast is asked for again. Normally `normalMs`. After a 429 it is the
// rest of the wait, and a second more so it doesn't land just before the wait is over.
export function refreshDelay(error: unknown, now: number, normalMs: number): number {
  const retryAt = retryAtOf(error)
  if (retryAt === null) return normalMs
  return Math.max(retryAt - now, 0) + 1000
}

// What storage holds is just the time, as text. Anything else counts as not remembered.
export function isWaitActive(stored: string | number | null, now: number): boolean {
  if (stored === null || stored === '') return false
  const until = Number(stored)
  return Number.isFinite(until) && until > now && until <= now + MAX_WAIT_MS
}

// Kept in memory too, so it still works for this visit if storage is blocked, and so a dev
// test can use it without leaving anything behind in the browser
let remembered = 0

// When it is fine to ask again, or null if there is nothing to wait for
export function rateLimitedUntil(now = Date.now()): number | null {
  if (remembered > now) return remembered
  try {
    const stored = localStorage.getItem(KEY)
    if (isWaitActive(stored, now)) return Number(stored)
  } catch {
    // storage blocked: only the memory counts
  }
  return null
}

export function rememberRateLimit(until: number, persist = true) {
  remembered = until
  if (!persist) return
  try {
    localStorage.setItem(KEY, String(until))
  } catch {
    // only remembered for this visit
  }
}

// For tests: forget what is held in memory
export function forgetRateLimit() {
  remembered = 0
  try {
    localStorage.removeItem(KEY)
  } catch {
    // nothing to forget
  }
}
