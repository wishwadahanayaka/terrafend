import { describe, expect, it } from 'vitest'
import { rainPlaceAt, rainPlaceBetween } from './rainForecast'
import { groupReports } from './duplicates'
import { addAvoidSpots, avoidedCount, avoidSpot, blockedOn, detourWaypoints, difference, notAvoided } from './reroute'
import { nearRoute } from './routeGauges'
import { cumulativeMetres, positionAt } from './routeGeometry'
import type { RouteResult } from './routing'
import type { RouteHazard } from './useRoute'

// [lng, lat] like the real routes: due north from 7.0 to 7.2, about 22 km
const NORTH: [number, number][] = [
  [80, 7],
  [80, 7.1],
  [80, 7.2],
]

function route(coordinates: [number, number][]): RouteResult {
  const [lng0, lat0] = coordinates[0]
  const [lng1, lat1] = coordinates[coordinates.length - 1]
  return {
    id: 1,
    coordinates,
    distance_m: 0,
    duration_s: 0,
    start: { lat: lat0, lng: lng0 },
    end: { lat: lat1, lng: lng1 },
  }
}

function hazard(id: string, severity: RouteHazard['severity'], alongM = 0): RouteHazard {
  return {
    id,
    hazard_type: 'road_closed',
    severity,
    note: null,
    lat: 7,
    lng: 80,
    created_at: '2026-11-04T05:00:00Z',
    expires_at: '2026-11-04T11:00:00Z',
    photo_path: null,
    distance_along_m: alongM,
    distance_from_route_m: 20,
  }
}

describe('distance along the route', () => {
  it('adds up the length of each piece', () => {
    const along = cumulativeMetres(NORTH)
    expect(along[0]).toBe(0)
    // 0.1 degree of latitude is about 11.1 km
    expect(along[1]).toBeCloseTo(11_119, -1)
    expect(along[2]).toBeCloseTo(2 * along[1], 3)
  })

  it('finds the spot a given distance along, stopping at the ends', () => {
    const along = cumulativeMetres(NORTH)
    const [lat, lng] = positionAt(NORTH, along, along[2] / 4)
    expect(lat).toBeCloseTo(7.05, 6)
    expect(lng).toBe(80)
    expect(positionAt(NORTH, along, -100)).toEqual([7, 80])
    expect(positionAt(NORTH, along, 1e9)).toEqual([7.2, 80])
  })

  it('finds how far along and how far off the route something is', () => {
    const [found] = nearRoute(NORTH, [{ lat: 7.15, lng: 80.001 }], 500)
    expect(found.distanceAlongM).toBeCloseTo(cumulativeMetres(NORTH)[2] * 0.75, -1)
    // 0.001 degree of longitude at 7 degrees north is about 110 m
    expect(found.distanceFromRouteM).toBeCloseTo(110, -1)
  })

  it('leaves out things further away than asked, and sorts by route order', () => {
    const items = [
      { lat: 7.18, lng: 80, name: 'later' },
      { lat: 7.02, lng: 80, name: 'earlier' },
      { lat: 7.1, lng: 80.05, name: 'far' },
    ]
    expect(nearRoute(NORTH, items, 150).map((n) => n.item.name)).toEqual(['earlier', 'later'])
  })
})

describe('start and end wording', () => {
  it('says "at the start" within 5 km of the start', () => {
    expect(rainPlaceAt(0, 100)).toBe('at the start of the route')
    expect(rainPlaceAt(5, 100)).toBe('at the start of the route')
  })

  it('says "near the end" within 5 km of the end', () => {
    expect(rainPlaceAt(95, 100)).toBe('near the end of the route')
    expect(rainPlaceAt(100, 100)).toBe('near the end of the route')
  })

  it('gives a km figure in the middle', () => {
    expect(rainPlaceAt(40.4, 100)).toBe('near 40 km')
    expect(rainPlaceBetween(39.4, 49.2, 100)).toBe('around 39–49 km')
  })

  it('words ranges that touch an end', () => {
    expect(rainPlaceBetween(0, 25, 100)).toBe('from the start of the route to 25 km')
    expect(rainPlaceBetween(80, 100, 100)).toBe('from 80 km to the end of the route')
    expect(rainPlaceBetween(1, 99, 100)).toBe('along the whole route')
  })

  it('picks the nearer end on a short route', () => {
    expect(rainPlaceAt(2, 8)).toBe('at the start of the route')
    expect(rainPlaceAt(6, 8)).toBe('near the end of the route')
  })
})

