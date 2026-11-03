import { useQuery } from '@tanstack/react-query'
import { fetchRain } from './rainForecast'
import type { RouteResult } from './routing'

const CACHE_MS = 30 * 60_000

// One request per checked route (the key changes with every check), kept for 30 minutes.
// It never refreshes by itself, because "leaving now" is the moment the route was checked.
export function useRouteRain(route: RouteResult | null) {
  return useQuery({
    queryKey: ['rain', route?.id],
    enabled: route !== null,
    queryFn: () => {
      if (!route) throw new Error('No route')
      return fetchRain(route)
    },
    staleTime: CACHE_MS,
    gcTime: CACHE_MS,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    retry: 1,
    retryDelay: 2000,
  })
}
