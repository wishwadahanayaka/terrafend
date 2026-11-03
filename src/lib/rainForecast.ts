import { cumulativeMetres, positionAt, sliceRoute } from './routeGeometry'
import type { RouteResult } from './routing'

const API_URL = 'https://api.open-meteo.com/v1/forecast'
const FETCH_TIMEOUT_MS = 10_000

export const RAIN_CREDIT_URL = 'https://open-meteo.com/'

export type RainLevel = 'heavy' | 'veryHeavy' | 'thunder'

export const RAIN_LABEL: Record<RainLevel, string> = {
  heavy: 'Heavy rain',
  veryHeavy: 'Very heavy rain',
  thunder: 'Thunderstorms',
}

// Blue-purple, so rain can't be mistaken for the yellow to red of the river steps.
// All dark enough for white text.
export const RAIN_COLOR: Record<RainLevel, string> = {
  heavy: '#4f46e5',
  veryHeavy: '#3730a3',
  thunder: '#7e22ce',
}

const RANK: Record<RainLevel, number> = { heavy: 1, veryHeavy: 2, thunder: 3 }

export function worstRain(levels: RainLevel[]): RainLevel | null {
  let worst: RainLevel | null = null
  for (const level of levels) if (!worst || RANK[level] > RANK[worst]) worst = level
  return worst
}

// mm of rain in an hour
const HEAVY_MM = 7.5
const VERY_HEAVY_MM = 15

// WMO weather codes 95 to 99 are thunderstorms. A thunderstorm counts as that
// whatever the rain amount, since it's a different kind of danger on the road.
export function rainLevel(mm: number | null, code: number | null): RainLevel | null {
  if (code !== null && code >= 95 && code <= 99) return 'thunder'
  if (mm === null) return null
  if (mm >= VERY_HEAVY_MM) return 'veryHeavy'
  if (mm >= HEAVY_MM) return 'heavy'
  return null
}

// Quieter levels, not warnings: they get one plain line in the panel and nothing on the map
export type MildLevel = 'light' | 'moderate'

export const MILD_LABEL: Record<MildLevel, string> = {
  light: 'Light rain',
  moderate: 'Moderate rain',
}

const LIGHT_MM = 0.5
const MODERATE_MM = 2.5

export function mildRain(mm: number | null): MildLevel | null {
  if (mm === null || mm >= HEAVY_MM) return null
  if (mm >= MODERATE_MM) return 'moderate'
  if (mm >= LIGHT_MM) return 'light'
  return null
}

const SPACING_KM = 10
const MAX_POINTS = 25

type Sample = { km: number; lat: number; lng: number; at: number }

// Points about every 10 km along the route, the start and end included. A very long
// route gets them further apart instead of more of them. Each point gets the time
// the driver would be there: leaving at `departure`, with the trip's duration
// spread in proportion to the distance.
export function samplePoints(route: RouteResult, departure: number): Sample[] {
  const line = route.coordinates
  if (line.length < 2) return []
  const along = cumulativeMetres(line)
  const total = along[along.length - 1]

  const segments = Math.min(MAX_POINTS - 1, Math.max(1, Math.ceil(total / 1000 / SPACING_KM)))
  const samples: Sample[] = []
  for (let i = 0; i <= segments; i++) {
    const d = (total * i) / segments
    const [lat, lng] = positionAt(line, along, d)
    samples.push({
      km: d / 1000,
      lat,
      lng,
      at: departure + (total === 0 ? 0 : (d / total) * route.duration_s * 1000),
    })
  }
  return samples
}

// Sri Lanka has no daylight saving, so its offset from UTC is always 5 h 30 min
const COLOMBO_OFFSET_MS = 5.5 * 3_600_000
const HOUR_MS = 3_600_000

// Open-Meteo labels each hour like "2026-11-03T14:00" and gives the rain of the hour
// before that label. So someone there at 2:10 pm needs the 15:00 value.
function hourLabel(ms: number): string {
  const end = Math.ceil((ms + COLOMBO_OFFSET_MS) / HOUR_MS) * HOUR_MS
  return new Date(end).toISOString().slice(0, 13) + ':00'
}

