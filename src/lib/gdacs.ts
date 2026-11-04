import { SRI_LANKA_BOUNDS } from './mapBounds'
import { metresBetween } from './routeGauges'

// GDACS, the UN and EU's Global Disaster Alert and Coordination System. Free, no key,
// and it allows requests from the browser (it sends Access-Control-Allow-Origin: *).
const API = 'https://www.gdacs.org/gdacsapi/api/events/geteventlist/SEARCH'
const FETCH_TIMEOUT_MS = 15_000

export const GDACS_CREDIT = 'Data: GDACS (European Commission JRC and UN OCHA)'
export const GDACS_NOTICE = 'Not an official warning. Follow DMC for official alerts.'

// The server sends 100 events a page
const PAGE_SIZE = 100
// Every event GDACS calls current ended within about 4 days, so asking only for the last
// 5 days leaves out the year of old events the plain list carries
const WINDOW_DAYS = 5

// An event counts as relevant if it lists Sri Lanka as affected, or where it is now (its
// location, or for a cyclone also its forecast track and forecast area) is within this
// distance of the island. A cyclone's past track doesn't count: one that passed 400 km away
// two days ago and has moved on is no threat.
export const GDACS_RADIUS_KM = 500
// A cyclone's track can reach Sri Lanka from far away, so tracks are fetched for any
// current cyclone with its centre this close, then judged on the track itself
const TRACK_CANDIDATE_KM = 3000
const MAX_TRACKS = 4
// A route is "near" a point event (earthquake, volcano, wildfire) inside this
export const GDACS_ROUTE_KM = 100

export type GdacsType = 'TC' | 'EQ' | 'FL' | 'VO' | 'DR' | 'WF'
export type GdacsLevel = 'Green' | 'Orange' | 'Red'

export const GDACS_TYPE_LABEL: Record<GdacsType, string> = {
  TC: 'Tropical cyclone',
  EQ: 'Earthquake',
  FL: 'Flood',
  VO: 'Volcano',
  DR: 'Drought',
  WF: 'Wildfire',
}

// GDACS's own green, orange and red
export const GDACS_LEVEL_COLOR: Record<GdacsLevel, string> = {
  Green: '#16a34a',
  Orange: '#ea580c',
  Red: '#dc2626',
}

export const isSerious = (level: GdacsLevel) => level !== 'Green'

type LatLng = [number, number]

// A cyclone's track in pieces (observed ones and forecast ones) and its forecast area
export type GdacsTrack = {
  lines: { forecast: boolean; points: LatLng[] }[]
  cone: LatLng[][]
}

export type GdacsEvent = {
  id: string
  type: GdacsType
  level: GdacsLevel
  name: string
  lat: number
  lng: number
  countries: string[]
  affectsSriLanka: boolean
  // Magnitude, wind speed or area, depending on the type. null when GDACS has none.
  severity: number | null
  severityText: string
  from: number
  modified: number
  url: string
  track: GdacsTrack | null
  // How close the nearest part GDACS gives is to the island, in km
  distanceKm: number
}

const TYPES: GdacsType[] = ['TC', 'EQ', 'FL', 'VO', 'DR', 'WF']
const LEVELS: GdacsLevel[] = ['Green', 'Orange', 'Red']

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const isText = (v: unknown): v is string => typeof v === 'string' && v.trim() !== ''

// GDACS gives times in UTC without saying so
function utc(text: unknown): number | null {
  if (!isText(text)) return null
  const ms = Date.parse(/[zZ]|[+-]\d\d:?\d\d$/.test(text) ? text : `${text}Z`)
  return Number.isNaN(ms) ? null : ms
}

type Parsed = Omit<GdacsEvent, 'track' | 'distanceKm'> & { current: boolean; trackUrl: string | null }

