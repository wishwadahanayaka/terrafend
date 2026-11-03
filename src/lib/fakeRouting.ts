import type { Place, Point } from './routing'

// For testing only, used when the dev server is opened with ?fakeRouting=1. It stands in
// for the routing function, so tests never use up the OpenRouteService quota.
// routing.ts only loads this inside an import.meta.env.DEV check, so the production
// build leaves it out.

const PLACES: Place[] = [
  { label: 'Colombo, CO, Sri Lanka', lat: 6.9271, lng: 79.8612 },
  { label: 'Kandy, KY, Sri Lanka', lat: 7.2906, lng: 80.6337 },
  { label: 'Kalutara, KT, Sri Lanka', lat: 6.5854, lng: 79.9607 },
  { label: 'Galle, GL, Sri Lanka', lat: 6.0535, lng: 80.221 },
  { label: 'Negombo, GM, Sri Lanka', lat: 7.2008, lng: 79.8737 },
]

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

export async function fakeSearch(text: string): Promise<Place[]> {
  await sleep(250)
  const wanted = text.trim().toLowerCase()
  return PLACES.filter((p) => p.label.toLowerCase().includes(wanted)).slice(0, 5)
}

// Rough waypoints along the real roads, [lng, lat] like the real routes
const COLOMBO_KANDY: [number, number][] = [
  [79.8612, 6.9271],
  [79.9506, 7.001],
  [80.0955, 7.1436],
  [80.2, 7.18],
  [80.3464, 7.2513],
  [80.445, 7.2528],
  [80.5378, 7.2564],
  [80.6337, 7.2906],
]
const COLOMBO_KALUTARA: [number, number][] = [
  [79.8612, 6.9271],
  [79.8816, 6.773],
  [79.9026, 6.7132],
  [79.9607, 6.5854],
]

const RADIANS = Math.PI / 180

function metres(a: Point, b: Point): number {
  const dLat = (b.lat - a.lat) * RADIANS
  const dLng = (b.lng - a.lng) * RADIANS
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * RADIANS) * Math.cos(b.lat * RADIANS) * Math.sin(dLng / 2) ** 2
  return 2 * 6_371_000 * Math.asin(Math.sqrt(h))
}

const near = (a: Point, [lng, lat]: [number, number]) => metres(a, { lat, lng }) < 25_000

// A sample route in either direction, if both ends are close to the sample's ends
export async function fakeRoute(start: Point, end: Point) {
  await sleep(400)
  for (const line of [COLOMBO_KANDY, COLOMBO_KALUTARA]) {
    const first = line[0]
    const last = line[line.length - 1]
    const forward = near(start, first) && near(end, last)
    const backward = near(start, last) && near(end, first)
    if (!forward && !backward) continue

    const coordinates = forward ? line : [...line].reverse()
    let distance = 0
    for (let i = 1; i < coordinates.length; i++) {
      distance += metres(
        { lat: coordinates[i - 1][1], lng: coordinates[i - 1][0] },
        { lat: coordinates[i][1], lng: coordinates[i][0] },
      )
    }
    // Roads wind a bit more than the waypoints do, and about 45 km/h is a fair average
    const distance_m = Math.round(distance * 1.1)
    return { coordinates, distance_m, duration_s: Math.round(distance_m / 12.5) }
  }
  throw new Error('Test routing only knows Colombo to Kandy and Colombo to Kalutara (either way).')
}
