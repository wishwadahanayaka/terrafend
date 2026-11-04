import { GDACS_ROUTE_KM, insideRing, isSerious, type GdacsEvent } from './gdacs'
import { samplePoints } from './rainForecast'
import { metresBetween } from './routeGauges'
import type { RouteResult } from './routing'

export type RouteAlert = {
  event: GdacsEvent
  // Why it's on the list, in plain words
  why: string
}

// Orange and Red global alerts that matter to a checked route. An alert counts when the
// route passes inside a cyclone's forecast area, when GDACS says it affects Sri Lanka
// (a national flood, say, which concerns every route on the island), or when the route
// comes within 100 km of where an earthquake, volcano, wildfire or flood is. Droughts
// cover whole regions with no useful shape, so only "affects Sri Lanka" counts for them.
// The points checked are the ones along the route that the rain forecast uses.
export function gdacsAlongRoute(route: RouteResult, events: GdacsEvent[]): RouteAlert[] {
  const points = samplePoints(route, 0)
  if (points.length === 0) return []

  const found: (RouteAlert & { km: number })[] = []
  for (const event of events) {
    if (!isSerious(event.level)) continue

    const inside = event.track?.cone.some((ring) => points.some((p) => insideRing(p.lat, p.lng, ring)))
    const km =
      event.type === 'DR'
        ? Infinity
        : Math.min(...points.map((p) => metresBetween([p.lng, p.lat], [event.lng, event.lat]) / 1000))

    if (inside) found.push({ event, why: 'Your route passes through its forecast area', km })
    else if (event.affectsSriLanka) found.push({ event, why: 'It affects Sri Lanka', km })
    else if (km <= GDACS_ROUTE_KM) found.push({ event, why: `Your route passes ${Math.round(km)} km from it`, km })
  }

  // Red before Orange, then the closest first
  return found
    .sort((a, b) => Number(b.event.level === 'Red') - Number(a.event.level === 'Red') || a.km - b.km)
    .map(({ event, why }) => ({ event, why }))
}
