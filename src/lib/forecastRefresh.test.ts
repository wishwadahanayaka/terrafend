import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi, type Mock } from 'vitest'
import {
  buildUrl,
  compactFromAnswer,
  isAuthorised,
  limitReason,
  MIN_INTERVAL_MS,
  refresh,
  RETRY_DELAY_MS,
  validateCompact,
  type Deps,
  type Point,
} from '../../supabase/functions/forecast-refresh/logic'
import { forecastUrl } from './openMeteo'
import { landGrid } from './rainMap'

// Nothing here reaches Open-Meteo, Supabase or the real forecast-refresh function:
// everything the function talks to is a stand-in.

const NOW = Date.parse('2026-11-08T09:23:00Z')
const MIN = 60_000
const POINTS: Point[] = [
  [7.1, 80.2],
  [6.5, 80.1],
  [8.3, 80.9],
]

// 48 hour labels for 8 Nov, like Open-Meteo's
const TIMES = Array.from({ length: 48 }, (_, h) => `2026-11-${h < 24 ? '08' : '09'}T${String(h % 24).padStart(2, '0')}:00`)
const entry = () => ({
  hourly: {
    time: TIMES,
    precipitation: TIMES.map(() => 0.2),
    weather_code: TIMES.map(() => 3),
    precipitation_probability: TIMES.map(() => 30),
  },
})
const answer = (n = POINTS.length) => Array.from({ length: n }, entry)
const reply = (status: number, body: unknown = null) => ({ status, body })

describe('the grid file the function reads', () => {
  const path = join(process.cwd(), 'supabase/functions/forecast-refresh/grid.json')
  const wanted = landGrid().cells.map((c) => [Number(c.lat.toFixed(2)), Number(c.lng.toFixed(2))])

  // Run with UPDATE_GRID=1 to write the file again after the app's grid changes
  if (process.env.UPDATE_GRID === '1') writeFileSync(path, JSON.stringify(wanted) + '\n')

  it('has the same points, in the same order, as the grid the app draws', () => {
    const file = JSON.parse(readFileSync(path, 'utf8')) as number[][]
    expect(file).toEqual(wanted)
  })

  it('asks Open-Meteo for exactly what the app asks for', () => {
    const file = JSON.parse(readFileSync(path, 'utf8')) as Point[]
    expect(buildUrl(file)).toBe(forecastUrl(landGrid().cells))
  })
})

describe('who may call the function', () => {
  it('lets in the right secret only', async () => {
    expect(await isAuthorised('s3cret', 's3cret')).toBe(true)
    expect(await isAuthorised('s3cret!', 's3cret')).toBe(false)
    expect(await isAuthorised('', 's3cret')).toBe(false)
    expect(await isAuthorised(null, 's3cret')).toBe(false)
  })

  it('lets nobody in when no secret is set', async () => {
    expect(await isAuthorised('anything', undefined)).toBe(false)
    expect(await isAuthorised('', '')).toBe(false)
    expect(await isAuthorised(null, undefined)).toBe(false)
  })
})

describe('checking a forecast', () => {
  const good = () => compactFromAnswer(answer(), POINTS.length)

  it('turns the answer into hours stored once, and cells in order', () => {
    const c = good()
    expect(c.times).toEqual(TIMES)
    expect(c.cells).toHaveLength(3)
    expect(c.cells[0]).toEqual({ mm: TIMES.map(() => 0.2), code: TIMES.map(() => 3), chance: TIMES.map(() => 30) })
  })

  it('takes a single place as an object, not a list', () => {
    expect(compactFromAnswer(entry(), 1).cells).toHaveLength(1)
  })

  it('refuses the wrong number of places', () => {
    expect(() => compactFromAnswer(answer(2), 3)).toThrow()
    expect(() => compactFromAnswer(answer(4), 3)).toThrow()
  })

  it('refuses places that disagree about the hours', () => {
    const odd = answer()
    odd[1].hourly.time = TIMES.map((t, i) => (i === 5 ? 'x' : t))
    expect(() => compactFromAnswer(odd, 3)).toThrow()
  })

  it('refuses less than a day of hours, and hour labels that are not text', () => {
    const short = answer().map((e) => ({
      hourly: { time: TIMES.slice(0, 10), precipitation: TIMES.slice(0, 10).map(() => 0), weather_code: TIMES.slice(0, 10).map(() => 0), precipitation_probability: TIMES.slice(0, 10).map(() => 0) },
      e,
    }))
    expect(() => compactFromAnswer(short, 3)).toThrow()
    expect(() => validateCompact({ times: [1, 2], cells: [] }, 0)).toThrow()
  })

  it('refuses arrays of different lengths, and numbers that make no sense', () => {
    const c = good()
    expect(() => validateCompact({ ...c, cells: [{ ...c.cells[0], mm: [0] }, c.cells[1], c.cells[2]] }, 3)).toThrow()
    for (const bad of [{ mm: -1 }, { mm: 5000 }, { code: 120 }, { chance: 101 }, { chance: Number.NaN }, { mm: 'wet' }]) {
      const cells = [{ ...c.cells[0], ...Object.fromEntries(Object.entries(bad).map(([k, v]) => [k, TIMES.map(() => v)])) }, c.cells[1], c.cells[2]]
      expect(() => validateCompact({ times: c.times, cells }, 3), JSON.stringify(bad)).toThrow()
    }
  })

  it('accepts missing values (null) in the hours', () => {
    const c = good()
    c.cells[0].mm[3] = null
    c.cells[1].chance[7] = null
    expect(() => validateCompact(c, 3)).not.toThrow()
  })

  it('reads the reason out of an error body', () => {
    expect(limitReason({ error: true, reason: ' Daily limit. ' })).toBe('Daily limit.')
    expect(limitReason(null)).toBeNull()
    expect(limitReason({ reason: 5 })).toBeNull()
  })
})

