import { FAKE_LINES } from './fakeRouting'
import { HAZARD_TYPES, type HazardType, type Severity } from './hazards'
import { cumulativeMetres, positionAt } from './routeGeometry'
import { nearRoute } from './routeGauges'
import type { RouteResult } from './routing'
import type { RouteHazard } from './useRoute'

// For testing only, used when the dev server is opened with ?fakeReport=. It adds made-up
// reports to the hazards along a checked route, so the reroute can be tried without
// putting real reports in the database. useRoute.ts only loads this inside an
// import.meta.env.DEV check.
//
// A comma-separated list of severity:place. Severities: blocked, large (large vehicles
// only), passable. The place is km from Colombo along one of the sample Colombo-Kandy
// routes in fakeRouting.ts: a plain number is the main road (A1), alt1-30 is 30 km along
// the Kurunegala road, alt2-30 is 30 km along the Avissawella road.
//
// Three optional extras go after the place, in this order:
//   xN     N reports instead of one, 40 m apart along the road. blocked:40x3 is three
//          reports at 40.00, 40.04 and 40.08 km, which the route check groups as one hazard.
//          Five or more spread over 160 m, so the last one falls outside the 150 m group.
//   @type  a hazard type such as fallen_tree, instead of the one the severity picks.
//          blocked:40@fallen_tree next to blocked:40 is two different hazards in one spot.
//   !      the severity was changed by someone 5 minutes ago ("Updated to Blocked").
// Fake cards also say "confirmed by 3 people", whatever the real count would be.
// Examples: ?fakeReport=blocked:40,large:20,blocked:alt1-30
//           ?fakeReport=blocked:40x3          (one blocked road, 3 reports)
//           ?fakeReport=blocked:40x2,blocked:40.2   (the third is 200 m on: a separate road)

export const SEVERITY_WORDS: Record<string, Severity> = {
  blocked: 'blocked',
  large: 'large_vehicles_only',
  large_vehicles_only: 'large_vehicles_only',
  passable: 'passable',
}

const TYPE: Record<Severity, HazardType> = {
  blocked: 'road_closed',
  large_vehicles_only: 'fallen_tree',
  passable: 'road_works',
}

// How far apart the reports of an xN group are
const SPACING_M = 40

type FakeReport = Omit<RouteHazard, 'distance_along_m' | 'distance_from_route_m'>

function parse(param: string): FakeReport[] {
  const now = Date.now()
  const reports: FakeReport[] = []
  for (const part of param.split(',')) {
    const match = /^\s*(\w+):(?:(alt1|alt2)-)?(\d+(?:\.\d+)?)(?:x(\d+))?(?:@(\w+))?(!)?\s*$/i.exec(part)
    const severity = match && SEVERITY_WORDS[match[1].toLowerCase()]
    if (!match || !severity) {
      console.warn(`fakeReport: couldn't read "${part}"`)
      continue
    }
    const typeWord = match[5]?.toLowerCase()
    const hazardType = typeWord ? HAZARD_TYPES.find((h) => h.value === typeWord)?.value : TYPE[severity]
    if (!hazardType) {
      console.warn(`fakeReport: "${typeWord}" isn't a hazard type`)
      continue
    }
    const line = FAKE_LINES[(match[2]?.toLowerCase() ?? 'main') as keyof typeof FAKE_LINES]
    const along = cumulativeMetres(line)
    const count = Math.min(Number(match[4] ?? 1), 10)
    for (let i = 0; i < count; i++) {
      const [lat, lng] = positionAt(line, along, Number(match[3]) * 1000 + i * SPACING_M)
      reports.push({
        // "fake-" tells the card not to offer voting, since these aren't in the database
        id: count > 1 ? `fake-${part.trim()}-${i + 1}` : `fake-${part.trim()}`,
        hazard_type: hazardType,
        severity,
        note: `Test report (${part.trim()}), not saved anywhere`,
        lat,
        lng,
        // Each a minute older than the last, so they differ a little like real ones
        created_at: new Date(now - (20 + i) * 60_000).toISOString(),
        expires_at: new Date(now + 4 * 3_600_000).toISOString(),
        photo_path: null,
        severity_updated_at: match[6] ? new Date(now - 5 * 60_000).toISOString() : null,
      })
    }
  }
  return reports
}

// The fake reports within the usual 150 m of this route
export function fakeReportsAlong(route: RouteResult, bufferM: number): RouteHazard[] | null {
  const param = new URLSearchParams(window.location.search).get('fakeReport')
  if (!param) return null
  return nearRoute(route.coordinates, parse(param), bufferM).map(({ item, distanceAlongM, distanceFromRouteM }) => ({
    ...item,
    distance_along_m: distanceAlongM,
    distance_from_route_m: distanceFromRouteM,
  }))
}
