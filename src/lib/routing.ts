import { FunctionsHttpError } from '@supabase/supabase-js'
import { severityLabel, SEVERITIES, type Severity } from './hazards'
import { backupSearch } from './backupSearch'
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
}

const GENERAL_ERROR = 'Something went wrong. Please try again.'

// The function answers with { error: "friendly message" } when it fails
async function messageFrom(error: unknown): Promise<string> {
  if (error instanceof FunctionsHttpError) {
    try {
      const body = await error.context.json()
      if (typeof body?.error === 'string') return body.error
    } catch {
      // not JSON, fall through
    }
    if (error.context.status === 401) return 'Please reload the page and try again.'
    return GENERAL_ERROR
  }
  return 'Couldn’t reach the route service. Check your connection and try again.'
}

async function callRouting<T>(body: Record<string, unknown>): Promise<T> {
  try {
    // functions.invoke sends the current session's token, so one has to exist
    await ensureAnonymousSession()
  } catch {
    throw new Error(GENERAL_ERROR)
  }
  const { data, error } = await supabase.functions.invoke('routing', { body })
  if (error) throw new Error(await messageFrom(error))
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
// honest empty answer from the main search isn't a failure, so it doesn't.
export async function searchPlaces(text: string, focus: Point): Promise<PlaceSearchResult> {
  try {
    if (import.meta.env.DEV && fakeRoutingMode() === '1') {
      return { places: await (await import('./fakeRouting')).fakeSearch(text), backup: false }
    }
    if (import.meta.env.DEV && fakeRoutingMode() === 'searchdown') throw new Error('Test: main search is down')
    return { places: await callRouting<Place[]>({ action: 'search', text, focus }), backup: false }
  } catch (err) {
    try {
      return { places: await backupSearch(text), backup: true }
    } catch {
      // Both are down, and the first message says more
      throw err
    }
  }
}

let nextRouteId = 1

export async function fetchRoute(start: Point, end: Point): Promise<RouteResult> {
  const data =
    import.meta.env.DEV && fakeRoutingOn()
      ? await (await import('./fakeRouting')).fakeRoute(start, end)
      : await callRouting<{
          coordinates: [number, number][]
          distance_m: number
          duration_s: number
        }>({ action: 'route', start, end })
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
  return `${km >= 100 ? Math.round(km) : km.toFixed(1)} km`
}

export function googleMapsUrl(start: Point, end: Point): string {
  return `https://www.google.com/maps/dir/?api=1&origin=${start.lat},${start.lng}&destination=${end.lat},${end.lng}&travelmode=driving`
}

// Worst first, like "2 hazards: 1 blocked, 1 large vehicles only"
export function hazardSummary(hazards: { severity: Severity }[], hasRiverWarnings = false): string {
  // With a river warning nearby, "nothing reported" must not read as "the route is safe"
  if (hazards.length === 0) {
    return hasRiverWarnings ? 'No hazards reported by users on this route' : 'No reported hazards on this route'
  }
  const parts = [...SEVERITIES]
    .reverse()
    .map((s) => ({ s: s.value, n: hazards.filter((h) => h.severity === s.value).length }))
    .filter((c) => c.n > 0)
    .map((c) => `${c.n} ${severityLabel(c.s).toLowerCase()}`)
  const noun = hazards.length === 1 ? 'hazard' : 'hazards'
  return `${hazards.length} ${noun}: ${parts.join(', ')}`
}
