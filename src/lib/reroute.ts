import { t } from '../i18n'
import { cumulativeMetres, positionAt } from './routeGeometry'
import { nearRoute } from './routeGauges'
import type { Point, RouteResult } from './routing'
import type { RouteHazard } from './useRoute'

// Only fully blocked roads are worth a detour. Everything else stays a warning.
export const blockedOn = <T extends { severity: RouteHazard['severity'] }>(hazards: T[]): T[] =>
  hazards.filter((h) => h.severity === 'blocked')

// A blocked road to steer around: the spot on the route where it was passed, and the ids of
// every report behind it. Several reports of one road are avoided once, and the ids are how a
// later check tells the road is already covered, even if a different report now stands for it.
// The report can be up to 150 m off the line, so the avoid square goes on the road itself,
// not on the pin, or it could miss the road entirely.
export type AvoidSpot = { ids: string[]; point: Point }

type Avoidable = { id: string; distance_along_m: number; members?: { id: string }[] }

const idsOf = (h: Avoidable) => (h.members ?? [h]).map((m) => m.id)

export function avoidSpot(route: RouteResult, hazard: Avoidable): AvoidSpot {
  const [lat, lng] = positionAt(route.coordinates, cumulativeMetres(route.coordinates), hazard.distance_along_m)
  return { ids: idsOf(hazard), point: { lat, lng } }
}

// The hazards that no spot covers yet
export const notAvoided = <T extends Avoidable>(spots: AvoidSpot[], hazards: T[]): T[] =>
  hazards.filter((h) => !idsOf(h).some((id) => spots.some((s) => s.ids.includes(id))))

// The spots so far, plus one for each hazard found on `foundOn` that isn't covered yet
export function addAvoidSpots(spots: AvoidSpot[], foundOn: RouteResult, hazards: Avoidable[]): AvoidSpot[] {
  return [...spots, ...notAvoided(spots, hazards).map((h) => avoidSpot(foundOn, h))]
}

const SAMPLE_M = 250
// Further than this from the original line counts as a different road
const APART_M = 300
const MIN_DETOUR_M = 500
// Google Maps on phones only takes a few waypoints
const MAX_WAYPOINTS = 3
// A detour longer than this per waypoint gets another one
const LONG_DETOUR_M = 15_000

// Where the new route leaves the original: one point in the middle of each detour, the
// longest few kept. Between waypoints Google picks its own roads, and its choice is
// close to the original route, so the waypoints have to sit on the detours.
export function detourWaypoints(next: RouteResult, original: RouteResult): Point[] {
  const line = next.coordinates
  if (line.length < 2) return []
  const along = cumulativeMetres(line)
  const total = along[along.length - 1]

  const samples: (Point & { at: number })[] = []
  for (let m = 0; m <= total; m += SAMPLE_M) {
    const [lat, lng] = positionAt(line, along, m)
    samples.push({ lat, lng, at: m })
  }
  const close = new Set(nearRoute(original.coordinates, samples, APART_M).map((n) => n.item))

  const detours: { from: number; to: number }[] = []
  let current: { from: number; to: number } | null = null
  for (const s of samples) {
    if (close.has(s)) {
      current = null
    } else if (current) {
      current.to = s.at
    } else {
      current = { from: s.at, to: s.at }
      detours.push(current)
    }
  }

  const chosen = detours
    .filter((d) => d.to - d.from >= MIN_DETOUR_M)
    .sort((a, b) => b.to - b.from - (a.to - a.from))
    .slice(0, MAX_WAYPOINTS)
    .map((d) => ({ ...d, points: 1 }))

  // Spare waypoints go to long detours, so Google can't cut back to the blocked road
  // halfway along one
  let spare = MAX_WAYPOINTS - chosen.length
  while (spare > 0 && chosen.length > 0) {
    const roomiest = chosen.reduce((a, b) => ((b.to - b.from) / b.points > (a.to - a.from) / a.points ? b : a))
    if ((roomiest.to - roomiest.from) / roomiest.points < LONG_DETOUR_M) break
    roomiest.points++
    spare--
  }

  return chosen
    .sort((a, b) => a.from - b.from)
    .flatMap((d) =>
      Array.from({ length: d.points }, (_, k) => {
        const [lat, lng] = positionAt(line, along, d.from + ((d.to - d.from) * (k + 1)) / (d.points + 1))
        return { lat, lng }
      }),
    )
}

// "+8 km", "−3 km", "+11 min"
export function difference(value: number, unit: 'km' | 'min'): string {
  const n = Math.round(value)
  const sign = n > 0 ? '+' : n < 0 ? '−' : '±'
  return t(`units.${unit}`, { value: `${sign}${Math.abs(n)}` })
}
