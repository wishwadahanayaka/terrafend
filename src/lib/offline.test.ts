import type { PersistedClient } from '@tanstack/react-query-persist-client'
import { describe, expect, it } from 'vitest'
import {
  dataFrom,
  dropOldQueries,
  FORECAST_SAVED_MAX_AGE_MS,
  isSavedDataUsable,
  liveReports,
  offlineMessage,
  reportsInBox,
  SAVED_MAX_AGE_MS,
  shouldSave,
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
    expect(shouldSave(['similar-reports', 7, 80, 'fallen_tree'])).toBe(false)
    expect(shouldSave(['reports', { minLng: 79, minLat: 5, maxLng: 82, maxLat: 10 }])).toBe(false)
    expect(shouldSave(['route-rain'])).toBe(false)
    expect(shouldSave([])).toBe(false)
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
