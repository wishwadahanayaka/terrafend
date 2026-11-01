import { FunctionsHttpError } from '@supabase/supabase-js'
import { severityLabel, SEVERITIES, type Severity } from './hazards'
import { ensureAnonymousSession } from './session'
import { supabase } from './supabase'

export type Point = { lat: number; lng: number }

export type Place = Point & { label: string }

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

export function searchPlaces(text: string, focus: Point): Promise<Place[]> {
  return callRouting<Place[]>({ action: 'search', text, focus })
}

let nextRouteId = 1

export async function fetchRoute(start: Point, end: Point): Promise<RouteResult> {
  const data = await callRouting<{
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
export function hazardSummary(hazards: { severity: Severity }[]): string {
  if (hazards.length === 0) return 'No reported hazards on this route'
  const parts = [...SEVERITIES]
    .reverse()
    .map((s) => ({ s: s.value, n: hazards.filter((h) => h.severity === s.value).length }))
    .filter((c) => c.n > 0)
    .map((c) => `${c.n} ${severityLabel(c.s).toLowerCase()}`)
  const noun = hazards.length === 1 ? 'hazard' : 'hazards'
  return `${hazards.length} ${noun}: ${parts.join(', ')}`
}