// Only the shape we expect is trusted. Anything else is skipped, not guessed at.
function parseEvent(raw: unknown): Parsed | null {
  if (!isObject(raw) || !isObject(raw.properties) || !isObject(raw.geometry)) return null
  const p = raw.properties
  const g = raw.geometry
  if (g.type !== 'Point' || !Array.isArray(g.coordinates)) return null
  const [lng, lat] = g.coordinates
  if (!isNum(lat) || !isNum(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null

  const type = TYPES.find((t) => t === p.eventtype)
  if (!type || !isNum(p.eventid)) return null
  // The level of the episode GDACS is on now, which can be lower than the event's peak
  const level = LEVELS.find((l) => l === p.episodealertlevel) ?? LEVELS.find((l) => l === p.alertlevel)
  if (!level) return null

  const affected = Array.isArray(p.affectedcountries) ? p.affectedcountries.filter(isObject) : []
  const countries = affected.flatMap((c) => (isText(c.countryname) ? [c.countryname.trim()] : []))
  const affectsSriLanka =
    affected.some((c) => c.iso3 === 'LKA') || (isText(p.country) && /sri lanka/i.test(p.country))

  const severity = isObject(p.severitydata) ? p.severitydata : {}
  const from = utc(p.fromdate)
  const modified = utc(p.datemodified) ?? from
  if (from === null || modified === null) return null

  const urls = isObject(p.url) ? p.url : {}
  const https = (u: unknown) => (isText(u) && u.startsWith('https://www.gdacs.org/') ? u : null)

  return {
    id: `${type}-${p.eventid}`,
    type,
    level,
    name: (isText(p.name) ? p.name : GDACS_TYPE_LABEL[type]).replace(/\s+/g, ' ').trim(),
    lat,
    lng,
    countries,
    affectsSriLanka,
    severity: isNum(severity.severity) && severity.severity > 0 ? severity.severity : null,
    severityText: isText(severity.severitytext) ? severity.severitytext : '',
    from,
    modified,
    // Only real GDACS web links are kept, so a bad value can never become a script link
    url: https(urls.report) ?? 'https://www.gdacs.org/',
    current: p.iscurrent === 'true' || p.iscurrent === true,
    trackUrl: https(urls.geometry),
  }
}

const day = (daysAgo: number) => new Date(Date.now() - daysAgo * 86_400_000).toISOString().slice(0, 10)

async function fetchList(query: string, maxPages: number): Promise<unknown[]> {
  const features: unknown[] = []
  for (let page = 1; page <= maxPages; page++) {
    const res = await fetch(`${API}?${query}&pagenumber=${page}`, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })
    if (!res.ok) throw new Error(`Global alerts: HTTP ${res.status}`)
    const json: unknown = await res.json()
    if (!isObject(json) || !Array.isArray(json.features)) throw new Error('Global alerts: unexpected answer')
    features.push(...json.features)
    if (json.features.length < PAGE_SIZE) break
  }
  return features
}

// Distance from a spot to the island's bounding box, which is close enough for "within 500 km"
export function islandDistanceKm(lat: number, lng: number): number {
  const [[south, west], [north, east]] = SRI_LANKA_BOUNDS as [[number, number], [number, number]]
  const nearLat = Math.min(Math.max(lat, south), north)
  const nearLng = Math.min(Math.max(lng, west), east)
  return metresBetween([lng, lat], [nearLng, nearLat]) / 1000
}

// Adds points along a line, so a long edge between two far-apart points can't hide a near miss
function densify(points: LatLng[], stepKm = 25): LatLng[] {
  const out: LatLng[] = []
  for (let i = 0; i < points.length; i++) {
    out.push(points[i])
    const next = points[i + 1]
    if (!next) continue
    const km = metresBetween([points[i][1], points[i][0]], [next[1], next[0]]) / 1000
    const pieces = Math.ceil(km / stepKm)
    for (let k = 1; k < pieces; k++) {
      const t = k / pieces
      out.push([points[i][0] + (next[0] - points[i][0]) * t, points[i][1] + (next[1] - points[i][1]) * t])
    }
  }
  return out
}

// Ray casting: is the spot inside the ring?
export function insideRing(lat: number, lng: number, ring: LatLng[]): boolean {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [lat1, lng1] = ring[i]
    const [lat2, lng2] = ring[j]
    if (lng1 > lng !== lng2 > lng && lat < ((lat2 - lat1) * (lng - lng1)) / (lng2 - lng1) + lat1) inside = !inside
  }
  return inside
}

