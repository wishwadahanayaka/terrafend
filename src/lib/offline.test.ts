import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { PersistedClient } from '@tanstack/react-query-persist-client'
import { describe, expect, it } from 'vitest'
import {
  dataFrom,
  dropOldQueries,
  FORECAST_SAVED_MAX_AGE_MS,
  isSavedDataUsable,
  LANDSLIDE_SAVED_MAX_AGE_MS,
  liveReports,
  NEWS_SAVED_MAX_AGE_MS,
  offlineMessage,
  reportsInBox,
  SAVED_FILE_MAX_AGE_MS,
  SAVED_MAX_AGE_MS,
  shouldSave,
  shouldSaveQuery,
  sourceOf,
} from './offline'
import { TILE_CACHE_MAX_ENTRIES, TILE_URL_PATTERN } from './tileCache'

// 4 Nov 2026, 12:00 pm in Sri Lanka
const NOW = Date.parse('2026-11-04T06:30:00Z')
const HOUR = 3_600_000

describe('what is saved', () => {
  it('saves the five data sources', () => {
    expect(sourceOf(['river-gauges'])).toBe('rivers')
    expect(sourceOf(['rain-measured'])).toBe('measured-rain')
    expect(sourceOf(['rain-map'])).toBe('forecast')
    expect(sourceOf(['gdacs', 'core'])).toBe('alerts')
    expect(sourceOf(['gdacs', 'green'])).toBe('alerts')
    expect(sourceOf(['reports', 'island'])).toBe('reports')
  })

  it('never saves votes, searches, routes or per-view reports', () => {
    expect(shouldSave(['my-vote', 'abc'])).toBe(false)
    expect(shouldSave(['places', 'kandy', 7.3, 80.6])).toBe(false)
    expect(shouldSave(['reports', 'route', 'r1'])).toBe(false)
    expect(shouldSave(['reports', 'confirmations', 'r1'])).toBe(false)
    expect(shouldSave(['my-reports'])).toBe(false)
    expect(shouldSave(['similar-reports', 7, 80, 'fallen_tree'])).toBe(false)
    expect(shouldSave(['reports', { minLng: 79, minLat: 5, maxLng: 82, maxLat: 10 }])).toBe(false)
    expect(shouldSave(['route-rain'])).toBe(false)
    expect(shouldSave([])).toBe(false)
  })

  it('with the dev test switches on, saves and restores only the forecast', () => {
    expect(shouldSave(['rain-map'], true)).toBe(true)
    for (const key of [['river-gauges'], ['rain-measured'], ['gdacs', 'core'], ['reports', 'island']]) {
      expect(shouldSave(key, true)).toBe(false)
      expect(shouldSave(key)).toBe(true)
    }
    expect(isSavedDataUsable(['rain-map'], NOW - HOUR, NOW, true)).toBe(true)
    expect(isSavedDataUsable(['river-gauges'], NOW - HOUR, NOW, true)).toBe(false)
  })

  it('keeps only the forecast out of the saved file when the switches are on', () => {
    const query = (key: unknown[]) => ({ queryKey: key, queryHash: JSON.stringify(key), state: { dataUpdatedAt: NOW - HOUR } })
    const saved = {
      timestamp: NOW,
      buster: 'b',
      clientState: { mutations: [], queries: [query(['river-gauges']), query(['rain-map']), query(['gdacs', 'core'])] },
    } as unknown as PersistedClient
    expect(dropOldQueries(saved, NOW, true).clientState.queries.map((q) => q.queryKey[0])).toEqual(['rain-map'])
    expect(dropOldQueries(saved, NOW).clientState.queries).toHaveLength(3)
  })

  it('keeps the forecast in the saved file after a failed refresh, but not other data', () => {
    const failed = { status: 'error', data: { fetchedAt: NOW } }
    const failedWithNothing = { status: 'error', data: undefined }
    expect(shouldSaveQuery(['rain-map'], { status: 'success', data: {} })).toBe(true)
    expect(shouldSaveQuery(['rain-map'], failed)).toBe(true)
    expect(shouldSaveQuery(['rain-map'], failedWithNothing)).toBe(false)
    expect(shouldSaveQuery(['river-gauges'], failed)).toBe(false)
    expect(shouldSaveQuery(['my-vote', 'x'], { status: 'success', data: {} })).toBe(false)
    expect(shouldSaveQuery(['river-gauges'], { status: 'success', data: {} }, true)).toBe(false)
    expect(shouldSaveQuery(['rain-map'], failed, true)).toBe(true)
  })

  it('drops saved data past its age, and the forecast sooner', () => {
    expect(isSavedDataUsable(['river-gauges'], NOW - 5 * HOUR, NOW)).toBe(true)
    expect(isSavedDataUsable(['river-gauges'], NOW - 7 * HOUR, NOW)).toBe(false)
    expect(isSavedDataUsable(['rain-map'], NOW - 2 * HOUR, NOW)).toBe(true)
    expect(isSavedDataUsable(['rain-map'], NOW - 4 * HOUR, NOW)).toBe(false)
    expect(FORECAST_SAVED_MAX_AGE_MS).toBeLessThan(SAVED_MAX_AGE_MS)
  })

  it('checks each saved query on its own, whatever the age of the file', () => {
    const query = (key: unknown[], age: number) => ({
      queryKey: key,
      queryHash: JSON.stringify(key),
      state: { dataUpdatedAt: NOW - age },
    })
    const saved = {
      timestamp: NOW,
      buster: 'b',
      clientState: {
        mutations: [],
        queries: [query(['river-gauges'], HOUR), query(['rain-map'], 5 * HOUR), query(['my-vote', 'x'], 0)],
      },
    } as unknown as PersistedClient
    const kept = dropOldQueries(saved, NOW).clientState.queries.map((q) => q.queryKey[0])
    expect(kept).toEqual(['river-gauges'])
  })
})

