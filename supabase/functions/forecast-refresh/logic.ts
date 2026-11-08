// The parts of the forecast-refresh function that need no network or database, so tests can
// run them with stand-ins. The function (index.ts) only wires them to Open-Meteo and the
// island_forecast table. The app imports validateCompact from here too, so the function and the
// app judge a forecast by the very same rules.
//
// No imports and no Deno-only calls in this file, on purpose: it has to load in Deno, in the
// browser build and in the tests.

const API_URL = 'https://api.open-meteo.com/v1/forecast'

// Asking again sooner than this is refused unless ?force=true comes with the secret, so a
// double-fired job or a manual test can't spend the calls twice
export const MIN_INTERVAL_MS = 30 * 60_000
// The one in-run retry (network errors and 5xx only, never a 429) waits this long
export const RETRY_DELAY_MS = 5_000
// Two days from midnight is 48 hours. Fewer than a day means something is wrong with the answer.
const MIN_HOURS = 24

export type Point = [lat: number, lng: number]

// The forecast as it is stored and as the app keeps it: the hour labels once, and for every
// grid point (same order as the grid) its hourly rain, weather code and chance of rain
export type Compact = {
  times: string[]
  cells: { mm: (number | null)[]; code: (number | null)[]; chance: (number | null)[] }[]
}

// The same request the app makes straight to Open-Meteo (a test checks they match)
export function buildUrl(points: Point[]): string {
  const lat = points.map(([la]) => la.toFixed(2)).join(',')
  const lng = points.map(([, lo]) => lo.toFixed(2)).join(',')
  return (
    `${API_URL}?latitude=${lat}&longitude=${lng}&hourly=precipitation,weather_code,precipitation_probability` +
    `&timezone=Asia%2FColombo&forecast_days=2`
  )
}

// Compares hashes so the check takes the same time wherever the strings differ
async function sameSecret(a: string, b: string): Promise<boolean> {
  const enc = new TextEncoder()
  const [x, y] = await Promise.all([crypto.subtle.digest('SHA-256', enc.encode(a)), crypto.subtle.digest('SHA-256', enc.encode(b))])
  const xa = new Uint8Array(x)
  const ya = new Uint8Array(y)
  let diff = 0
  for (let i = 0; i < xa.length; i++) diff |= xa[i] ^ ya[i]
  return diff === 0
}

// No secret set means nobody gets in, rather than everybody
export async function isAuthorised(sent: string | null, expected: string | undefined): Promise<boolean> {
  if (!expected || !sent) return false
  return sameSecret(sent, expected)
}

// Open-Meteo's errors come as {"error": true, "reason": "..."}
export function limitReason(body: unknown): string | null {
  if (typeof body !== 'object' || body === null) return null
  const reason = (body as { reason?: unknown }).reason
  return typeof reason === 'string' && reason.trim() !== '' ? reason.trim().slice(0, 200) : null
}

const isNumbers = (v: unknown, min: number, max: number): v is (number | null)[] =>
  Array.isArray(v) && v.every((n) => n === null || (typeof n === 'number' && Number.isFinite(n) && n >= min && n <= max))

// Checks a forecast has the shape and the sizes it should, and sensible numbers. Throws if not.
// Used on what Open-Meteo sends (before anything is stored) and on what the app reads back.
export function validateCompact(data: unknown, expectedCells: number): Compact {
  const { times, cells } = (data ?? {}) as Partial<Compact>
  if (!Array.isArray(times) || !times.every((t) => typeof t === 'string') || times.length < MIN_HOURS) {
    throw new Error('forecast: bad hour labels')
  }
  if (!Array.isArray(cells) || cells.length !== expectedCells) throw new Error('forecast: wrong number of places')
  for (const cell of cells) {
    // Rain in mm an hour, a WMO weather code, and a chance in percent
    if (!cell || !isNumbers(cell.mm, 0, 1000) || !isNumbers(cell.code, 0, 99) || !isNumbers(cell.chance, 0, 100)) {
      throw new Error('forecast: bad numbers')
    }
    if (cell.mm.length !== times.length || cell.code.length !== times.length || cell.chance.length !== times.length) {
      throw new Error('forecast: uneven hours')
    }
  }
  return { times, cells }
}

