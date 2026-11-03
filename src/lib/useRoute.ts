import { useQuery } from '@tanstack/react-query'
import { forDatabase, type RouteResult } from './routing'
import { supabase } from './supabase'
import { REPORTS_KEY } from './queryKeys'
import { REFRESH_MS, type Report } from './useReports'

export type RouteHazard = Report & {
  distance_along_m: number
  distance_from_route_m: number
}

const BUFFER_M = 150

// The key starts with 'reports', so anything that refreshes the map's reports
// (a new report, a vote) refreshes the hazards along the route too
export function useRouteHazards(route: RouteResult | null) {
  return useQuery({
    queryKey: [REPORTS_KEY, 'route', route?.id],
    enabled: route !== null,
    queryFn: async () => {
      if (!route) return []
      const { data, error } = await supabase.rpc('reports_along_route', {
        route: { type: 'LineString', coordinates: forDatabase(route.coordinates) },
        buffer_m: BUFFER_M,
      })
      if (error) throw error
      return data as RouteHazard[]
    },
    refetchInterval: REFRESH_MS,
  })
}
