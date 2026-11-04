import { TEST_PLACES } from './fakeRainMap'
import {
  GDACS_TYPE_LABEL,
  islandDistanceKm,
  trackDistanceKm,
  type GdacsEvent,
  type GdacsLevel,
  type GdacsTrack,
  type GdacsType,
} from './gdacs'

// For testing only, so global alerts can be seen when nothing is happening. In the dev
// server, ?fakeGdacs= takes a comma-separated list of [level-]type:place:
//
//   cyclone:trincomalee         a Red cyclone off Trincomalee, with a track and a forecast area
//   orange-earthquake:galle     an Orange earthquake near Galle
//   green-flood:kandy,drought:jaffna
//
// Types: cyclone, earthquake, flood, volcano, drought, wildfire. Levels: green, orange,
// red (red when left out). A place is a town from fakeRainMap.ts, or latitude/longitude like
// orange-earthquake:7.0/79.3 (out at sea west of Colombo). Fakes go through the same
// filters as real events, so one more than 500 km away is dropped like a real one would be.
// Only used inside import.meta.env.DEV checks, so the production build removes it.

const TYPES: Record<string, GdacsType> = {
  cyclone: 'TC',
  earthquake: 'EQ',
  flood: 'FL',
  volcano: 'VO',
  drought: 'DR',
  wildfire: 'WF',
}

const LEVELS: Record<string, GdacsLevel> = { green: 'Green', orange: 'Orange', red: 'Red' }

type LatLng = [number, number]

// A cyclone coming in from the east-south-east and heading west across the island, with
// a forecast area that widens the further ahead it looks, like a real one
function fakeTrack([lat, lng]: LatLng): GdacsTrack {
  const past: LatLng[] = [
    [lat - 1.4, lng + 4.2],
    [lat - 0.8, lng + 2.8],
    [lat - 0.3, lng + 1.4],
    [lat, lng],
  ]
  const ahead: LatLng[] = [
    [lat, lng],
    [lat + 0.3, lng - 1.5],
    [lat + 0.6, lng - 3],
    [lat + 0.9, lng - 4.6],
  ]
  const widths = [0.25, 0.7, 1.2, 1.8]
  // Offset each forecast point sideways, one way for one edge of the cone and the other way for the other
  const side = (sign: number): LatLng[] =>
    ahead.map(([a, b], i) => {
      const next = ahead[Math.min(i + 1, ahead.length - 1)]
      const prev = ahead[Math.max(i - 1, 0)]
      const dLat = next[0] - prev[0]
      const dLng = next[1] - prev[1]
      const length = Math.hypot(dLat, dLng) || 1
      return [a + (sign * widths[i] * -dLng) / length, b + (sign * widths[i] * dLat) / length]
    })
  const cone: LatLng[] = [...side(1), ...side(-1).reverse()]
  return {
    lines: [
      { forecast: false, points: past },
      { forecast: true, points: ahead },
    ],
    cone: [cone],
  }
}

export function fakeAlerts(): GdacsEvent[] {
  const spec = new URLSearchParams(window.location.search).get('fakeGdacs')
  if (!spec) return []

  const events: GdacsEvent[] = []
  for (const [i, part] of spec.split(',').entries()) {
    const [what, where = ''] = part.split(':')
    const words = what.trim().toLowerCase().split('-')
    const level = words.length > 1 ? LEVELS[words[0]] : 'Red'
    const type = TYPES[words[words.length - 1]]
    const place = where.replace(/\s+/g, '').toLowerCase()
    const coords = /^(-?\d+(?:\.\d+)?)\/(-?\d+(?:\.\d+)?)$/.exec(place)
    const spot: LatLng | undefined = coords ? [Number(coords[1]), Number(coords[2])] : TEST_PLACES[place]
    if (!level || !type || !spot) {
      console.warn(
        `fakeGdacs: can't use "${part}". Types: ${Object.keys(TYPES)}. Levels: ${Object.keys(LEVELS)}. Towns: ${Object.keys(TEST_PLACES)}`,
      )
      continue
    }

    const [lat, lng] = spot
    const track = type === 'TC' ? fakeTrack([lat, lng]) : null
    const now = Date.now()
    const distanceKm = Math.min(islandDistanceKm(lat, lng), track ? trackDistanceKm(track) : Infinity)
    const onIsland = islandDistanceKm(lat, lng) < 30
    const severity = { TC: 140, EQ: 6.5, DR: 25000, WF: 1200, FL: null, VO: null }[type]
    const event: GdacsEvent = {
      id: `fake-${type}-${i}`,
      type,
      level,
      name: `${GDACS_TYPE_LABEL[type]} TEST-${i + 1}`,
      lat,
      lng,
      countries: onIsland || type === 'TC' ? ['Sri Lanka'] : [],
      affectsSriLanka: onIsland || type === 'TC',
      severity,
      severityText: type === 'EQ' ? 'Magnitude 6.5M, Depth:12km' : '',
      from: now - 3 * 3_600_000,
      modified: now - 20 * 60_000,
      url: 'https://www.gdacs.org/',
      track,
      distanceKm,
    }
    // The same rule real events go through
    if (event.affectsSriLanka || distanceKm <= 500) events.push(event)
  }
  return events
}