export function trackDistanceKm(track: GdacsTrack): number {
  const [[south, west], [north, east]] = SRI_LANKA_BOUNDS as [[number, number], [number, number]]
  const island: LatLng[] = [
    [(south + north) / 2, (west + east) / 2],
    [south, west],
    [south, east],
    [north, west],
    [north, east],
  ]
  // The island inside the forecast area is as close as it gets
  if (track.cone.some((ring) => island.some(([lat, lng]) => insideRing(lat, lng, ring)))) return 0

  // Only where it's heading: the forecast track and the forecast area. Where it has been doesn't matter.
  const ahead = track.lines.filter((l) => l.forecast).map((l) => l.points)
  const points = [...ahead, ...track.cone].flatMap((line) => densify(line))
  return points.length === 0 ? Infinity : Math.min(...points.map(([lat, lng]) => islandDistanceKm(lat, lng)))
}

// GeoJSON is [lng, lat]; the map wants [lat, lng]
const flip = (coords: unknown): LatLng[] =>
  Array.isArray(coords)
    ? coords.flatMap((c) => (Array.isArray(c) && isNum(c[0]) && isNum(c[1]) ? [[c[1], c[0]] as LatLng] : []))
    : []

// The track pieces (past ones and forecast ones) and the forecast area, out of the many
// shapes GDACS draws for a cyclone (wind footprints and so on, which are left out). The
// cone is the "forecast area".
async function fetchTrack(url: string): Promise<GdacsTrack | null> {
  const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })
  if (!res.ok) throw new Error(`Global alerts: HTTP ${res.status}`)
  const json: unknown = await res.json()
  if (!isObject(json) || !Array.isArray(json.features)) throw new Error('Global alerts: unexpected answer')

  const track: GdacsTrack = { lines: [], cone: [] }
  for (const f of json.features) {
    if (!isObject(f) || !isObject(f.geometry) || !isObject(f.properties)) continue
    const kind = f.properties.Class
    if (typeof kind !== 'string') continue
    const g = f.geometry
    if (kind.startsWith('Line_') && g.type === 'LineString') {
      const points = flip(g.coordinates)
      if (points.length >= 2) track.lines.push({ forecast: f.properties.forecast === true || f.properties.forecast === 'true', points })
    } else if (kind === 'Poly_Cones' && Array.isArray(g.coordinates)) {
      // A polygon is a list of rings (the first is the outside), a multi-polygon is a list of those
      const polygons = g.type === 'MultiPolygon' ? g.coordinates : [g.coordinates]
      for (const polygon of polygons) {
        if (Array.isArray(polygon)) {
          const ring = flip(polygon[0])
          if (ring.length >= 3) track.cone.push(ring)
        }
      }
    }
  }
  return track.lines.length > 0 || track.cone.length > 0 ? track : null
}

// Current events only, each with its distance from the island, and the cyclone tracks
// that could matter. Only events that reach Sri Lanka or come within the radius are kept.
async function relevant(features: unknown[]): Promise<GdacsEvent[]> {
  const byId = new Map<string, Parsed>()
  for (const raw of features) {
    const event = parseEvent(raw)
    if (event && event.current) byId.set(event.id, event)
  }
  const events = [...byId.values()]

  // Cyclone tracks are big, so only the cyclones that could be close get theirs. One that
  // can't be fetched is still judged by where it is.
  const candidates = events
    .filter((e) => e.type === 'TC' && e.trackUrl && islandDistanceKm(e.lat, e.lng) <= TRACK_CANDIDATE_KM)
    .sort((a, b) => islandDistanceKm(a.lat, a.lng) - islandDistanceKm(b.lat, b.lng))
    .slice(0, MAX_TRACKS)
  const tracks = new Map<string, GdacsTrack | null>()
  await Promise.all(
    candidates.map(async (e) => {
      try {
        tracks.set(e.id, await fetchTrack(e.trackUrl as string))
      } catch {
        tracks.set(e.id, null)
      }
    }),
  )

  const found: GdacsEvent[] = []
  for (const { current: _current, trackUrl: _trackUrl, ...event } of events) {
    const track = tracks.get(event.id) ?? null
    const distanceKm = Math.min(islandDistanceKm(event.lat, event.lng), track ? trackDistanceKm(track) : Infinity)
    if (event.affectsSriLanka || distanceKm <= GDACS_RADIUS_KM) found.push({ ...event, track, distanceKm })
  }
  return found
}