type Hourly = { time: string[]; precipitation: (number | null)[]; weather_code: (number | null)[] }

const isNumOrNull = (v: unknown): v is number | null => v === null || typeof v === 'number'

// The answer is only trusted if it has the shape we expect
function parseHourly(entry: unknown): Hourly {
  const hourly = (entry as { hourly?: Record<string, unknown> } | null)?.hourly
  const { time, precipitation, weather_code } = hourly ?? {}
  if (
    !Array.isArray(time) ||
    !time.every((t) => typeof t === 'string') ||
    !Array.isArray(precipitation) ||
    !precipitation.every(isNumOrNull) ||
    !Array.isArray(weather_code) ||
    !weather_code.every(isNumOrNull) ||
    precipitation.length !== time.length ||
    weather_code.length !== time.length
  ) {
    throw new Error('Rain forecast: unexpected answer')
  }
  return { time, precipitation, weather_code }
}

// A point's weather: null when the forecast doesn't reach that hour
// level is a warning; mild is the quieter kind, and only set when there's no warning
type Reading = { level: RainLevel | null; mild: MildLevel | null; mm: number | null } | null

export type RainStretch = {
  // Tells stretches apart, for the map markers and list
  id: string
  level: RainLevel
  fromKm: number
  toKm: number
  // When the driver would reach the first point of the stretch
  at: number
  maxMm: number | null
}

export type MildRain = {
  level: MildLevel
  // "along most of the route", "around 5–15 km", "near 40 km" or "in places along the route"
  where: string
}

export type RainResult = {
  stretches: RainStretch[]
  // Light or moderate rain, if there is any. Never counted as a warning.
  mild: MildRain | null
  // Leaving time, and the last arrival time the forecast covered
  from: number
  to: number
  // True when the forecast ended before the trip did
  partial: boolean
}

export async function fetchRain(route: RouteResult): Promise<RainResult> {
  const departure = Date.now()
  const samples = samplePoints(route, departure)
  if (samples.length === 0) throw new Error('Rain forecast: route too short')

  // Two decimals is about 1 km, finer than the forecast's own grid
  const lat = samples.map((s) => s.lat.toFixed(2)).join(',')
  const lng = samples.map((s) => s.lng.toFixed(2)).join(',')
  const url =
    `${API_URL}?latitude=${lat}&longitude=${lng}&hourly=precipitation,weather_code` +
    `&timezone=Asia%2FColombo&forecast_days=2`
  const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })
  if (!res.ok) throw new Error(`Rain forecast: HTTP ${res.status}`)

  // One place comes back as an object, several as a list
  const json: unknown = await res.json()
  const entries = Array.isArray(json) ? json : [json]
  if (entries.length !== samples.length) throw new Error('Rain forecast: unexpected answer')

  const readings: Reading[] = entries.map((entry, i) => {
    const hourly = parseHourly(entry)
    const index = hourly.time.indexOf(hourLabel(samples[i].at))
    if (index === -1) return null
    const mm = hourly.precipitation[index]
    const level = rainLevel(mm, hourly.weather_code[index])
    return { level, mild: level ? null : mildRain(mm), mm }
  })
  if (import.meta.env.DEV) applyTestRain(samples, readings)

  const known = samples.filter((_, i) => readings[i] !== null)
  if (known.length === 0) throw new Error('Rain forecast: no hours covered')

  // Neighbouring points with the same level become one stretch
  const stretches: RainStretch[] = []
  let open: RainStretch | null = null
  for (const [i, sample] of samples.entries()) {
    const reading = readings[i]
    if (!reading?.level) {
      open = null
    } else if (open && open.level === reading.level) {
      open.toKm = sample.km
      if (reading.mm !== null) open.maxMm = Math.max(open.maxMm ?? 0, reading.mm)
    } else {
      open = {
        id: `${reading.level}-${Math.round(sample.km)}`,
        level: reading.level,
        fromKm: sample.km,
        toKm: sample.km,
        at: sample.at,
        maxMm: reading.mm,
      }
      stretches.push(open)
    }
  }

  return {
    stretches,
    mild: summariseMild(samples, readings),
    from: departure,
    to: known[known.length - 1].at,
    partial: known.length < samples.length,
  }
}