describe('the news headlines, offline', () => {
  const query = (key: unknown[], age: number) => ({ queryKey: key, queryHash: JSON.stringify(key), state: { dataUpdatedAt: NOW - age } })
  const file = (queries: ReturnType<typeof query>[]) =>
    ({ timestamp: NOW, buster: 'b', clientState: { mutations: [], queries } }) as unknown as PersistedClient

  it('are saved, as their own source', () => {
    expect(sourceOf(['news'])).toBe('news')
    expect(shouldSave(['news'])).toBe(true)
    expect(shouldSaveQuery(['news'], { status: 'success', data: [] })).toBe(true)
  })

  it('are saved for 24 hours, where the rest is saved for 6 and the forecast for 3', () => {
    expect(NEWS_SAVED_MAX_AGE_MS).toBe(24 * HOUR)
    expect(isSavedDataUsable(['news'], NOW - 23 * HOUR, NOW)).toBe(true)
    expect(isSavedDataUsable(['news'], NOW - 25 * HOUR, NOW)).toBe(false)
    // the rest is unchanged
    expect(isSavedDataUsable(['river-gauges'], NOW - 7 * HOUR, NOW)).toBe(false)
    expect(isSavedDataUsable(['rain-map'], NOW - 4 * HOUR, NOW)).toBe(false)
  })

  it('stay in the saved file after a failed refresh, which would otherwise drop them', () => {
    expect(shouldSaveQuery(['news'], { status: 'error', data: [{ id: 1 }] })).toBe(true)
    expect(shouldSaveQuery(['news'], { status: 'error', data: undefined })).toBe(false)
    expect(shouldSaveQuery(['news'], { status: 'pending', data: undefined })).toBe(false)
  })

  it('are not counted in the offline banner, whether or not they are the oldest or the newest', () => {
    const entry = (key: unknown[], at: number) => ({ queryKey: key, dataUpdatedAt: at })
    expect(dataFrom([entry(['river-gauges'], NOW - 2 * HOUR), entry(['news'], NOW - 20 * HOUR)])).toBe(NOW - 2 * HOUR)
    expect(dataFrom([entry(['river-gauges'], NOW - 2 * HOUR), entry(['news'], NOW)])).toBe(NOW - 2 * HOUR)
    expect(dataFrom([entry(['news'], NOW)])).toBeNull()
  })

  it('are not saved while a dev test switch is on, like everything but the forecast', () => {
    expect(shouldSave(['news'], true)).toBe(false)
    expect(shouldSaveQuery(['news'], { status: 'success', data: [] }, true)).toBe(false)
    expect(isSavedDataUsable(['news'], NOW, NOW, true)).toBe(false)
  })

  it('survive a file that is older than 6 hours, while the 6-hour data in it does not', () => {
    // the library throws a whole file away past this age, so it must be the longest of the limits
    expect(SAVED_FILE_MAX_AGE_MS).toBe(NEWS_SAVED_MAX_AGE_MS)
    expect(SAVED_FILE_MAX_AGE_MS).toBeGreaterThanOrEqual(SAVED_MAX_AGE_MS)
    const saved = file([query(['news'], 10 * HOUR), query(['river-gauges'], 10 * HOUR), query(['rain-map'], 10 * HOUR)])
    expect(dropOldQueries(saved, NOW).clientState.queries.map((q) => q.queryKey[0])).toEqual(['news'])
    expect(dropOldQueries(file([query(['news'], 30 * HOUR)]), NOW).clientState.queries).toEqual([])
  })

  it('make main.tsx keep the file as long as the news', () => {
    const main = readFileSync(join(__dirname, '..', 'main.tsx'), 'utf8')
    expect(main).toContain('maxAge: SAVED_FILE_MAX_AGE_MS')
    expect(main).not.toMatch(/maxAge: SAVED_MAX_AGE_MS/)
  })
})

