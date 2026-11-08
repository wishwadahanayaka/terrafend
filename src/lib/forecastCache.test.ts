import { describe, expect, it, vi } from 'vitest'
import {
  CACHE_FRESH_MAX_AGE_MS,
  fetchCachedForecast,
  gridFromCacheRow,
  islandRefreshDelay,
  loadForecast,
  type LoadDeps,
} from './forecastCache'
import { FORECAST_MAX_AGE_MS } from './forecastAge'
import { HOUR_MS, labelForHourEnd, type Hourly } from './openMeteo'
import { OpenMeteoError } from './openMeteoLimit'
import { buildGrid, landGrid, pickWindow, type ForecastGrid } from './rainMap'

// Nothing here reaches Open-Meteo, Supabase or the real forecast-refresh function.

const MIN = 60_000
// 4 Nov 2026: hour labels are Sri Lanka time, so 00:00 there is 18:30 UTC the day before
const MIDNIGHT = Date.parse('2026-11-03T18:30:00Z')
const at = (hour: number, minute = 0) => MIDNIGHT + hour * HOUR_MS + minute * MIN
const label = (hour: number) => labelForHourEnd(MIDNIGHT + hour * HOUR_MS)
const NOW = at(14, 30) // 2:30 pm
const CELLS = landGrid().cells.length

const TIMES = Array.from({ length: 48 }, (_, h) => label(h))
// Heavy certain rain in cell 0 at the hour labelled 16:00
const rainy = (cell: number, h: number) => cell === 0 && h === 16
const compact = (): { times: string[]; cells: { mm: number[]; code: number[]; chance: number[] }[] } => ({
  times: TIMES,
  cells: Array.from({ length: CELLS }, (_, cell) => ({
    mm: TIMES.map((_, h) => (rainy(cell, h) ? 9 : 0)),
    code: TIMES.map(() => 0),
    chance: TIMES.map((_, h) => (rainy(cell, h) ? 80 : 10)),
  })),
})
const row = (fetchedAt: number, over: Record<string, unknown> = {}) => ({
  fetched_at: new Date(fetchedAt).toISOString(),
  point_count: CELLS,
  data: compact(),
  ...over,
})

describe('reading a cached row', () => {
  it('turns a good row into a grid that carries the time it was fetched', () => {
    const fetched = NOW - 40 * MIN
    const grid = gridFromCacheRow(row(fetched), NOW)!
    expect(grid.fetchedAt).toBe(fetched)
    expect(grid.cells).toHaveLength(CELLS)
    expect(grid.staleCache).toBeUndefined()
  })

  it('counts the hours from now, not from when it was fetched', () => {
    // Fetched at 9:30, read at 2:30 pm: the first hour kept is the one ending at 3 pm
    const grid = gridFromCacheRow(row(at(9, 30)), NOW)!
    expect(grid.times[0]).toBe(label(15))
    expect(grid.cells[0].mm).toHaveLength(grid.times.length)
  })

  it('gives the same forecast for the next 3 hours as a direct fetch of the same data', () => {
    const hourly: Hourly[] = compact().cells.map((c) => ({
      time: TIMES,
      precipitation: c.mm,
      weather_code: c.code,
      probability: c.chance,
    }))
    const direct = buildGrid(hourly, NOW)
    const cached = gridFromCacheRow(row(NOW), NOW)!
    expect(pickWindow(cached, NOW)).toEqual(pickWindow(direct, NOW))
    expect(pickWindow(cached, NOW)!.cells[0].level).toBe('heavy')
  })

  it('refuses what is not a row', () => {
    for (const bad of [null, undefined, 'x', 5, {}, [], { fetched_at: 'x' }]) {
      expect(gridFromCacheRow(bad, NOW), JSON.stringify(bad)).toBeNull()
    }
  })

  it('refuses a date that makes no sense', () => {
    expect(gridFromCacheRow(row(NOW, { fetched_at: 'yesterday' }), NOW)).toBeNull()
    expect(gridFromCacheRow(row(NOW, { fetched_at: 1730000000 }), NOW)).toBeNull()
  })

  it('refuses a forecast from the future, but forgives a clock a minute or two off', () => {
    expect(gridFromCacheRow(row(NOW + 10 * MIN), NOW)).toBeNull()
    const slightly = gridFromCacheRow(row(NOW + 2 * MIN), NOW)!
    expect(slightly.fetchedAt).toBe(NOW)
  })

  it('refuses a row made for a different grid', () => {
    expect(gridFromCacheRow(row(NOW, { point_count: CELLS - 1 }), NOW)).toBeNull()
    expect(gridFromCacheRow(row(NOW, { point_count: String(CELLS) }), NOW)).toBeNull()
    const short = compact()
    short.cells.pop()
    expect(gridFromCacheRow(row(NOW, { data: short }), NOW)).toBeNull()
  })

  it('refuses damaged data', () => {
    const wrongLength = compact()
    wrongLength.cells[3].mm = [0]
    const silly = compact()
    silly.cells[0].chance[5] = 500
    for (const data of [null, 'x', { times: TIMES }, { times: [], cells: [] }, wrongLength, silly]) {
      expect(gridFromCacheRow(row(NOW, { data }), NOW)).toBeNull()
    }
  })
})

