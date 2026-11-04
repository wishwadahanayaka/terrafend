import { FAKE_LINES } from './fakeRouting'
import type { HazardType, Severity } from './hazards'
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
// Example: ?fakeReport=blocked:40,large:20,blocked:alt1-30

const SEVERITY: Record<string, Severity> = {
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

type FakeReport = Omit<RouteHazard, 'distance_along_m' | 'distance_from_route_m'>

function parse(param: string): FakeReport[] {
  const now = Date.now()
  const reports: FakeReport[] = []
  for (const part of param.split(',')) {
    const match = /^\s*(\w+):(?:(alt1|alt2)-)?(\d+(?:\.\d+)?)\s*$/i.exec(part)
    const severity = match && SEVERITY[match[1].toLowerCase()]
    if (!match || !severity) {
      console.warn(`fakeReport: couldn't read "${part}"`)
      continue
    }
    const line = FAKE_LINES[(match[2]?.toLowerCase() ?? 'main') as keyof typeof FAKE_LINES]
    const [lat, lng] = positionAt(line, cumulativeMetres(line), Number(match[3]) * 1000)
    reports.push({
      // "fake-" tells the card not to offer voting, since these aren't in the database
      id: `fake-${part.trim()}`,
      hazard_type: TYPE[severity],
      severity,
      note: `Test report (${part.trim()}), not saved anywhere`,
      lat,
      lng,
      created_at: new Date(now - 20 * 60_000).toISOString(),
      expires_at: new Date(now + 4 * 3_600_000).toISOString(),
      photo_path: null,
    })
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
