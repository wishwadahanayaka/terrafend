import { FunctionsHttpError } from '@supabase/supabase-js'
import { t } from '../i18n'
import { SEVERITIES, type Severity } from './hazards'
import { backupSearch } from './backupSearch'
import { isQuotaMessage, quotaUntil, rememberSearchQuota, searchQuotaActive } from './searchQuota'
import { ensureAnonymousSession } from './session'
import { supabase } from './supabase'

export type Point = { lat: number; lng: number }

export type Place = Point & { label: string }

// What is typed in a From or To box, and the place picked from the suggestions
// (null while typing). The route panel owns these, so they survive it being closed.
export type PlaceField = { text: string; place: Place | null }

export const EMPTY_FIELD: PlaceField = { text: '', place: null }

export type RouteResult = {
  // Changes with every checked route, so queries can key on it without hashing the whole line
  id: number
  coordinates: [number, number][]
  distance_m: number
  duration_s: number
  start: Point
  end: Point
  // Points along a reroute, so Google Maps follows the same roads instead of its own choice
  via?: Point[]
}

// Errors carry English text, and the screen turns the ones it knows into the chosen language
// when it shows them (see routeErrorText). Anything else is shown as it came.
export const GENERAL_ERROR = 'Something went wrong. Please try again.'
const RELOAD_ERROR = 'Please reload the page and try again.'
const NO_CONNECTION_ERROR = 'Couldn’t reach the route service. Check your connection and try again.'

// An error from the routing function. `quota` is set when the function says the daily quota
// is used up, and `resetAt` is when it resets, if it said (a newer function sends both; an
// older one only sends the words, so the message is checked too).
export class RoutingError extends Error {
  quota: boolean
  resetAt: string | null

  constructor(message: string, quota = false, resetAt: string | null = null) {
    super(message)
    this.quota = quota
    this.resetAt = resetAt
  }
}

// The function answers with { error: "friendly message" } when it fails
async function errorFrom(error: unknown): Promise<RoutingError> {
  if (error instanceof FunctionsHttpError) {
    try {
      const body = await error.context.json()
      if (typeof body?.error === 'string') {
        const quota = typeof body.quota === 'string' || isQuotaMessage(body.error)
        return new RoutingError(body.error, quota, typeof body.reset_at === 'string' ? body.reset_at : null)
      }
    } catch {
      // not JSON, fall through
    }
    return new RoutingError(error.context.status === 401 ? RELOAD_ERROR : GENERAL_ERROR)
  }
  return new RoutingError(NO_CONNECTION_ERROR)
}

async function callRouting<T>(body: Record<string, unknown>): Promise<T> {
  try {
    // functions.invoke sends the current session's token, so one has to exist
    await ensureAnonymousSession()
  } catch {
    throw new Error(GENERAL_ERROR)
  }
  const { data, error } = await supabase.functions.invoke('routing', { body })
  if (error) throw await errorFrom(error)
  return data as T
}

// Dev server only, so tests never use the real routing function or its quota (see
// fakeRouting.ts). ?fakeRouting=1 answers searches and routes from built-in samples.
// ?fakeRouting=searchdown also makes the main search fail, to try the backup search.
// In a production build the import.meta.env.DEV checks are false, and this code and
// the samples are left out.
function fakeRoutingMode(): string | null {
  return new URLSearchParams(window.location.search).get('fakeRouting')
}

const fakeRoutingOn = () => fakeRoutingMode() !== null

export type PlaceSearchResult = {
  places: Place[]
  // True when the main search failed and the backup answered
  backup: boolean
}

// Any failure of the main search (even a used-up quota) falls back to the backup. An
// honest empty answer from the main search isn't a failure, so it doesn't. Once the search
// quota is used up, the main search isn't tried again until it resets: only searches are
// affected, routes have their own quota.
export async function searchPlaces(text: string, focus: Point): Promise<PlaceSearchResult> {
  try {
    if (import.meta.env.DEV && fakeRoutingMode() === '1') {
      return { places: await (await import('./fakeRouting')).fakeSearch(text), backup: false }
    }
    if (import.meta.env.DEV && fakeRoutingMode() === 'searchdown') throw new Error('Test: main search is down')
    // ?fakeRouting=quota pretends the quota is used up. Only held in memory, so a reload
    // starts afresh and nothing is left in the browser for a real session to find.
    if (import.meta.env.DEV && fakeRoutingMode() === 'quota' && !searchQuotaActive()) {
      throw new RoutingError('Test: quota exceeded', true, null)
    }
    if (searchQuotaActive()) return { places: await backupSearch(text), backup: true }
    return { places: await callRouting<Place[]>({ action: 'search', text, focus }), backup: false }
  } catch (err) {
    if (err instanceof RoutingError && err.quota) {
      rememberSearchQuota(
        quotaUntil(Date.now(), err.resetAt),
        !(import.meta.env.DEV && fakeRoutingMode() === 'quota'),
      )
    }
    try {
      return { places: await backupSearch(text), backup: true }
    } catch {
      // Both are down, and the first message says more
      throw err
    }
  }
}