describe('the landslide warning, offline', () => {
  const query = (key: unknown[], age: number) => ({ queryKey: key, queryHash: JSON.stringify(key), state: { dataUpdatedAt: NOW - age } })
  const file = (queries: ReturnType<typeof query>[]) =>
    ({ timestamp: NOW, buster: 'b', clientState: { mutations: [], queries } }) as unknown as PersistedClient

  it('is saved, as its own source, and the outlines are not (the service worker keeps that file)', () => {
    expect(sourceOf(['landslide'])).toBe('landslide')
    expect(shouldSave(['landslide'])).toBe(true)
    expect(shouldSaveQuery(['landslide'], { status: 'success', data: { found: false } })).toBe(true)
    expect(sourceOf(['landslide-shapes'])).toBeNull()
    expect(shouldSave(['landslide-shapes'])).toBe(false)
  })

  it('is saved for 24 hours, the longest a warning is valid', () => {
    expect(LANDSLIDE_SAVED_MAX_AGE_MS).toBe(24 * HOUR)
    expect(isSavedDataUsable(['landslide'], NOW - 23 * HOUR, NOW)).toBe(true)
    expect(isSavedDataUsable(['landslide'], NOW - 25 * HOUR, NOW)).toBe(false)
  })

  it('stays in the saved file after a failed refresh', () => {
    expect(shouldSaveQuery(['landslide'], { status: 'error', data: { found: false } })).toBe(true)
    expect(shouldSaveQuery(['landslide'], { status: 'error', data: undefined })).toBe(false)
  })

  it('is not counted in the offline banner: the Layers panel says when it was saved', () => {
    const entry = (key: unknown[], at: number) => ({ queryKey: key, dataUpdatedAt: at })
    expect(dataFrom([entry(['river-gauges'], NOW - 2 * HOUR), entry(['landslide'], NOW - 20 * HOUR)])).toBe(NOW - 2 * HOUR)
    expect(dataFrom([entry(['landslide'], NOW)])).toBeNull()
  })

  it('is not saved while a dev test switch is on, so ?fakeLandslide= data never turns up later', () => {
    expect(shouldSave(['landslide'], true)).toBe(false)
    expect(shouldSaveQuery(['landslide'], { status: 'success', data: {} }, true)).toBe(false)
  })

  it('survives a file older than 6 hours, which the 6-hour data in it does not', () => {
    const saved = file([query(['landslide'], 10 * HOUR), query(['river-gauges'], 10 * HOUR)])
    expect(dropOldQueries(saved, NOW).clientState.queries.map((q) => q.queryKey[0])).toEqual(['landslide'])
  })
})