// A run of the function with everything it talks to replaced
function setup(over: Partial<Deps> = {}) {
  const log = vi.fn()
  const writeRow = vi.fn(async () => {})
  const writeFailure = vi.fn(async () => {})
  const sleep = vi.fn(async () => {})
  const fetchForecast = vi.fn(async (): Promise<{ status: number; body: unknown }> => reply(200, answer()))
  const deps: Deps = {
    now: () => NOW,
    points: POINTS,
    readFetchedAt: async () => null,
    fetchForecast,
    writeRow,
    writeFailure,
    sleep,
    log,
    ...over,
  }
  // Give back the stand-ins that are really in use, including any that were replaced
  return {
    deps,
    log,
    sleep,
    writeRow: deps.writeRow as unknown as Mock<Deps['writeRow']>,
    writeFailure: deps.writeFailure as unknown as Mock<Deps['writeFailure']>,
    fetchForecast: deps.fetchForecast as unknown as Mock<Deps['fetchForecast']>,
  }
}

describe('one run of the function', () => {
  it('fetches the grid and stores it with the time it was fetched', async () => {
    const { deps, writeRow, fetchForecast } = setup()
    const out = await refresh(deps)
    expect(out).toMatchObject({ result: 'ok', fetchedAt: new Date(NOW).toISOString(), points: 3, hours: 48 })
    expect(fetchForecast).toHaveBeenCalledOnce()
    expect(fetchForecast).toHaveBeenCalledWith(buildUrl(POINTS))
    expect(writeRow).toHaveBeenCalledOnce()
    const row = writeRow.mock.calls[0][0]
    expect(row).toMatchObject({ fetched_at: new Date(NOW).toISOString(), point_count: 3, last_error: null })
    expect(row.data.cells).toHaveLength(3)
  })

  it('reports the size of what it stored', async () => {
    const { deps } = setup()
    const out = await refresh(deps)
    expect(out.result === 'ok' && out.bytes > 100).toBe(true)
  })

  describe('the 30-minute guard', () => {
    const lastRun = (minutesAgo: number) => async () => new Date(NOW - minutesAgo * MIN).toISOString()

    it('skips a run that comes too soon after the last one, without asking Open-Meteo', async () => {
      const { deps, fetchForecast, writeRow } = setup({ readFetchedAt: lastRun(10) })
      expect(await refresh(deps)).toEqual({ result: 'skipped', ageMinutes: 10 })
      expect(fetchForecast).not.toHaveBeenCalled()
      expect(writeRow).not.toHaveBeenCalled()
    })

    it('runs once the last one is 30 minutes old, or when there is none', async () => {
      expect(MIN_INTERVAL_MS).toBe(30 * MIN)
      expect((await refresh(setup({ readFetchedAt: lastRun(30) }).deps)).result).toBe('ok')
      expect((await refresh(setup({ readFetchedAt: lastRun(60) }).deps)).result).toBe('ok')
      expect((await refresh(setup().deps)).result).toBe('ok')
    })

    it('is set aside by force', async () => {
      const { deps, fetchForecast } = setup({ readFetchedAt: lastRun(1) })
      expect((await refresh(deps, { force: true })).result).toBe('ok')
      expect(fetchForecast).toHaveBeenCalledOnce()
    })

    it('does not ask Open-Meteo at all if the database cannot be read', async () => {
      const { deps, fetchForecast } = setup({
        readFetchedAt: async () => {
          throw new Error('db down')
        },
      })
      expect((await refresh(deps)).result).toBe('failed')
      expect(fetchForecast).not.toHaveBeenCalled()
    })
  })

  it('checks the answer in a dry run but stores nothing', async () => {
    const { deps, writeRow, fetchForecast } = setup()
    const out = await refresh(deps, { dryRun: true })
    expect(out.result).toBe('dry_run')
    expect(fetchForecast).toHaveBeenCalledOnce()
    expect(writeRow).not.toHaveBeenCalled()
  })

  describe('a 429', () => {
    const limited = () =>
      setup({ fetchForecast: vi.fn(async () => reply(429, { error: true, reason: 'Hourly API request limit exceeded.' })) })

    it('logs the reason, keeps the old row, and does not retry', async () => {
      const { deps, log, writeRow, writeFailure, sleep, fetchForecast } = limited()
      const out = await refresh(deps)
      expect(out).toEqual({ result: 'rate_limited', reason: 'Hourly API request limit exceeded.' })
      expect(log).toHaveBeenCalledWith({ result: 'rate_limited', reason: 'Hourly API request limit exceeded.' })
      expect(fetchForecast).toHaveBeenCalledOnce()
      expect(sleep).not.toHaveBeenCalled()
      expect(writeRow).not.toHaveBeenCalled()
      // Only the note about the run is written, which leaves the stored forecast as it was
      expect(writeFailure).toHaveBeenCalledWith(new Date(NOW).toISOString(), '429: Hourly API request limit exceeded.')
    })

    it('is not retried even when it follows a server error', async () => {
      const fetchForecast = vi
        .fn<Deps['fetchForecast']>()
        .mockResolvedValueOnce(reply(503))
        .mockResolvedValueOnce(reply(429, { reason: 'Slow down' }))
      const { deps, sleep } = setup({ fetchForecast })
      expect((await refresh(deps)).result).toBe('rate_limited')
      expect(fetchForecast).toHaveBeenCalledTimes(2)
      expect(sleep).toHaveBeenCalledTimes(1)
    })

    it('copes with a 429 that has no readable reason', async () => {
      const { deps } = setup({ fetchForecast: vi.fn(async () => reply(429, null)) })
      expect(await refresh(deps)).toEqual({ result: 'rate_limited', reason: null })
    })
  })

  describe('the one retry', () => {
    it('waits 5 seconds and tries again after a 5xx, then stores the answer', async () => {
      const fetchForecast = vi.fn<Deps['fetchForecast']>().mockResolvedValueOnce(reply(502)).mockResolvedValueOnce(reply(200, answer()))
      const { deps, sleep, writeRow } = setup({ fetchForecast })
      expect((await refresh(deps)).result).toBe('ok')
      expect(RETRY_DELAY_MS).toBe(5000)
      expect(sleep).toHaveBeenCalledExactlyOnceWith(5000)
      expect(fetchForecast).toHaveBeenCalledTimes(2)
      expect(writeRow).toHaveBeenCalledOnce()
    })

    it('does the same after a network error', async () => {
      const fetchForecast = vi.fn<Deps['fetchForecast']>().mockRejectedValueOnce(new Error('timed out')).mockResolvedValueOnce(reply(200, answer()))
      const { deps, sleep } = setup({ fetchForecast })
      expect((await refresh(deps)).result).toBe('ok')
      expect(sleep).toHaveBeenCalledOnce()
    })

    it('gives up after the second failure, and keeps the old row', async () => {
      const { deps, fetchForecast, writeRow, writeFailure } = setup({ fetchForecast: vi.fn(async () => reply(500, { reason: 'Server trouble' })) })
      const out = await refresh(deps)
      expect(out).toEqual({ result: 'failed', message: 'HTTP 500: Server trouble' })
      expect(fetchForecast).toHaveBeenCalledTimes(2)
      expect(writeRow).not.toHaveBeenCalled()
      expect(writeFailure).toHaveBeenCalledOnce()
    })

    it('gives up after two network errors', async () => {
      const { deps, fetchForecast } = setup({
        fetchForecast: vi.fn(async () => {
          throw new Error('offline')
        }),
      })
      expect(await refresh(deps)).toEqual({ result: 'failed', message: 'offline' })
      expect(fetchForecast).toHaveBeenCalledTimes(2)
    })

    it('does not retry another kind of 4xx', async () => {
      const { deps, fetchForecast, sleep } = setup({ fetchForecast: vi.fn(async () => reply(400, { reason: 'Bad request' })) })
      expect(await refresh(deps)).toEqual({ result: 'failed', message: 'HTTP 400: Bad request' })
      expect(fetchForecast).toHaveBeenCalledOnce()
      expect(sleep).not.toHaveBeenCalled()
    })
  })

  describe('an answer that is not right', () => {
    it('is not stored: the old row stays, and the problem is noted', async () => {
      const { deps, writeRow, writeFailure } = setup({ fetchForecast: vi.fn(async () => reply(200, answer(2))) })
      const out = await refresh(deps)
      expect(out.result).toBe('failed')
      expect(writeRow).not.toHaveBeenCalled()
      expect(writeFailure).toHaveBeenCalledOnce()
    })

    it('is not stored when it is not even JSON', async () => {
      const { deps, writeRow } = setup({ fetchForecast: vi.fn(async () => reply(200, null)) })
      expect((await refresh(deps)).result).toBe('failed')
      expect(writeRow).not.toHaveBeenCalled()
    })
  })

  it('reports a failed write, and is not stopped by a failed note', async () => {
    const { deps } = setup({
      writeRow: vi.fn(async () => {
        throw new Error('disk full')
      }),
      writeFailure: vi.fn(async () => {
        throw new Error('also down')
      }),
    })
    expect(await refresh(deps)).toEqual({ result: 'failed', message: 'database write failed: disk full' })
  })
})