describe('asking the cache', () => {
  const config = { url: 'https://example.supabase.co', key: 'sb_publishable_test' }
  const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })

  it('reads one row with a plain request that sends only the apikey, and to nowhere but Supabase', async () => {
    const fetchFn = vi.fn(async () => reply([row(NOW - 20 * MIN)]))
    const grid = await fetchCachedForecast({ ...config, fetchFn, now: NOW })
    expect(grid?.fetchedAt).toBe(NOW - 20 * MIN)

    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit]
    expect(url.startsWith('https://example.supabase.co/rest/v1/island_forecast?')).toBe(true)
    expect(url).toContain('select=fetched_at,point_count,data')
    expect(url).toContain('id=eq.1')
    expect(url).not.toContain('open-meteo')
    const headers = init.headers as Record<string, string>
    expect(headers.apikey).toBe('sb_publishable_test')
    expect(Object.keys(headers).map((k) => k.toLowerCase())).not.toContain('authorization')
  })

  it('gives null, not an error, when there is no row yet (the first deploy)', async () => {
    expect(await fetchCachedForecast({ ...config, fetchFn: vi.fn(async () => reply([])), now: NOW })).toBeNull()
  })

  it('gives null for any failure', async () => {
    const failures: Record<string, () => Promise<Response>> = {
      'not found': async () => reply({ message: 'no table' }, 404),
      'server error': async () => reply({}, 500),
      'no permission': async () => reply({ message: 'permission denied' }, 401),
      'network error': async () => {
        throw new TypeError('Failed to fetch')
      },
      'timeout': async () => {
        throw new DOMException('timed out', 'TimeoutError')
      },
      'not JSON': async () => new Response('<html>', { status: 200 }),
      'not a list': async () => reply({ fetched_at: 'x' }),
      'a damaged row': async () => reply([{ fetched_at: new Date(NOW).toISOString(), point_count: CELLS, data: {} }]),
    }
    for (const [name, fetchFn] of Object.entries(failures)) {
      expect(await fetchCachedForecast({ ...config, fetchFn: vi.fn(fetchFn), now: NOW }), name).toBeNull()
    }
  })

  it('does not ask without the project address and key', async () => {
    const fetchFn = vi.fn()
    expect(await fetchCachedForecast({ url: '', key: 'k', fetchFn, now: NOW })).toBeNull()
    expect(await fetchCachedForecast({ url: 'https://x.co', key: '', fetchFn, now: NOW })).toBeNull()
    expect(fetchFn).not.toHaveBeenCalled()
  })
})

// A grid fetched `minutes` ago
function aged(minutes: number, tag = 'cache'): ForecastGrid {
  return { fetchedAt: NOW - minutes * MIN, times: [tag], cells: [] }
}

