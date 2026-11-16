import { useMemo } from 'react'
import { landslideOnRoute, wantsOutlines, type RouteLandslide } from './landslideRoute'
import type { RouteResult } from './routing'
import { useLandslide, useLandslideShapes } from './useLandslide'

// What NBRO's newest landslide warning means for a checked route. The warning is the one the map and
// the chip use (valid or not is worked out on the phone from valid_to), and so are the outlines: they
// are downloaded here only when a route is on screen and there is a valid warning with an area that can
// be checked, and kept for the rest of the session.
export function useRouteLandslide(route: RouteResult | null): RouteLandslide {
  const { view } = useLandslide()
  const wanted = wantsOutlines(view, route !== null)
  const shapes = useLandslideShapes(wanted)
  const line = route?.coordinates ?? null
  return useMemo(
    () => landslideOnRoute(view, line, { data: shapes.data, failed: shapes.isError }),
    [view, line, shapes.data, shapes.isError],
  )
}