let nextRouteId = 1

// The routing function takes at most 20 spots to avoid
export const MAX_AVOID = 20

// What the routing function says when every way round passes a spot to avoid
export const ERROR_CHOOSE_START = 'Choose where to start from, or use your location.'
export const ERROR_LOCATION_DENIED =
  'Location permission was denied. Allow it in your browser settings, or search for a starting place.'
export const ERROR_LOCATION_FAILED = 'Couldn’t find your location. Search for a starting place instead.'
export const NO_REROUTE = 'No other route avoids these blocked roads. Take care, or check Google Maps.'

// `avoid` is a list of spots (blocked roads) the route must not pass through
export async function fetchRoute(start: Point, end: Point, avoid: Point[] = []): Promise<RouteResult> {
  const body: Record<string, unknown> = { action: 'route', start, end }
  if (avoid.length > 0) body.avoid = avoid.slice(0, MAX_AVOID)
  const data =
    import.meta.env.DEV && fakeRoutingOn()
      ? await (await import('./fakeRouting')).fakeRoute(start, end, avoid)
      : await callRouting<{
          coordinates: [number, number][]
          distance_m: number
          duration_s: number
        }>(body)
  return { ...data, id: nextRouteId++, start, end }
}

const MAX_ROUTE_POINTS = 20_000

// The database refuses lines over 20,000 points, so very long routes are thinned
export function forDatabase(coordinates: [number, number][]): [number, number][] {
  if (coordinates.length <= MAX_ROUTE_POINTS) return coordinates
  const step = Math.ceil(coordinates.length / MAX_ROUTE_POINTS)
  const thinned = coordinates.filter((_, i) => i % step === 0)
  thinned.push(coordinates[coordinates.length - 1])
  return thinned
}

export function formatKm(meters: number): string {
  const km = meters / 1000
  return t('units.km', { value: km >= 100 ? Math.round(km) : km.toFixed(1) })
}

const at = (p: Point) => `${p.lat.toFixed(5)},${p.lng.toFixed(5)}`

// Waypoints make Google follow a reroute instead of going back to its own fastest road
export function googleMapsUrl(start: Point, end: Point, via: Point[] = []): string {
  const waypoints = via.length > 0 ? `&waypoints=${encodeURIComponent(via.map(at).join('|'))}` : ''
  return `https://www.google.com/maps/dir/?api=1&origin=${at(start)}&destination=${at(end)}${waypoints}&travelmode=driving`
}

// The answers the routing function and this file give, by their English text. The screen
// shows these in the chosen language, and anything not listed as it came.
const KNOWN_ERRORS = new Map<string, string>([
  [GENERAL_ERROR, 'errors.general'],
  [RELOAD_ERROR, 'errors.reload'],
  [NO_CONNECTION_ERROR, 'errors.noConnection'],
  [NO_REROUTE, 'errors.noReroute'],
  ['The daily limit for searches and routes has been reached. Please try again tomorrow.', 'errors.dailyLimit'],
  ['Search and routes aren’t available right now. Please try again later.', 'errors.unavailable'],
  ['Too many requests right now. Please wait a moment and try again.', 'errors.tooMany'],
  ['No driving route found between those points. Try moving them closer to a road.', 'errors.noRoute'],
  [ERROR_CHOOSE_START, 'errors.chooseStart'],
  [ERROR_LOCATION_DENIED, 'errors.locationDeniedRoute'],
  [ERROR_LOCATION_FAILED, 'errors.locationFailedRoute'],
])

export function routeErrorText(message: string): string {
  const key = KNOWN_ERRORS.get(message)
  return key ? t(key) : message
}

// Worst first, like "2 hazards: 1 blocked (3 reports), 1 large vehicles only". A hazard made of
// several reports counts once, and the reports behind it are said in brackets.
export function hazardSummary(
  hazards: { severity: Severity; members?: unknown[] }[],
  hasRiverWarnings = false,
): string {
  // With a river warning nearby, "nothing reported" must not read as "the route is safe"
  if (hazards.length === 0) {
    return t(hasRiverWarnings ? 'route.noHazardsRiver' : 'route.noHazards')
  }
  const parts = [...SEVERITIES]
    .reverse()
    .map((s) => {
      const of = hazards.filter((h) => h.severity === s.value)
      return { s: s.value, n: of.length, reports: of.reduce((sum, h) => sum + (h.members?.length ?? 1), 0) }
    })
    .filter((c) => c.n > 0)
    .map((c) => {
      const part = t(`route.count.${c.s}`, { count: c.n })
      return c.reports > c.n ? t('route.withReports', { part, reports: t('route.reports', { count: c.reports }) }) : part
    })
  return t('route.hazardsHeader', { count: hazards.length, parts: parts.join(', ') })
}
