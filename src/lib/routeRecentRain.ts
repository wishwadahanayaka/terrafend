import {
  MILD_LABEL,
  mildRain,
  rainLevel,
  rainPlaceAt,
  rainPlaceBetween,
  RAIN_LABEL,
  samplePoints,
  type MildLevel,
  type RainLevel,
} from './rainForecast'
import {
  gaugeWhen,
  satelliteIndexAt,
  satelliteWhen,
  type GaugeRain,
  type MeasuredRain,
} from './rainMeasured'
import { cumulativeMetres } from './routeGeometry'
import { nearRoute, type NearRoute } from './routeGauges'
import type { RouteResult } from './routing'
import { sriLankaClock } from './time'

// Gauges this close to the route count as being on it
const GAUGE_RANGE_M = 5000

// Heavy or worse rain the satellite saw along part of the route
export type SatelliteStretch = {
  id: string
  level: RainLevel
  fromKm: number
  toKm: number
  routeKm: number
  // "in the past 3 hours", or the clock times if the satellite's last hour is older
  when: string
}

// What measured rain says about a route: everything the satellite saw and the gauges
// near the road measured recently, apart from the forecast ahead
export type RecentRain = {
  routeKm: number
  // Heavy and worse, which count as warnings alongside the forecast ones
  satellite: SatelliteStretch[]
  gauges: NearRoute<GaugeRain>[]
  // Light and moderate rain, one plain line each, like "Light rain fell along much of
  // the route in the past 3 hours". Never counted as warnings.
  quiet: string[]
  // True once the measured rain has loaded, so "nothing recently measured" can be said
  checked: boolean
}

export const NO_RECENT_RAIN: RecentRain = { routeKm: 0, satellite: [], gauges: [], quiet: [], checked: false }

type Reading = { km: number; level: RainLevel | null; mild: MildLevel | null; mm: number } | null

const MILD_RANK: Record<MildLevel, number> = { light: 1, moderate: 2 }

// Where the quieter rain was, in the simplest words that fit
function where(points: number[], samplesWithData: number, routeKm: number): string {
  const first = points[0]
  const last = points[points.length - 1]
  if (points.length / samplesWithData >= 0.6) return 'along much of the route'
  // A gauge stands for the ground around it, so one or a few close together read as a place
  if (last - first <= 20) return first === last ? rainPlaceAt(first, routeKm) : rainPlaceBetween(first, last, routeKm)
  return 'in places along the route'
}

// The points along the route are the same ones the forecast uses (about every 10 km),
// each looked up in the satellite's grid cell
export function recentRainAlongRoute(route: RouteResult, measured: MeasuredRain | null, now: number): RecentRain {
  const along = cumulativeMetres(route.coordinates)
  const routeKm = along[along.length - 1] / 1000
  if (!measured) return { ...NO_RECENT_RAIN, routeKm }

  const quiet: string[] = []
  const satelliteStretches: SatelliteStretch[] = []

  const sat = measured.satellite
  if (sat) {
    const samples = samplePoints(route, now)
    const readings: Reading[] = samples.map((s) => {
      const index = satelliteIndexAt(s.lat, s.lng)
      const mm = index === null ? null : sat.mm[index]
      if (mm === null) return null
      const level = rainLevel(mm, null)
      return { km: s.km, level, mild: level ? null : mildRain(mm), mm }
    })
    const when = satelliteWhen(sat, now)

    // Neighbouring points at the same level become one stretch
    let open: SatelliteStretch | null = null
    for (const reading of readings) {
      if (!reading?.level) {
        open = null
      } else if (open && open.level === reading.level) {
        open.toKm = reading.km
      } else {
        open = {
          id: `sat-${reading.level}-${Math.round(reading.km)}`,
          level: reading.level,
          fromKm: reading.km,
          toKm: reading.km,
          routeKm,
          when,
        }
        satelliteStretches.push(open)
      }
    }

    // The quieter rain: the heaviest of it, and where
    const mildReadings = readings.filter((r) => r?.mild) as NonNullable<Reading>[]
    if (mildReadings.length > 0) {
      const top = mildReadings.reduce((a, b) => (MILD_RANK[b.mild as MildLevel] > MILD_RANK[a.mild as MildLevel] ? b : a))
      const level = top.mild as MildLevel
      const points = mildReadings.filter((r) => r.mild === level).map((r) => r.km)
      quiet.push(`${MILD_LABEL[level]} fell ${where(points, samples.length, routeKm)} ${when}`)
    }
  }

  const near = nearRoute(
    route.coordinates,
    measured.gauges.filter((g) => g.level || g.mild),
    GAUGE_RANGE_M,
  ).map((n) => ({ ...n, km: n.distanceAlongM / 1000 }))

  const heavy = near.filter((n) => n.item.level)
  const mildGauges = near.filter((n) => !n.item.level && n.item.mild)
  if (mildGauges.length > 0) {
    const top = mildGauges.reduce((a, b) => (b.item.rate > a.item.rate ? b : a))
    const level = top.item.mild as MildLevel
    const sameLevel = mildGauges.filter((n) => n.item.mild === level)
    // The reading's own age is said when it isn't recent, since "the past 3 hours" counts back from it
    const stale = now - top.item.at > 90 * 60_000 ? ` (reading from ${sriLankaClock(top.item.at)})` : ''
    quiet.push(
      `${MILD_LABEL[level]} measured ${where(
        sameLevel.map((n) => n.km),
        // Gauges are scattered, so "much of the route" would overstate them
        Infinity,
        routeKm,
      )} ${gaugeWhen(top.item)}${stale}`,
    )
  }

  return {
    routeKm,
    satellite: satelliteStretches,
    gauges: heavy.map(({ item, distanceAlongM, distanceFromRouteM }) => ({ item, distanceAlongM, distanceFromRouteM })),
    quiet,
    checked: true,
  }
}

export function satelliteStretchText(s: SatelliteStretch): string {
  const place = s.fromKm === s.toKm ? rainPlaceAt(s.fromKm, s.routeKm) : rainPlaceBetween(s.fromKm, s.toKm, s.routeKm)
  return `${RAIN_LABEL[s.level]} fell ${place} ${s.when} (satellite)`
}
