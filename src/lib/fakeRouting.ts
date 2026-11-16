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
  { label: 'Mawanella, KG, Sri Lanka', lat: 7.2528, lng: 80.445 },
  { label: 'Ratnapura, RN, Sri Lanka', lat: 6.6828, lng: 80.3992 },
  { label: 'Badulla, BD, Sri Lanka', lat: 6.9934, lng: 81.055 },
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

// Colombo to Galle along the coast: no landslide warning area in any ?fakeLandslide= mode touches it
export const COLOMBO_GALLE: [number, number][] = [
  [79.8612, 6.9271],
  [79.8816, 6.773],
  [79.9026, 6.7132],
  [79.9607, 6.5854],
  [80.0, 6.4],
  [80.05, 6.25],
  [80.1, 6.14],
  [80.221, 6.0535],
]
// Colombo to Mawanella through Avissawella, Ruwanwella and the south of Kegalle district: passes
// Aranayake (Level 3 in ?fakeLandslide=mixed and level3) and Mawanella (Level 2)
export const COLOMBO_MAWANELLA: [number, number][] = [
  [79.8612, 6.9271],
  [79.984, 6.935],
  [80.084, 6.91],
  [80.2046, 6.9543],
  [80.257, 7.046],
  [80.33, 7.135],
  [80.42, 7.2],
  [80.445, 7.2528],
]
// Colombo to Ratnapura by way of Avissawella: passes Eheliyagoda (Level 3)
export const COLOMBO_RATNAPURA: [number, number][] = [
  [79.8612, 6.9271],
  [80.0, 6.94],
  [80.215, 6.9528],
  [80.27, 6.855],
  [80.36, 6.78],
  [80.3992, 6.6828],
]
// Kandy to Badulla by way of Nuwara Eliya: passes Badulla (a Level 1 area in level1, mixed and kegalle)
export const KANDY_BADULLA: [number, number][] = [
  [80.6337, 7.2906],
  [80.7, 7.15],
  [80.76, 7.0],
  [80.9, 6.95],
  [81.055, 6.9934],
]

const RADIANS = Math.PI / 180

function metres(a: Point, b: Point): number {
  const dLat = (b.lat - a.lat) * RADIANS
  const dLng = (b.lng - a.lng) * RADIANS
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * RADIANS) * Math.cos(b.lat * RADIANS) * Math.sin(dLng / 2) ** 2
  return 2 * 6_371_000 * Math.asin(Math.sqrt(h))
}

const near = (a: Point, [lng, lat]: [number, number], km = 25) => metres(a, { lat, lng }) < km * 1000

// The places the test routes run between. The first group that fits both ends is used, so the ones with a
// narrow radius come first: Mawanella is only 21 km from Kandy.
const GROUPS: { options: [number, number][][]; km: number }[] = [
  { options: [COLOMBO_MAWANELLA], km: 8 },
  { options: [COLOMBO_RATNAPURA], km: 25 },
  { options: [KANDY_BADULLA], km: 25 },
  { options: [COLOMBO_GALLE], km: 25 },
  { options: [COLOMBO_KANDY, COLOMBO_KANDY_ALT1, COLOMBO_KANDY_ALT2], km: 25 },
  { options: [COLOMBO_KALUTARA], km: 25 },
]

// Roughly what the real 200 m avoid squares catch
const AVOID_M = 120

const passes = (line: [number, number][], spots: Point[]) =>
  nearRoute(line, spots, AVOID_M).length > 0

// A sample route in either direction, if both ends are close to the sample's ends. With
// spots to avoid, the first sample that misses all of them is used, like a reroute.
export async function fakeRoute(start: Point, end: Point, avoid: Point[] = []) {
  await sleep(400)
  for (const { options, km } of GROUPS) {
    const first = options[0][0]
    const last = options[0][options[0].length - 1]
    const forward = near(start, first, km) && near(end, last, km)
    const backward = near(start, last, km) && near(end, first, km)
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
  throw new Error(
    'Test routing only knows Colombo to Kandy, Kalutara, Galle, Mawanella and Ratnapura, and Kandy to Badulla (either way).',
  )
}
