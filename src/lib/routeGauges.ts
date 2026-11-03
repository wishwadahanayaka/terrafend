import { isAlertOrAbove, type RiverGauge } from './riverGauges'

export type GaugeNearRoute = {
  gauge: RiverGauge
  distanceAlongM: number
  distanceFromRouteM: number
}

const EARTH_RADIUS_M = 6_371_000
const RAD = Math.PI / 180

export function metresBetween(a: [number, number], b: [number, number]): number {
  const dLat = (b[1] - a[1]) * RAD
  const dLng = (b[0] - a[0]) * RAD
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * RAD) * Math.cos(b[1] * RAD) * Math.sin(dLng / 2) ** 2
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h))
}

export type NearRoute<T> = {
  item: T
  distanceAlongM: number
  distanceFromRouteM: number
}

// River gauges at Alert or above that are within maxM of the route, in route order
export function gaugesNearRoute(
  route: [number, number][],
  gauges: RiverGauge[],
  maxM = 2000,
): GaugeNearRoute[] {
  return nearRoute(
    route,
    gauges.filter((g) => isAlertOrAbove(g.step)),
    maxM,
  ).map(({ item, ...rest }) => ({ gauge: item, ...rest }))
}

// Anything with a position that is within maxM of the route, in route order.
// The route is [lng, lat] pairs. Over a few kilometres the ground is flat
// enough to measure on a plain grid around each item, which keeps this simple.
export function nearRoute<T extends { lat: number; lng: number }>(
  route: [number, number][],
  items: T[],
  maxM: number,
): NearRoute<T>[] {
  if (route.length < 2) return []

  // Distance from the start to each point, so "how far along" is a lookup
  const along = [0]
  for (let i = 1; i < route.length; i++) {
    along.push(along[i - 1] + metresBetween(route[i - 1], route[i]))
  }

  const found: NearRoute<T>[] = []
  for (const gauge of items) {
    const mPerDegLng = 111_320 * Math.cos(gauge.lat * RAD)
    const mPerDegLat = 110_574
    // Position of a route point in metres east and north of the gauge
    const toGrid = ([lng, lat]: [number, number]) => [
      (lng - gauge.lng) * mPerDegLng,
      (lat - gauge.lat) * mPerDegLat,
    ]

    let best = Infinity
    let bestAlong = 0
    for (let i = 1; i < route.length; i++) {
      const [ax, ay] = toGrid(route[i - 1])
      const [bx, by] = toGrid(route[i])
      const dx = bx - ax
      const dy = by - ay
      const lengthSq = dx * dx + dy * dy
      // How far along this piece the closest point is, from 0 to 1 (the gauge is at 0,0)
      const t = lengthSq === 0 ? 0 : Math.max(0, Math.min(1, -(ax * dx + ay * dy) / lengthSq))
      const dist = Math.hypot(ax + t * dx, ay + t * dy)
      if (dist < best) {
        best = dist
        bestAlong = along[i - 1] + t * (along[i] - along[i - 1])
      }
    }

    if (best <= maxM) found.push({ item: gauge, distanceAlongM: bestAlong, distanceFromRouteM: best })
  }

  return found.sort((a, b) => a.distanceAlongM - b.distanceAlongM)
}
