// The hourly rain request shared by the route check and the island-wide rain map.
// No key is needed, but the credit has to stay visible wherever the data is shown.

import {
  limitReason,
  OpenMeteoError,
  parseRetryAfter,
  rateLimitedUntil,
  rateLimitWait,
  rememberRateLimit,
} from './openMeteoLimit'

const API_URL = 'https://api.open-meteo.com/v1/forecast'
const FETCH_TIMEOUT_MS = 10_000

export const HOUR_MS = 3_600_000
// Sri Lanka has no daylight saving, so its offset from UTC is always 5 h 30 min
const COLOMBO_OFFSET_MS = 5.5 * HOUR_MS

// Open-Meteo labels each hour like "2026-11-03T14:00" and gives the rain of the hour
// before that label. This turns the moment an hour ends into its label.
export function labelForHourEnd(endMs: number): string {
  return new Date(endMs + COLOMBO_OFFSET_MS).toISOString().slice(0, 13) + ':00'
}

// The label for someone there at `ms`: at 2:10 pm that's the 15:00 value
export function hourLabel(ms: number): string {
  return labelForHourEnd(Math.ceil((ms + COLOMBO_OFFSET_MS) / HOUR_MS) * HOUR_MS - COLOMBO_OFFSET_MS)
}

// When the current Sri Lanka hour ends
export function currentHourEnd(ms: number): number {
  return Math.floor((ms + COLOMBO_OFFSET_MS) / HOUR_MS) * HOUR_MS + HOUR_MS - COLOMBO_OFFSET_MS
}

export type Hourly = {
  time: string[]
  precipitation: (number | null)[]
  weather_code: (number | null)[]
  // Chance of rain in that hour, in percent. null means the model didn't say.
  probability: (number | null)[]
}

const isNumOrNull = (v: unknown): v is number | null => v === null || typeof v === 'number'

// The answer is only trusted if it has the shape we expect
function parseHourly(entry: unknown): Hourly {
  const hourly = (entry as { hourly?: Record<string, unknown> } | null)?.hourly
  const { time, precipitation, weather_code, precipitation_probability: probability } = hourly ?? {}
  if (
    !Array.isArray(time) ||
    !time.every((t) => typeof t === 'string') ||
    !Array.isArray(precipitation) ||
    !precipitation.every(isNumOrNull) ||
    !Array.isArray(weather_code) ||
    !weather_code.every(isNumOrNull) ||
    !Array.isArray(probability) ||
    !probability.every(isNumOrNull) ||
    precipitation.length !== time.length ||
    weather_code.length !== time.length ||
    probability.length !== time.length
  ) {
    throw new Error('Rain forecast: unexpected answer')
  }
  return { time, precipitation, weather_code, probability }
}

// The request for these places. The forecast-refresh function (supabase/functions) builds the
// same one for the shared cache, and a test checks the two stay identical.
export function forecastUrl(places: { lat: number; lng: number }[]): string {
  // Two decimals is about 1 km, finer than the forecast's own grid
  const lat = places.map((p) => p.lat.toFixed(2)).join(',')
  const lng = places.map((p) => p.lng.toFixed(2)).join(',')
  return (
    `${API_URL}?latitude=${lat}&longitude=${lng}&hourly=precipitation,weather_code,precipitation_probability` +
    `&timezone=Asia%2FColombo&forecast_days=2`
  )
}

// A 429 is remembered, so nothing asks again until the wait is over. `waitMs` is only given
// by the dev fake, which cuts the wait short.
function rateLimited(reason: string | null, retryAfterMs: number | null, waitMs?: number): OpenMeteoError {
  const now = Date.now()
  const retryAt = now + (waitMs ?? rateLimitWait(reason, retryAfterMs))
  // The dev fake keeps the wait in memory only, so it can't leave anything behind
  rememberRateLimit(retryAt, waitMs === undefined)
  console.warn(
    `Open-Meteo is limiting requests (429): ${reason ?? 'no reason given'}. ` +
      `Waiting until ${new Date(retryAt).toLocaleTimeString()} before asking again.`,
  )
  return new OpenMeteoError(`Rain forecast: HTTP 429${reason ? `: ${reason}` : ''}`, 429, reason, retryAt)
}

async function failureOf(res: Response): Promise<OpenMeteoError> {
  let reason: string | null = null
  try {
    reason = limitReason(await res.json())
  } catch {
    // no readable reason
  }
  if (res.status === 429) return rateLimited(reason, parseRetryAfter(res.headers.get('Retry-After'), Date.now()))
  return new OpenMeteoError(`Rain forecast: HTTP ${res.status}${reason ? `: ${reason}` : ''}`, res.status, reason, null)
}

// One request for all the places, answered in the same order. Hours are in Sri Lanka
// time, today and tomorrow, so a trip or a 3-hour window can cross midnight.
export async function fetchHourly(places: { lat: number; lng: number }[]): Promise<Hourly[]> {
  // After a 429 nothing is sent until the wait is over
  const waiting = rateLimitedUntil()
  if (waiting !== null) {
    throw new OpenMeteoError('Rain forecast: waiting after a 429', 429, null, waiting)
  }
  if (import.meta.env.DEV) {
    const fake = await import('./fakeForecast')
    if (fake.fakeForecastFails()) throw rateLimited(fake.FAKE_REASON, null, fake.FAKE_WAIT_MS)
  }

  const res = await fetch(forecastUrl(places), { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })
  if (!res.ok) throw await failureOf(res)

  // One place comes back as an object, several as a list
  const json: unknown = await res.json()
  const entries = Array.isArray(json) ? json : [json]
  if (entries.length !== places.length) throw new Error('Rain forecast: unexpected answer')
  return entries.map(parseHourly)
}
