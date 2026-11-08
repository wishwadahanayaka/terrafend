import { t } from '../i18n'
import { kmFrom, normalise, readFakeRainMap } from './fakeRainMap'
import { HOUR_MS } from './openMeteo'
import { mildRain, rainLevel, RAIN_RANK, type MildLevel, type RainLevel } from './rainForecast'
import { sriLankaClock } from './time'
import { WATER_LEVELS_TIMEOUT_MS } from './waterLevelsQuery'

// waterlevels.lk doesn't let other websites read this one from the browser, so it's
// asked for on our own address. vite.config.ts (while developing) and vercel.json
// (in production) pass the request on to https://waterlevels.lk/api/rain-map.
export const RAIN_MAP_URL = '/waterlevels-api/rain-map'

export const GAUGE_RAIN_CREDIT =
  'Rain gauges: Department of Irrigation via Sri Lanka Water Levels (Shakeeb Sadikeen)'
export const SATELLITE_RAIN_CREDIT = 'Satellite rain: GSMaP data by Japan Aerospace Exploration Agency (JAXA)'

// Readings older than this are treated as unknown, not as dry
const MAX_AGE_MS = 6 * HOUR_MS
const SATELLITE_WINDOW_HOURS = 3

// The satellite grid: 0.1 degree cells (about 11 km), row by row from the north.
// lat0 and lng0 are the middle of the first cell. If the answer ever describes a
// different grid, the satellite part is left out instead of drawn in the wrong place.
export const SATELLITE_GRID = { lat0: 9.95, lng0: 79.55, step: 0.1, nx: 25, ny: 42 } as const
const CELLS = SATELLITE_GRID.nx * SATELLITE_GRID.ny

export function satelliteCentre(index: number): [number, number] {
  const row = Math.floor(index / SATELLITE_GRID.nx)
  const col = index % SATELLITE_GRID.nx
  return [SATELLITE_GRID.lat0 - row * SATELLITE_GRID.step, SATELLITE_GRID.lng0 + col * SATELLITE_GRID.step]
}

// The grid cell a position falls in, or null if it's outside the grid
export function satelliteIndexAt(lat: number, lng: number): number | null {
  const row = Math.round((SATELLITE_GRID.lat0 - lat) / SATELLITE_GRID.step)
  const col = Math.round((lng - SATELLITE_GRID.lng0) / SATELLITE_GRID.step)
  if (row < 0 || row >= SATELLITE_GRID.ny || col < 0 || col >= SATELLITE_GRID.nx) return null
  return row * SATELLITE_GRID.nx + col
}

// "25", "27.9": one decimal at most, and no trailing .0
export function formatMm(mm: number): string {
  return String(Number(mm.toFixed(1)))
}

export type GaugeRain = {
  id: string
  station: string
  river: string
  lat: number
  lng: number
  // Millimetres. null means the gauge didn't say, which is not the same as no rain.
  mm1h: number | null
  mm3h: number | null
  mm24h: number | null
  // When it was measured
  at: number
  // The worse of the last hour and the 3-hour average, in mm per hour
  rate: number
  level: RainLevel | null
  mild: MildLevel | null
  // True when the last hour on its own reached this level. When it didn't, the level
  // comes from the 3-hour average and the rain may have eased off since.
  lastHour: boolean
}

// "in the last hour" or "in the past 3 hours", whichever the level really comes from
export function gaugeWhen(g: GaugeRain): string {
  return t(g.lastHour ? 'rain.when.lastHour' : 'rain.when.past3Hours')
}

// How serious a rate is, as one number: any warning beats any quieter level
function classScore(rate: number | null): number {
  if (rate === null) return 0
  const level = rainLevel(rate, null)
  if (level) return 10 + RAIN_RANK[level]
  const mild = mildRain(rate)
  return mild === 'moderate' ? 2 : mild === 'light' ? 1 : 0
}

// The satellite's newest hour is usually 1 to 3 hours old by the time it reaches the
// map, so "in the past 3 hours" is only said while the window ended recently
const FRESH_MS = 90 * 60_000

export function satelliteWhen(window: { from: number; to: number }, now: number): string {
  if (now - window.to <= FRESH_MS) {
    const hours = Math.max(1, Math.round((window.to - window.from) / HOUR_MS))
    return t('rain.when.pastHours', { count: hours })
  }
  return t('rain.when.range', { from: sriLankaClock(window.from), to: sriLankaClock(window.to) })
}