describe('where the forecast comes from: fresh cache, then Open-Meteo, then the old cache, then nothing', () => {
  function setup(cache: ForecastGrid | null, direct: () => Promise<ForecastGrid>) {
    const calls: string[] = []
    const deps: LoadDeps = {
      readCache: vi.fn(async () => {
        calls.push('cache')
        return cache
      }),
      direct: vi.fn(async () => {
        calls.push('direct')
        return direct()
      }),
      now: () => NOW,
      note: vi.fn(),
    }
    return { deps, calls }
  }
  const works = (grid: ForecastGrid) => async () => grid
  const fails = (error: Error) => async (): Promise<ForecastGrid> => {
    throw error
  }
  const limited = () => new OpenMeteoError('429', 429, 'limit', NOW + 10 * MIN)

  it('uses the limit of 150 minutes', () => {
    expect(CACHE_FRESH_MAX_AGE_MS).toBe(150 * MIN)
  })

  describe('1. a fresh cache', () => {
    it('is used as it is, and Open-Meteo is not asked', async () => {
      const cache = aged(149)
      const { deps } = setup(cache, works(aged(0, 'direct')))
      expect(await loadForecast(deps)).toBe(cache)
      expect(deps.direct).not.toHaveBeenCalled()
    })

    it('counts up to exactly 150 minutes as fresh', async () => {
      const cache = aged(150)
      const { deps } = setup(cache, works(aged(0, 'direct')))
      expect(await loadForecast(deps)).toBe(cache)
      expect(deps.direct).not.toHaveBeenCalled()
    })

    it('is read before anything else', async () => {
      const { deps, calls } = setup(aged(5), works(aged(0)))
      await loadForecast(deps)
      expect(calls).toEqual(['cache'])
    })
  })

  describe('2. otherwise Open-Meteo is asked', () => {
    it('when the cache is older than 150 minutes', async () => {
      const direct = aged(0, 'direct')
      const { deps, calls } = setup(aged(151), works(direct))
      const got = await loadForecast(deps)
      expect(got).toBe(direct)
      expect(got.staleCache).toBeUndefined()
      expect(calls).toEqual(['cache', 'direct'])
    })

    it('when there is no cache, or it could not be read', async () => {
      const direct = aged(0, 'direct')
      const { deps, calls } = setup(null, works(direct))
      expect(await loadForecast(deps)).toBe(direct)
      expect(calls).toEqual(['cache', 'direct'])
    })

    it('prefers the new answer to a cache of 6 hours or more', async () => {
      const direct = aged(0, 'direct')
      const { deps } = setup(aged(400), works(direct))
      expect(await loadForecast(deps)).toBe(direct)
    })
  })

  describe('3. if that fails, the old cache is used, marked stale', () => {
    it('after a 429', async () => {
      const cache = aged(151)
      const { deps, calls } = setup(cache, fails(limited()))
      const got = await loadForecast(deps)
      expect(got).toEqual({ ...cache, staleCache: true })
      expect(got.fetchedAt).toBe(cache.fetchedAt)
      expect(calls).toEqual(['cache', 'direct'])
    })

    it('after any other failure', async () => {
      const { deps } = setup(aged(200), fails(new TypeError('Failed to fetch')))
      expect((await loadForecast(deps)).staleCache).toBe(true)
    })

    it('leaves the cached grid itself as it was', async () => {
      const cache = aged(200)
      const { deps } = setup(cache, fails(limited()))
      await loadForecast(deps)
      expect(cache.staleCache).toBeUndefined()
    })

    it('uses a cache of 5 h 59 min, and not one of 6 h 01 min', async () => {
      expect(FORECAST_MAX_AGE_MS).toBe(360 * MIN)
      const young = aged(5 * 60 + 59)
      const ok = setup(young, fails(limited()))
      expect(await loadForecast(ok.deps)).toEqual({ ...young, staleCache: true })

      const error = limited()
      const old = setup(aged(6 * 60 + 1), fails(error))
      await expect(loadForecast(old.deps)).rejects.toBe(error)
    })
  })

  describe('4. with nothing usable left, the failure is passed on', () => {
    it('when there is no cache', async () => {
      const error = limited()
      const { deps } = setup(null, fails(error))
      await expect(loadForecast(deps)).rejects.toBe(error)
    })

    it('with the original error, so a 429 is still known to be one', async () => {
      const error = limited()
      const { deps } = setup(aged(7 * 60), fails(error))
      await expect(loadForecast(deps)).rejects.toMatchObject({ status: 429, retryAt: NOW + 10 * MIN })
    })
  })

  it('says which way it went', async () => {
    const note = vi.fn()
    await loadForecast({ ...setup(aged(10), works(aged(0))).deps, note })
    await loadForecast({ ...setup(aged(200), works(aged(0))).deps, note })
    await loadForecast({ ...setup(aged(200), fails(new Error('x'))).deps, note })
    expect(note.mock.calls.map((c) => c[0])).toEqual([
      'forecast: using the shared cache',
      'forecast: cache too old, asking Open-Meteo',
      'forecast: cache too old, asking Open-Meteo',
      'forecast: Open-Meteo failed, using the old cache',
    ])
  })
})

describe('when the island forecast is asked for next', () => {
  const HOUR = 60 * MIN
  const stale: ForecastGrid = { ...aged(200), staleCache: true }
  const limited = (retryAt: number) => new OpenMeteoError('429', 429, null, retryAt)

  it('keeps to the normal schedule when all is well', () => {
    expect(islandRefreshDelay(null, aged(10), NOW, HOUR, null)).toBe(HOUR)
    expect(islandRefreshDelay(new Error('x'), aged(10), NOW, HOUR, null)).toBe(HOUR)
    expect(islandRefreshDelay(null, undefined, NOW, HOUR, null)).toBe(HOUR)
    // A wait that is remembered doesn't matter for a forecast that is not from the old cache
    expect(islandRefreshDelay(null, aged(10), NOW, HOUR, NOW + 10 * MIN)).toBe(HOUR)
  })

  it('waits out a 429', () => {
    expect(islandRefreshDelay(limited(NOW + 4 * MIN), aged(10), NOW, HOUR, NOW + 4 * MIN)).toBe(4 * MIN + 1000)
  })

  it('tries again after the wait when a forecast came from the old cache after a 429', () => {
    expect(islandRefreshDelay(null, stale, NOW, HOUR, NOW + 7 * MIN)).toBe(7 * MIN + 1000)
  })

  it('tries again in 10 minutes when it came from the old cache and there is no wait', () => {
    expect(islandRefreshDelay(null, stale, NOW, HOUR, null)).toBe(10 * MIN + 1000)
  })

  it('does not go negative when the wait is already over', () => {
    expect(islandRefreshDelay(null, stale, NOW, HOUR, NOW - MIN)).toBe(1000)
  })
})
