import { nearRoute } from './routeGauges'
import { NO_REROUTE, type Place, type Point } from './routing'

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
export const COLOMBO_KANDY: [number, number][] = [
  [79.8612, 6.9271],
  [79.9506, 7.001],
  [80.0955, 7.1436],
  [80.2, 7.18],
  [80.3464, 7.2513],
  [80.445, 7.2528],
  [80.5378, 7.2564],
  [80.6337, 7.2906],
]
// Other ways from Colombo to Kandy, tried in this order when there's something to avoid.
// alt1 goes north through Kurunegala, alt2 east through Avissawella and joins the A1 at
// Mawanella. All three share only the first few hundred metres and the end in Kandy.
export const COLOMBO_KANDY_ALT1: [number, number][] = [
  [79.8612, 6.9271],
  [79.8916, 7.0744],
  [79.953, 7.1667],
  [80.017, 7.247],
  [80.118, 7.329],
  [80.228, 7.422],
  [80.3647, 7.4867],
  [80.443, 7.432],
  [80.52, 7.37],
  [80.62, 7.33],
  [80.6337, 7.2906],
]
export const COLOMBO_KANDY_ALT2: [number, number][] = [
  [79.8612, 6.9271],
  [79.984, 6.935],
  [80.084, 6.91],
  [80.2046, 6.9543],
  [80.257, 7.046],
  [80.33, 7.135],
  [80.42, 7.2],
  [80.445, 7.2528],
  [80.5378, 7.2564],
  [80.6337, 7.2906],
]
export const FAKE_LINES = { main: COLOMBO_KANDY, alt1: COLOMBO_KANDY_ALT1, alt2: COLOMBO_KANDY_ALT2 }

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

// Roughly what the real 200 m avoid squares catch
const AVOID_M = 120

const passes = (line: [number, number][], spots: Point[]) =>
  nearRoute(line, spots, AVOID_M).length > 0

// A sample route in either direction, if both ends are close to the sample's ends. With
// spots to avoid, the first sample that misses all of them is used, like a reroute.
export async function fakeRoute(start: Point, end: Point, avoid: Point[] = []) {
  await sleep(400)
  for (const options of [[COLOMBO_KANDY, COLOMBO_KANDY_ALT1, COLOMBO_KANDY_ALT2], [COLOMBO_KALUTARA]]) {
    const first = options[0][0]
    const last = options[0][options[0].length - 1]
    const forward = near(start, first) && near(end, last)
    const backward = near(start, last) && near(end, first)
    if (!forward && !backward) continue

    const line = options.find((l) => !passes(l, avoid))
    if (!line) throw new Error(NO_REROUTE)
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
