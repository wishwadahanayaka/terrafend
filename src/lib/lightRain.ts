import { kmFrom } from './fakeRainMap'
import { LIGHT_MM } from './rainForecast'
import { SATELLITE_GRID, type GaugeRain, type SatelliteRain } from './rainMeasured'

// The satellite sometimes shows a patch of light rain on a dry night: it reads a little rain from
// thin cloud, and its newest hours are 1 to 3 hours old. So a satellite square at LIGHT level (and
// only light: moderate and above are unchanged) is drawn only when something backs it up. These
// are the numbers to tune.
export const LIGHT_CONFIRM_HOURS = 2 // light or more in this many of the satellite's 3 hours
export const LIGHT_CONFIRM_KM = 15 // a gauge this close that measured rain backs it up
export const LIGHT_VETO_KM = 10 // a gauge this close that measured none hides it
export const GAUGE_FRESH_MS = 90 * 60_000 // older gauge readings neither back up nor hide anything

const { nx, ny } = SATELLITE_GRID

// The up to 8 grid cells around one, none of them wrapping round an edge
export function neighbourIndexes(index: number): number[] {
  const row = Math.floor(index / nx)
  const col = index % nx
  const found: number[] = []
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      if (dr === 0 && dc === 0) continue
      const r = row + dr
      const c = col + dc
      if (r >= 0 && r < ny && c >= 0 && c < nx) found.push(r * nx + c)
    }
  }
  return found
}

// What the gauge measured in its last 3 hours, in mm: the 3-hour total, or the last hour if the
// 3-hour number is missing. null means it said nothing, which is not the same as no rain.
function gaugeThreeHourMm(g: GaugeRain): number | null {
  const values = [g.mm3h, g.mm1h].filter((v): v is number => v !== null)
  return values.length === 0 ? null : Math.max(...values)
}

// True only when the gauge positively measured no rain: 0 for the 3 hours, and 0 for the last hour
// if it said that. A missing number is unknown and never counts as dry.
function measuredNone(g: GaugeRain): boolean {
  return g.mm3h === 0 && (g.mm1h === null || g.mm1h === 0)
}

const isFresh = (g: GaugeRain, now: number) => now - g.at <= GAUGE_FRESH_MS

export type LightVerdict = {
  show: boolean
  // Why: a gauge hid it, it lasted, it has light rain beside it, a gauge backs it up, or nothing does
  reason: 'vetoed' | 'lasted' | 'neighbour' | 'gauge' | 'alone'
}

// Whether a satellite square that reads light rain should be drawn. `lat` and `lng` are the square's
// middle. A fresh gauge that measured no rain close by wins over everything else.
export function lightRainVerdict(
  index: number,
  lat: number,
  lng: number,
  satellite: SatelliteRain,
  gauges: GaugeRain[],
  now: number,
): LightVerdict {
  const near = gauges
    .filter((g) => isFresh(g, now))
    .map((g) => ({ g, km: kmFrom(g.lat, g.lng, [lat, lng]) }))

  if (near.some(({ g, km }) => km <= LIGHT_VETO_KM && measuredNone(g))) return { show: false, reason: 'vetoed' }

  if ((satellite.lightHours[index] ?? 0) >= LIGHT_CONFIRM_HOURS) return { show: true, reason: 'lasted' }

  if (neighbourIndexes(index).some((i) => (satellite.mm[i] ?? 0) >= LIGHT_MM)) return { show: true, reason: 'neighbour' }

  if (near.some(({ g, km }) => km <= LIGHT_CONFIRM_KM && (gaugeThreeHourMm(g) ?? 0) >= LIGHT_MM)) {
    return { show: true, reason: 'gauge' }
  }
  return { show: false, reason: 'alone' }
}
