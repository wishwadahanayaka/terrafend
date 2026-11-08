// For testing only. In the dev server, ?fakeForecastCache= pretends to read the shared forecast
// cache without Supabase being involved:
//   ?fakeForecastCache=fresh    a cached forecast 10 minutes old (used as it is, Open-Meteo not asked)
//   ?fakeForecastCache=stale    one 3 hours old (too old to use as current: Open-Meteo is asked, and if
//                               that fails it is used with "Forecast from ...")
//   ?fakeForecastCache=missing  nothing cached (Open-Meteo is asked)
//   ?fakeForecastCache=fail     reading the cache fails (same as missing, with a warning)
// "stale" and "missing" fall through to the real Open-Meteo, 137 calls each time, so to see the
// failure path with no calls, add ?fakeForecast=429 (see fakeForecast.ts).
// The browser console says which way each load went. Saved data is not restored with this switch,
// so every reload decides afresh. loadIslandForecast only loads this inside an
// import.meta.env.DEV check, so the production build leaves it out.

import { labelForHourEnd, HOUR_MS } from './openMeteo'
import { landGrid, trimGrid, type ForecastGrid } from './rainMap'

type Mode = 'fresh' | 'stale' | 'missing' | 'fail'

export function fakeForecastCacheMode(): Mode | null {
  const value = globalThis.location ? new URLSearchParams(globalThis.location.search).get('fakeForecastCache') : null
  return value === 'fresh' || value === 'stale' || value === 'missing' || value === 'fail' ? value : null
}

// A sample forecast fetched `ageMs` ago: dry, except heavy rain over the first few places
function sampleGrid(now: number, ageMs: number): ForecastGrid {
  const midnight = Math.floor((now + 5.5 * HOUR_MS) / (24 * HOUR_MS)) * 24 * HOUR_MS - 5.5 * HOUR_MS
  const times = Array.from({ length: 48 }, (_, h) => labelForHourEnd(midnight + h * HOUR_MS))
  const cells = landGrid().cells.map((_, i) => ({
    mm: times.map(() => (i < 5 ? 9 : 0)),
    code: times.map(() => 0),
    chance: times.map(() => (i < 5 ? 80 : 10)),
  }))
  return trimGrid(times, cells, now - ageMs, now)
}

export function fakeCacheRead(mode: Mode, now: number): ForecastGrid | null {
  if (mode === 'fail') console.warn('fakeForecastCache=fail: pretending the cache could not be read')
  if (mode === 'fresh') return sampleGrid(now, 10 * 60_000)
  if (mode === 'stale') return sampleGrid(now, 3 * HOUR_MS)
  return null
}
