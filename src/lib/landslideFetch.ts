import { parseLandslide, type LandslideAnswer } from './landslide'
import { LANDSLIDE_SAVED_MAX_AGE_MS } from './offline'

// Reading landslide_current() (migration 0011), and how often to ask again. It is public data, so the
// publishable key is all it needs. Like newsFetch.ts this is a plain request: the Supabase client is a
// big download, and the warning shouldn't wait for it.

export const READ_TIMEOUT_MS = 8000

export function landslideUrl(base: string): string {
  return `${base}/rest/v1/rpc/landslide_current`
}

type ReadOptions = { url?: string; key?: string; fetchFn?: typeof fetch }

// The newest warning, or null when anything is wrong (no connection, a timeout, an error answer, an
// answer that makes no sense). Never throws. Null is not the same as "no warning": the caller keeps
// what it has.
export async function fetchLandslide(options: ReadOptions = {}): Promise<LandslideAnswer | null> {
  const base = options.url ?? import.meta.env.VITE_SUPABASE_URL
  const key = options.key ?? import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY
  if (!base || !key) return null
  try {
    const res = await (options.fetchFn ?? fetch)(landslideUrl(base), {
      method: 'POST',
      // Only the apikey header: the new publishable keys are not JWTs, so they can't go in Authorization
      headers: { apikey: key, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: '{}',
      signal: AbortSignal.timeout(READ_TIMEOUT_MS),
    })
    if (!res.ok) return null
    return parseLandslide(await res.json())
  } catch {
    return null
  }
}

// What the query runs. A failed read throws, so TanStack Query keeps the warning it already has; "no
// warning" is a good answer.
export async function loadLandslide(read: () => Promise<LandslideAnswer | null> = fetchLandslide): Promise<LandslideAnswer> {
  if (import.meta.env.DEV) {
    const fake = await import('./fakeLandslide')
    const mode = fake.fakeLandslideMode()
    if (mode) return fake.fakeLandslideAnswer(mode, Date.now())
  }
  const answer = await read()
  if (answer === null) throw new Error('Landslide warnings unavailable')
  return answer
}

// The function stores a warning every 30 minutes at most, so this is gentle: every 10 minutes while
// the app is open, and when it comes back to the foreground or reconnects (once the last answer is a
// minute old). Nothing is pushed: no Realtime.
export const LANDSLIDE_REFRESH_MS = 10 * 60_000
export const LANDSLIDE_STALE_MS = 60_000
export const LANDSLIDE_RETRY_DELAY_MS = 5_000

export const landslideQueryOptions = {
  refetchInterval: LANDSLIDE_REFRESH_MS,
  // Not while the tab is hidden
  refetchIntervalInBackground: false,
  refetchOnWindowFocus: true,
  refetchOnReconnect: true,
  staleTime: LANDSLIDE_STALE_MS,
  // Kept as long as it is saved on the phone, so it is there to show offline
  gcTime: LANDSLIDE_SAVED_MAX_AGE_MS,
  retry: 1,
  retryDelay: LANDSLIDE_RETRY_DELAY_MS,
} as const