const ALL_TYPES = 'eventlist=TC;EQ;FL;VO;DR;WF'

// Orange and Red events from the last few days, plus anything GDACS says affects Sri
// Lanka at any level. These are the ones that always show, so they're fetched always.
export async function fetchCoreAlerts(): Promise<GdacsEvent[]> {
  const [recent, listingSriLanka] = await Promise.all([
    fetchList(`fromdate=${day(WINDOW_DAYS)}&todate=${day(0)}&alertlevel=Orange;Red&${ALL_TYPES}`, 3),
    fetchList(`country=${encodeURIComponent('Sri Lanka')}&alertlevel=Green;Orange;Red&${ALL_TYPES}`, 2),
  ])
  const events = await relevant([...recent, ...listingSriLanka])
  if (import.meta.env.DEV) {
    const { fakeAlerts } = await import('./fakeGdacs')
    events.push(...fakeAlerts())
  }
  return events
}

// Green events from the last few days, all over the world. There are hundreds of them
// (mostly small earthquakes and wildfires), so they're only fetched when the Global
// alerts switch is on.
export async function fetchGreenAlerts(): Promise<GdacsEvent[]> {
  const window = `fromdate=${day(WINDOW_DAYS)}&todate=${day(0)}&alertlevel=Green`
  const [slow, quakes, fires] = await Promise.all([
    fetchList(`${window}&eventlist=TC;FL;VO;DR`, 2),
    fetchList(`${window}&eventlist=EQ`, 3),
    fetchList(`${window}&eventlist=WF`, 4),
  ])
  return relevant([...slow, ...quakes, ...fires])
}

// "Magnitude 6.5 · depth 18 km", "Maximum wind speed 157 km/h", "2,009,754 km² affected"
export function gdacsDetails(e: GdacsEvent): string[] {
  const lines: string[] = []
  if (e.type === 'EQ' && e.severity !== null) {
    const depth = /depth:\s*(\d+)\s*km/i.exec(e.severityText)
    lines.push(`Magnitude ${e.severity}${depth ? ` · depth ${depth[1]} km` : ''}`)
  } else if (e.type === 'TC' && e.severity !== null) {
    lines.push(`Maximum wind speed ${Math.round(e.severity)} km/h`)
  } else if (e.type === 'DR' && e.severity !== null) {
    lines.push(`${Math.round(e.severity).toLocaleString('en-GB')} km² affected`)
  } else if (e.type === 'WF' && e.severity !== null) {
    lines.push(`${Math.round(e.severity).toLocaleString('en-GB')} ha burned or burning`)
  }
  // Sri Lanka goes first, so it's never hidden in "and 12 more". This is the card's
  // only mention of it, so it's added even when GDACS left it out of the list.
  const others = e.countries.filter((c) => !/sri lanka/i.test(c))
  const countries = e.affectsSriLanka ? ['Sri Lanka', ...others] : e.countries
  if (countries.length > 0) {
    // Droughts can list dozens of countries
    const shown = countries.slice(0, 4).join(', ')
    lines.push(`Affected: ${shown}${countries.length > 4 ? ` and ${countries.length - 4} more` : ''}`)
  }
  return lines
}