// Open-Meteo's answer for several places is a list with one entry each (one place is a single
// object). Turns it into the compact form, with the hours stored once.
export function compactFromAnswer(json: unknown, expectedCells: number): Compact {
  const entries = Array.isArray(json) ? json : [json]
  if (entries.length !== expectedCells) throw new Error('forecast: wrong number of places')

  let times: string[] | null = null
  const cells = entries.map((entry) => {
    const hourly = (entry as { hourly?: Record<string, unknown> } | null)?.hourly
    const { time, precipitation, weather_code, precipitation_probability } = hourly ?? {}
    if (!Array.isArray(time) || !time.every((t) => typeof t === 'string')) throw new Error('forecast: bad hour labels')
    if (times === null) times = time as string[]
    // The hours are kept once, so every place has to have the same ones
    else if (time.length !== times.length || time.some((t, i) => t !== times![i])) throw new Error('forecast: places disagree on the hours')
    return { mm: precipitation, code: weather_code, chance: precipitation_probability }
  })
  return validateCompact({ times, cells }, expectedCells)
}

export type StoredRow = {
  fetched_at: string
  point_count: number
  data: Compact
  last_attempt_at: string
  last_error: null
}

export type Deps = {
  now: () => number
  points: Point[]
  // When the stored forecast was fetched, or null if there is none yet
  readFetchedAt: () => Promise<string | null>
  // Asks Open-Meteo. Throws on a network error or timeout. `body` is null if it wasn't JSON.
  fetchForecast: (url: string) => Promise<{ status: number; body: unknown }>
  writeRow: (row: StoredRow) => Promise<void>
  // Notes a failed run on the existing row, without touching its forecast
  writeFailure: (at: string, message: string) => Promise<void>
  sleep: (ms: number) => Promise<void>
  log: (entry: Record<string, unknown>) => void
}

export type Outcome =
  | { result: 'ok' | 'dry_run'; fetchedAt: string; points: number; hours: number; bytes: number }
  | { result: 'skipped'; ageMinutes: number }
  | { result: 'rate_limited'; reason: string | null }
  | { result: 'failed'; message: string }

// One run: asks Open-Meteo for the island grid and stores it. A 429 is logged and the old row kept,
// with no retry until the next run. A network error or a 5xx is tried once more after 5 seconds.
export async function refresh(deps: Deps, options: { force?: boolean; dryRun?: boolean } = {}): Promise<Outcome> {
  const { now, log } = deps
  const fail = async (message: string): Promise<Outcome> => {
    log({ result: 'failed', message })
    try {
      await deps.writeFailure(new Date(now()).toISOString(), message)
    } catch {
      // nothing more to do: it is in the log
    }
    return { result: 'failed', message }
  }

  if (!options.force) {
    let last: string | null
    try {
      last = await deps.readFetchedAt()
    } catch (err) {
      // Without the guard there is no safe way to ask Open-Meteo, so it isn't asked
      log({ result: 'failed', message: `database read failed: ${(err as Error).message}` })
      return { result: 'failed', message: 'database read failed' }
    }
    const age = last === null ? Infinity : now() - Date.parse(last)
    if (age < MIN_INTERVAL_MS) {
      log({ result: 'skipped', ageMinutes: Math.round(age / 60_000) })
      return { result: 'skipped', ageMinutes: Math.round(age / 60_000) }
    }
  }

  const url = buildUrl(deps.points)
  let body: unknown = null
  let lastProblem = 'no answer'
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const res = await deps.fetchForecast(url)
      if (res.status === 429) {
        const reason = limitReason(res.body)
        log({ result: 'rate_limited', reason })
        try {
          await deps.writeFailure(new Date(now()).toISOString(), `429: ${reason ?? 'no reason given'}`)
        } catch {
          // it is in the log
        }
        return { result: 'rate_limited', reason }
      }
      if (res.status >= 500) {
        lastProblem = `HTTP ${res.status}${limitReason(res.body) ? `: ${limitReason(res.body)}` : ''}`
      } else if (res.status !== 200) {
        // Another 4xx won't be different the second time
        return fail(`HTTP ${res.status}${limitReason(res.body) ? `: ${limitReason(res.body)}` : ''}`)
      } else {
        body = res.body
        break
      }
    } catch (err) {
      lastProblem = (err as Error).message || 'network error'
    }
    if (attempt === 1) await deps.sleep(RETRY_DELAY_MS)
    else return fail(lastProblem)
  }

  let data: Compact
  try {
    data = compactFromAnswer(body, deps.points.length)
  } catch (err) {
    return fail((err as Error).message)
  }

  const fetchedAt = new Date(now()).toISOString()
  const bytes = JSON.stringify(data).length
  const outcome = { fetchedAt, points: data.cells.length, hours: data.times.length, bytes }
  if (options.dryRun) {
    log({ result: 'dry_run', ...outcome })
    return { result: 'dry_run', ...outcome }
  }
  try {
    await deps.writeRow({ fetched_at: fetchedAt, point_count: data.cells.length, data, last_attempt_at: fetchedAt, last_error: null })
  } catch (err) {
    return fail(`database write failed: ${(err as Error).message}`)
  }
  log({ result: 'ok', ...outcome })
  return { result: 'ok', ...outcome }
}