// "25 mm in the last hour · 27.9 mm in 3 hours · 29.4 mm in 24 hours". A number the gauge
// didn't send is left out, never shown as 0.
export function measuredText(g: GaugeRain, separator = ' · '): string {
  const parts = [
    g.mm1h !== null && t('rain.measured.lastHour', { mm: formatMm(g.mm1h) }),
    g.mm3h !== null && t('rain.measured.threeHours', { mm: formatMm(g.mm3h) }),
    g.mm24h !== null && t('rain.measured.day', { mm: formatMm(g.mm24h) }),
  ].filter(Boolean)
  return parts.join(separator)
}

export type SatelliteRain = {
  // For each grid cell, the heaviest hour of the window in mm per hour. null means the
  // satellite reported nothing for that cell.
  mm: (number | null)[]
  // The window the numbers cover: the last 3 hours the satellite has reported
  from: number
  to: number
}

export type MeasuredRain = {
  // Every gauge with a usable, recent reading, including dry ones
  gauges: GaugeRain[]
  satellite: SatelliteRain | null
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const isText = (v: unknown): v is string => typeof v === 'string' && v.trim() !== ''
const mmOrNull = (v: unknown): number | null => (isNum(v) && v >= 0 ? v : null)

// Only used to throw out nonsense positions, not to place anything
const LAT_RANGE = [5.5, 10.3]
const LNG_RANGE = [79.2, 82.3]

export function parseGauge(raw: unknown, now: number): GaugeRain | null {
  if (!isObject(raw) || !isObject(raw.measured)) return null
  const { station, basin, lat, lon } = raw
  if (!isText(station) || !isNum(lat) || !isNum(lon)) return null
  if (lat < LAT_RANGE[0] || lat > LAT_RANGE[1] || lon < LNG_RANGE[0] || lon > LNG_RANGE[1]) return null

  const mm1h = mmOrNull(raw.measured.mm1h)
  const mm3h = mmOrNull(raw.measured.mm3h)
  const mm24h = mmOrNull(raw.measured.mm24h)
  const at = raw.measured.at
  if (!isNum(at) || now - at > MAX_AGE_MS || at - now > HOUR_MS) return null

  // The last hour can be quiet while the 3 hours before it were heavy, so both count
  const rates = [mm1h, mm3h === null ? null : mm3h / 3].filter((r): r is number => r !== null)
  if (rates.length === 0) return null
  const rate = Math.max(...rates)

  const level = rainLevel(rate, null)
  const lastHour = classScore(mm1h) >= classScore(rate) && classScore(rate) > 0
  const river = isText(basin) ? basin.trim() : ''
  return {
    id: `${river}/${station}`,
    station: station.trim(),
    river,
    lat,
    lng: lon,
    mm1h,
    mm3h,
    mm24h,
    at,
    rate,
    level,
    mild: level ? null : mildRain(rate),
    lastHour,
  }
}

function sameGrid(grid: unknown): boolean {
  return (
    isObject(grid) &&
    grid.lat0 === SATELLITE_GRID.lat0 &&
    grid.lon0 === SATELLITE_GRID.lng0 &&
    grid.step === SATELLITE_GRID.step &&
    grid.nx === SATELLITE_GRID.nx &&
    grid.ny === SATELLITE_GRID.ny
  )
}

// Each hour is a text of comma-separated values, one per cell, in tenths of a
// millimetre (checked against the gauges: summed over 24 hours the raw numbers are
// about 10 times what the gauges measured). A blank cell is one with no rain
// reported. An hour that isn't in the list yet is not the same as a dry hour.
function parseSatellite(json: Record<string, unknown>, now: number): SatelliteRain | null {
  const satellite = json.satellite
  if (!isObject(satellite) || !Array.isArray(satellite.hours) || !sameGrid(json.grid)) return null

  const hours: { start: number; mm: (number | null)[] }[] = []
  for (const hour of satellite.hours) {
    if (!isObject(hour) || !isNum(hour.start) || typeof hour.v !== 'string') continue
    const values = hour.v.split(',')
    if (values.length !== CELLS) continue
    hours.push({
      start: hour.start,
      mm: values.map((v) => {
        const n = v === '' ? NaN : Number(v)
        return Number.isFinite(n) && n >= 0 ? n / 10 : null
      }),
    })
  }
  if (hours.length === 0) return null

  hours.sort((a, b) => a.start - b.start)
  const latest = hours[hours.length - 1].start
  // The last 3 hours it has, which are not necessarily the last 3 hours of the clock
  const window = hours.filter((h) => h.start > latest - SATELLITE_WINDOW_HOURS * HOUR_MS)
  const to = latest + HOUR_MS
  if (now - to > MAX_AGE_MS) return null

  const mm = Array.from({ length: CELLS }, (_, i) => {
    let worst: number | null = null
    for (const hour of window) {
      const value = hour.mm[i]
      if (value !== null && (worst === null || value > worst)) worst = value
    }
    return worst
  })
  return { mm, from: window[0].start, to }
}

export async function fetchMeasuredRain(): Promise<MeasuredRain> {
  const res = await fetch(RAIN_MAP_URL, { signal: AbortSignal.timeout(WATER_LEVELS_TIMEOUT_MS) })
  if (!res.ok) throw new Error(`Measured rain: HTTP ${res.status}`)

  const json: unknown = await res.json()
  // Either part can be missing without the other being any less true, but an answer
  // with neither isn't the one we expect
  if (!isObject(json) || (!Array.isArray(json.gauges) && !isObject(json.satellite))) {
    throw new Error('Measured rain: unexpected answer')
  }

  const now = Date.now()
  const gauges: GaugeRain[] = []
  if (Array.isArray(json.gauges)) {
    for (const raw of json.gauges) {
      const gauge = parseGauge(raw, now)
      if (gauge) gauges.push(gauge)
    }
  }
  const measured: MeasuredRain = { gauges, satellite: parseSatellite(json, now) }

  if (import.meta.env.DEV) applyTestRain(measured, now)
  return measured
}

// Cells within this distance of the place get the fake satellite rain
const TEST_RADIUS_KM = 15

// For testing only, see fakeRainMap.ts. Fake gauge readings replace a real gauge's, or
// add a gauge at a town. Fake satellite rain goes in the cells around a town, and makes
// a satellite window if the real one is missing.
function applyTestRain(measured: MeasuredRain, now: number) {
  for (const { fake, place, spot } of readFakeRainMap('gauge')) {
    const real = measured.gauges.find((g) => normalise(g.station) === place)
    const target =
      real ??
      (spot
        ? ({ id: `test/${place}`, station: place.charAt(0).toUpperCase() + place.slice(1), river: 'Test', lat: spot[0], lng: spot[1] } as GaugeRain)
        : null)
    if (!target) {
      console.warn(`fakeRainMap: no gauge or town called "${place}"`)
      continue
    }
    Object.assign(target, {
      mm1h: fake.mm,
      mm3h: Math.round(fake.mm * 1.1 * 10) / 10,
      mm24h: Math.round(fake.mm * 1.2 * 10) / 10,
      at: now - 5 * 60_000,
      rate: fake.mm,
      level: fake.level,
      mild: fake.mild,
      lastHour: true,
    })
    if (!real) measured.gauges.push(target)
  }

  const satelliteFakes = readFakeRainMap('satellite')
  if (satelliteFakes.length === 0) return
  const satellite: SatelliteRain = measured.satellite ?? {
    mm: Array.from({ length: CELLS }, () => null),
    from: now - SATELLITE_WINDOW_HOURS * HOUR_MS,
    to: now,
  }
  measured.satellite = satellite
  for (const { fake, spot } of satelliteFakes) {
    if (!spot) continue
    let nearest = 0
    for (let i = 0; i < CELLS; i++) {
      const [a, b] = satelliteCentre(i)
      const [na, nb] = satelliteCentre(nearest)
      if (kmFrom(a, b, spot) < kmFrom(na, nb, spot)) nearest = i
    }
    for (let i = 0; i < CELLS; i++) {
      const [lat, lng] = satelliteCentre(i)
      if (i === nearest || kmFrom(lat, lng, spot) <= TEST_RADIUS_KM) {
        satellite.mm[i] = Math.max(satellite.mm[i] ?? 0, fake.mm)
      }
    }
  }
}
