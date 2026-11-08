import { validateCompact } from '../../supabase/functions/forecast-refresh/logic'
import { forecastTooOld } from './forecastAge'
import { RATE_LIMIT_WAIT_MS, refreshDelay, retryAtOf } from './openMeteoLimit'
import { fetchForecastGrid, landGrid, trimGrid, type ForecastGrid } from './rainMap'

// The island forecast is fetched once an hour by the forecast-refresh Edge Function and kept in
// the island_forecast table (migration 0007), so phones read it from there instead of each asking
// Open-Meteo. This is the app's side of that: reading the table, and choosing between it and a
// direct request to Open-Meteo.

// A cached forecast up to this old is used as it is. The function runs hourly, so this lets one
// missed run pass without sending every user back to Open-Meteo.
export const CACHE_FRESH_MAX_AGE_MS = 150 * 60_000
const READ_TIMEOUT_MS = 8000
// A forecast "from the future" by more than this means a wrong clock or a bad row. Not used.
const MAX_FUTURE_SKEW_MS = 5 * 60_000

// What one row of island_forecast looks like when read back as the app asks for it
export function gridFromCacheRow(row: unknown, now: number): ForecastGrid | null {
  try {
    const { fetched_at, point_count, data } = (row ?? {}) as { fetched_at?: unknown; point_count?: unknown; data?: unknown }
    const fetchedAt = typeof fetched_at === 'string' ? Date.parse(fetched_at) : NaN
    const expected = landGrid().cells.length
    if (!Number.isFinite(fetchedAt) || fetchedAt > now + MAX_FUTURE_SKEW_MS) return null
    // Not the grid this version of the app draws, so its cells would be in the wrong places
    if (point_count !== expected) return null
    const compact = validateCompact(data, expected)
    // A clock a few minutes fast can't make the forecast younger than now
    return trimGrid(compact.times, compact.cells, Math.min(fetchedAt, now), now)
  } catch {
    return null
  }
}

type ReadOptions = { url?: string; key?: string; fetchFn?: typeof fetch; now?: number }

// Reads the cached row with a plain request (the Supabase client is a big download, and the map
// shouldn't wait for it). It never throws: anything wrong gives null, and the caller goes on to
// ask Open-Meteo. The cache is public data, so the anon key is all it needs.
export async function fetchCachedForecast(options: ReadOptions = {}): Promise<ForecastGrid | null> {
  const url = options.url ?? import.meta.env.VITE_SUPABASE_URL
  const key = options.key ?? import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY
  if (!url || !key) return null
  try {
    const res = await (options.fetchFn ?? fetch)(`${url}/rest/v1/island_forecast?select=fetched_at,point_count,data&id=eq.1&limit=1`, {
      // Only the apikey header: the new publishable keys are not JWTs, so they can't go in Authorization
      headers: { apikey: key, Accept: 'application/json' },
      signal: AbortSignal.timeout(READ_TIMEOUT_MS),
    })
    if (!res.ok) return null
    const rows: unknown = await res.json()
    return Array.isArray(rows) && rows.length > 0 ? gridFromCacheRow(rows[0], options.now ?? Date.now()) : null
  } catch {
    return null
  }
}

export type LoadDeps = {
  // The cached forecast, or null if there is none or it can't be used. Must not throw.
  readCache: () => Promise<ForecastGrid | null>
  // A request straight to Open-Meteo. Throws if it fails (a 429 included).
  direct: () => Promise<ForecastGrid>
  now: () => number
  // Says which way it went, for the dev console
  note?: (path: string) => void
}

// The order:
//   1. a cached forecast up to 150 minutes old is used as it is;
//   2. otherwise ask Open-Meteo directly;
//   3. if that fails too, use the cached one anyway, marked stale, as long as it is inside the
//      6-hour age cap (it then shows with "Forecast from ...");
//   4. with nothing usable left the direct error is thrown, and the map says unavailable.
export async function loadForecast({ readCache, direct, now, note }: LoadDeps): Promise<ForecastGrid> {
  const cached = await readCache()
  if (cached && now() - cached.fetchedAt <= CACHE_FRESH_MAX_AGE_MS) {
    note?.('forecast: using the shared cache')
    return cached
  }
  note?.(cached ? 'forecast: cache too old, asking Open-Meteo' : 'forecast: no usable cache, asking Open-Meteo')
  try {
    return await direct()
  } catch (error) {
    if (cached && !forecastTooOld(cached.fetchedAt, now())) {
      note?.('forecast: Open-Meteo failed, using the old cache')
      return { ...cached, staleCache: true }
    }
    note?.('forecast: Open-Meteo failed and there is no usable cache')
    throw error
  }
}

// What the island map's query calls
export function loadIslandForecast(): Promise<ForecastGrid> {
  return loadForecast({
    readCache: async () => {
      if (import.meta.env.DEV) {
        const fake = await import('./fakeForecastCache')
        const mode = fake.fakeForecastCacheMode()
        if (mode) return fake.fakeCacheRead(mode, Date.now())
      }
      return fetchCachedForecast()
    },
    direct: fetchForecastGrid,
    now: Date.now,
    note: import.meta.env.DEV ? (path) => console.info(path) : undefined,
  })
}

// How long until the island forecast is asked for again. Normally `normalMs`. After a 429 it is
// the rest of the wait. A forecast taken from the stale cache is tried again sooner, after the
// wait if there is one and otherwise in 10 minutes, since a fresh one may well be on offer by then.
export function islandRefreshDelay(
  error: unknown,
  grid: ForecastGrid | undefined,
  now: number,
  normalMs: number,
  waitUntil: number | null,
): number {
  if (retryAtOf(error) !== null) return refreshDelay(error, now, normalMs)
  if (grid?.staleCache) return Math.max((waitUntil ?? now + RATE_LIMIT_WAIT_MS) - now, 0) + 1000
  return normalMs
}