describe('reroute', () => {
  it('only counts fully blocked reports', () => {
    const list = [hazard('a', 'passable'), hazard('b', 'blocked'), hazard('c', 'large_vehicles_only'), hazard('d', 'blocked')]
    expect(blockedOn(list).map((h) => h.id)).toEqual(['b', 'd'])
    expect(blockedOn([hazard('a', 'large_vehicles_only')])).toEqual([])
  })

  it('avoids the spot on the road, where the route passes the report', () => {
    const r = route(NORTH)
    const total = cumulativeMetres(NORTH)[2]
    const spot = avoidSpot(r, hazard('b', 'blocked', total / 2))
    expect(spot.ids).toEqual(['b'])
    expect(spot.point.lat).toBeCloseTo(7.1, 6)
    expect(spot.point.lng).toBe(80)
  })

  it('avoids a hazard made of several reports once, in the middle of them', () => {
    const r = route(NORTH)
    const near = (id: string, alongM: number) => ({ ...hazard(id, 'blocked', alongM), lat: 7 + alongM / 110_574 })
    // Three reports of one blocked road 40 m apart, and another road 5 km on
    const groups = groupReports([near('a', 10_000), near('b', 10_040), near('c', 10_080), near('d', 15_000)])
    expect(groups).toHaveLength(2)

    const spots = addAvoidSpots([], r, groups)
    expect(spots).toHaveLength(2)
    expect(spots[0].ids).toEqual(['a', 'b', 'c'])
    // Middle of 10,000 and 10,080 m along; the route code counts 111,195 m to a degree
    expect(spots[0].point.lat).toBeCloseTo(7 + 10_040 / 111_195, 4)
  })

  it('does not avoid a road twice when a different report now stands for it', () => {
    const r = route(NORTH)
    const near = (id: string, alongM: number) => ({ ...hazard(id, 'blocked', alongM), lat: 7 + alongM / 110_574 })
    const first = addAvoidSpots([], r, groupReports([near('a', 10_000), near('b', 10_040)]))
    // A third report joins later and the newest one leads the group, but a and b are still in it
    const again = groupReports([near('a', 10_000), near('b', 10_040), near('c', 10_060)])
    expect(notAvoided(first, again)).toEqual([])
    expect(addAvoidSpots(first, r, again)).toHaveLength(1)
    // A different road still gets its own spot
    expect(addAvoidSpots(first, r, groupReports([near('z', 18_000)]))).toHaveLength(2)
  })

  it('counts the avoided roads a route really stays clear of', () => {
    const near = (id: string, alongM: number) => ({ ...hazard(id, 'blocked', alongM), lat: 7 + alongM / 110_574 })
    const r = route(NORTH)
    const spots = addAvoidSpots([], r, groupReports([near('a', 5_000), near('b', 5_040), near('c', 15_000)]))
    expect(spots).toHaveLength(2)
    // A route that passes none of them avoids both
    expect(avoidedCount(spots, [])).toBe(2)
    // One that still passes the second road (by any one of its reports) avoids only the first
    expect(avoidedCount(spots, groupReports([near('c', 15_000)]))).toBe(1)
    expect(avoidedCount(spots, groupReports([near('b', 5_040)]))).toBe(1)
    // Still passing both
    expect(avoidedCount(spots, groupReports([near('a', 5_000), near('c', 15_000)]))).toBe(0)
    expect(avoidedCount([], [])).toBe(0)
  })

  it('puts Google Maps waypoints on the detour, at most 3', () => {
    const original = route(NORTH)
    // Leaves the road at 7.05, goes about 5.5 km east, and comes back at 7.15
    const detour = route([
      [80, 7],
      [80, 7.05],
      [80.05, 7.05],
      [80.05, 7.15],
      [80, 7.15],
      [80, 7.2],
    ])
    const waypoints = detourWaypoints(detour, original)
    expect(waypoints.length).toBeGreaterThan(0)
    expect(waypoints.length).toBeLessThanOrEqual(3)
    for (const p of waypoints) {
      const [near] = nearRoute(NORTH, [p], 1e6)
      expect(near.distanceFromRouteM).toBeGreaterThan(300)
    }
  })

  it('needs no waypoints when the route is the same', () => {
    expect(detourWaypoints(route(NORTH), route(NORTH))).toEqual([])
  })

  it('writes the difference with a sign', () => {
    expect(difference(8.2, 'km')).toBe('+8 km')
    expect(difference(-3, 'km')).toBe('−3 km')
    expect(difference(0.2, 'min')).toBe('±0 min')
  })
})