// "near 78 km" or "around 39–49 km"
function placeText(fromKm: number, toKm: number): string {
  const from = Math.round(fromKm)
  const to = Math.round(toKm)
  return from === to ? `near ${from} km` : `around ${from}–${to} km`
}

export function rainPlace(s: RainStretch): string {
  return placeText(s.fromKm, s.toKm)
}

// One line for the quieter rain. It talks about the heaviest of it (moderate over
// light), and says where in the simplest words that fit.
function summariseMild(samples: Sample[], readings: Reading[]): MildRain | null {
  const mildAt = (i: number) => readings[i]?.mild ?? null
  const all = samples.map((_, i) => i)
  const level: MildLevel | null = all.some((i) => mildAt(i) === 'moderate')
    ? 'moderate'
    : all.some((i) => mildAt(i) === 'light')
      ? 'light'
      : null
  if (!level) return null

  const points = all.filter((i) => mildAt(i) === level)
  const known = readings.filter((r) => r !== null).length
  const first = points[0]
  const last = points[points.length - 1]
  // Only the points with this rain next to each other make one range
  const together = last - first + 1 === points.length

  const where =
    points.length / known >= 0.6
      ? 'along most of the route'
      : together
        ? placeText(samples[first].km, samples[last].km)
        : 'in places along the route'
  return { level, where }
}

// How much of the route is drawn for a stretch. A single sample point stands for the
// ground around it, so it gets about 5 km either side.
const SINGLE_POINT_PAD_KM = 5

function rainSpan(s: RainStretch): [number, number] {
  return s.fromKm === s.toKm ? [s.fromKm - SINGLE_POINT_PAD_KM, s.toKm + SINGLE_POINT_PAD_KM] : [s.fromKm, s.toKm]
}

// The part of the route to colour, as [lat, lng] pairs
export function rainPath(route: RouteResult, s: RainStretch): [number, number][] {
  const [from, to] = rainSpan(s)
  return sliceRoute(route.coordinates, from, to)
}

// Where the stretch's icon goes: the middle of the coloured part
export function rainMiddle(route: RouteResult, s: RainStretch): [number, number] {
  const [from, to] = rainSpan(s)
  const along = cumulativeMetres(route.coordinates)
  const total = along[along.length - 1]
  const mid = (Math.max(from, 0) * 1000 + Math.min(to * 1000, total)) / 2
  return positionAt(route.coordinates, along, mid)
}

// For testing only. In the dev server, ?fakeRain=heavy:35-50,thunder:80 puts heavy
// rain from 35 to 50 km and a thunderstorm at 80 km (the nearest point), so the
// warnings can be seen on a dry day. Levels: light, moderate, heavy, veryheavy, thunder.
// import.meta.env.DEV is false in the production build, so this is removed there.
function applyTestRain(samples: Sample[], readings: Reading[]) {
  const spec = new URLSearchParams(window.location.search).get('fakeRain')
  if (!spec) return
  const fakes: Record<string, NonNullable<Reading>> = {
    light: { level: null, mild: 'light', mm: 1 },
    moderate: { level: null, mild: 'moderate', mm: 4 },
    heavy: { level: 'heavy', mild: null, mm: 9 },
    veryheavy: { level: 'veryHeavy', mild: null, mm: 18 },
    thunder: { level: 'thunder', mild: null, mm: 20 },
  }
  for (const part of spec.split(',')) {
    const [name, range = ''] = part.split(':')
    const fake = fakes[name.trim().toLowerCase()]
    const [a, b = a] = range.split('-').map(Number)
    if (!fake || Number.isNaN(a) || Number.isNaN(b)) continue

    // A single distance means the nearest sample point
    let nearest = 0
    for (const [i, s] of samples.entries()) {
      if (Math.abs(s.km - a) < Math.abs(samples[nearest].km - a)) nearest = i
    }
    for (const [i, s] of samples.entries()) {
      const hit = a === b ? i === nearest : s.km >= a && s.km <= b
      if (hit && readings[i]) readings[i] = fake
    }
  }
}
