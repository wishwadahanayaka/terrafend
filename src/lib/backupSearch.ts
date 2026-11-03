import type { Place } from './routing'

const GEOCODING_URL = 'https://geocoding-api.open-meteo.com/v1/search'
const FETCH_TIMEOUT_MS = 8_000

export const OPEN_METEO_URL = 'https://open-meteo.com/'

// The fallback when the main place search can't answer. Free, no key, called from the
// browser. It only knows towns and cities, not streets or businesses.
export async function backupSearch(text: string): Promise<Place[]> {
  const url =
    `${GEOCODING_URL}?name=${encodeURIComponent(text)}&count=5&language=en&format=json&countryCode=LK`
  const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })
  if (!res.ok) throw new Error(`Backup search: HTTP ${res.status}`)

  // With nothing found the answer has no "results" at all
  const json: { results?: unknown } = await res.json()
  const results = Array.isArray(json?.results) ? json.results : []

  const places: Place[] = []
  for (const r of results as Record<string, unknown>[]) {
    const { name, admin1, latitude, longitude } = r
    if (typeof name !== 'string' || typeof latitude !== 'number' || typeof longitude !== 'number') continue
    // "Kandy, Central Province, Sri Lanka", leaving out a part that repeats the name
    const parts = [name, typeof admin1 === 'string' && admin1 !== name ? admin1 : null, 'Sri Lanka']
    places.push({ label: parts.filter(Boolean).join(', '), lat: latitude, lng: longitude })
  }
  return places.slice(0, 5)
}