describe('the offline banner', () => {
  const entry = (key: unknown[], at: number) => ({ queryKey: key, dataUpdatedAt: at })

  it('uses the oldest source, counted from its newest load', () => {
    const from = dataFrom([
      entry(['river-gauges'], NOW - 3 * HOUR),
      entry(['reports', 'island'], NOW - HOUR),
      entry(['gdacs', 'core'], NOW - 2 * HOUR),
      entry(['gdacs', 'green'], NOW - 30 * 60_000),
    ])
    expect(from).toBe(NOW - 3 * HOUR)
  })

  it('ignores queries that never loaded and ones that are not data sources', () => {
    expect(dataFrom([entry(['river-gauges'], 0), entry(['my-vote', 'x'], NOW)])).toBeNull()
    expect(dataFrom([])).toBeNull()
  })

  it('says when the data is from, in Sri Lanka time', () => {
    // 10:42 am Sri Lanka
    const at = Date.parse('2026-11-04T05:12:00Z')
    expect(offlineMessage(at, NOW)).toBe('Offline: showing data from 10:42 am. It may be out of date.')
  })

  it('names the day when the data is from another day', () => {
    const yesterday = Date.parse('2026-11-03T14:00:00Z')
    expect(offlineMessage(yesterday, NOW)).toBe('Offline: showing data from 3 Nov, 7:30 pm. It may be out of date.')
  })

  it('says so when there is no saved data', () => {
    expect(offlineMessage(null, NOW)).toContain('no saved data yet')
  })
})

describe('saved reports', () => {
  const report = (id: string, expires: number, lat = 7, lng = 80) => ({
    id,
    lat,
    lng,
    expires_at: new Date(expires).toISOString(),
  })

  it('leaves out reports that have run out', () => {
    const list = [report('a', NOW + HOUR), report('b', NOW - 1), report('c', NOW)]
    expect(liveReports(list, NOW).map((r) => r.id)).toEqual(['a'])
  })

  it('cuts the island-wide list down to the map in view', () => {
    const box = { minLng: 79.5, minLat: 6.5, maxLng: 80.5, maxLat: 7.5 }
    const list = [report('in', NOW, 7, 80), report('north', NOW, 9, 80), report('east', NOW, 7, 81.5)]
    expect(reportsInBox(list, box)?.map((r) => r.id)).toEqual(['in'])
  })

  it('gives nothing when nothing was saved', () => {
    expect(reportsInBox(undefined, { minLng: 0, minLat: 0, maxLng: 1, maxLat: 1 })).toBeUndefined()
  })
})

describe('map tile cache', () => {
  it('matches OpenStreetMap tiles only', () => {
    expect(TILE_URL_PATTERN.test('https://tile.openstreetmap.org/8/183/121.png')).toBe(true)
    expect(TILE_URL_PATTERN.test('https://tile.openstreetmap.org.evil.example/8/1/1.png')).toBe(false)
  })

  it('never matches sign-in, reports, votes, routing or the data sources', () => {
    const urls = [
      'https://ktwdmwiaodtirrcitlgb.supabase.co/auth/v1/signup',
      'https://ktwdmwiaodtirrcitlgb.supabase.co/rest/v1/rpc/reports_in_view',
      'https://ktwdmwiaodtirrcitlgb.supabase.co/rest/v1/report_votes',
      'https://ktwdmwiaodtirrcitlgb.supabase.co/functions/v1/routing',
      'https://waterlevels.lk/api/levels',
      'https://api.open-meteo.com/v1/forecast',
      'https://www.gdacs.org/gdacsapi/api/events/geteventlist/SEARCH',
      'https://terrafend.vercel.app/waterlevels-api/rain-map',
    ]
    for (const url of urls) expect(TILE_URL_PATTERN.test(url)).toBe(false)
  })

  it('has a size limit, so the cache cannot grow without end', () => {
    expect(TILE_CACHE_MAX_ENTRIES).toBeGreaterThan(0)
    expect(TILE_CACHE_MAX_ENTRIES).toBeLessThanOrEqual(1000)
  })
})
