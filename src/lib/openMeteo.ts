// The hourly rain request shared by the route check and the island-wide rain map.
// No key is needed, but the credit has to stay visible wherever the data is shown.

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

export type Hourly = { time: string[]; precipitation: (number | null)[]; weather_code: (number | null)[] }

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

// One request for all the places, answered in the same order. Hours are in Sri Lanka
// time, today and tomorrow, so a trip or a 3-hour window can cross midnight.
export async function fetchHourly(places: { lat: number; lng: number }[]): Promise<Hourly[]> {
  // Two decimals is about 1 km, finer than the forecast's own grid
  const lat = places.map((p) => p.lat.toFixed(2)).join(',')
  const lng = places.map((p) => p.lng.toFixed(2)).join(',')
  const url =
    `${API_URL}?latitude=${lat}&longitude=${lng}&hourly=precipitation,weather_code` +
    `&timezone=Asia%2FColombo&forecast_days=2`
  const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })
  if (!res.ok) throw new Error(`Rain forecast: HTTP ${res.status}`)

  // One place comes back as an object, several as a list
  const json: unknown = await res.json()
  const entries = Array.isArray(json) ? json : [json]
  if (entries.length !== places.length) throw new Error('Rain forecast: unexpected answer')
  return entries.map(parseHourly)
}
