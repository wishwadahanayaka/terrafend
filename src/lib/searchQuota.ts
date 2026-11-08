// When the route service says its daily search quota is used up, there is no point asking it
// again on every search: each try fails, slowly, and then the backup search answers anyway.
// So the quota being used up is remembered in the browser until the quota resets, and
// searches go straight to the backup meanwhile. Routes have their own quota and never come
// through here.

const KEY = 'terrafend:search-quota-until'

// If the service doesn't say when the quota resets, wait this long before trying again
export const UNKNOWN_RESET_MS = 3_600_000
// A reset time further away than this isn't believed (a day is the longest a quota lasts)
const MAX_WAIT_MS = 48 * 3_600_000

// The routing function words its answer like this, and since 0005 also sends quota: "search"
// and reset_at. The words let an older deployed function work too.
const QUOTA_TEXT = 'The daily limit for searches and routes has been reached'

export const isQuotaMessage = (message: string) => message.startsWith(QUOTA_TEXT)

// When to try the main search again: the reset time if it is a sensible one in the future,
// otherwise an hour from now
export function quotaUntil(now: number, resetAt: string | number | null | undefined): number {
  const ms = typeof resetAt === 'string' ? Date.parse(resetAt) : resetAt
  if (typeof ms === 'number' && Number.isFinite(ms) && ms > now && ms <= now + MAX_WAIT_MS) return ms
  return now + UNKNOWN_RESET_MS
}

// What storage holds is just the time, as text. Anything else counts as not remembered.
export function isQuotaActive(stored: string | number | null, now: number): boolean {
  if (stored === null || stored === '') return false
  const until = Number(stored)
  return Number.isFinite(until) && until > now && until <= now + MAX_WAIT_MS
}

// Kept in memory too, so it still works for this visit if storage is blocked, and so a dev
// test can use it without leaving anything behind in the browser
let remembered = 0

export function searchQuotaActive(now = Date.now()): boolean {
  if (remembered > now) return true
  try {
    return isQuotaActive(localStorage.getItem(KEY), now)
  } catch {
    return false
  }
}

export function rememberSearchQuota(until: number, persist = true) {
  remembered = until
  if (!persist) return
  try {
    localStorage.setItem(KEY, String(until))
  } catch {
    // only remembered for this visit
  }
}

// For tests: forget what is held in memory
export function forgetSearchQuota() {
  remembered = 0
  try {
    localStorage.removeItem(KEY)
  } catch {
    // nothing to forget
  }
}
