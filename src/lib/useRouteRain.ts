import { useQuery, type UseQueryResult } from '@tanstack/react-query'
import { FORECAST_MAX_AGE_MS } from './forecastAge'
import { shouldRetry } from './openMeteoLimit'
import { fetchRouteForecast, routeRainFrom, type RainResult } from './rainForecast'
import type { RouteResult } from './routing'
import { useWaiting } from './useWaiting'

const CACHE_MS = 30 * 60_000

// One request per checked route (the key changes with every check), kept for 30 minutes.
// It never refreshes by itself, because "leaving now" is the moment the route was checked.
// If it fails the panel offers a Try again button. A 429 isn't retried at all, and nothing
// asks again until the wait after it is over (see openMeteoLimit.ts). An answer more than
// 6 hours old (forecastAge.ts) is treated as unavailable, so a route panel left open all day
// doesn't go on showing it; Try again then asks afresh.
export function useRouteRain(route: RouteResult | null): UseQueryResult<RainResult> {
  const query = useQuery({
    queryKey: ['rain', route?.id],
    enabled: route !== null,
    queryFn: () => {
      if (!route) throw new Error('No route')
      return fetchRouteForecast(route)
    },
    // The warnings are worked out from the saved answer when drawn
    select: routeRainFrom,
    staleTime: CACHE_MS,
    gcTime: CACHE_MS,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    retry: shouldRetry,
    retryDelay: 2000,
  })

  // `from` is when the route was checked, which is when the forecast was fetched
  const expiresAt = query.data ? query.data.from + FORECAST_MAX_AGE_MS : null
  const notExpired = useWaiting(expiresAt)
  if (expiresAt === null || notExpired) return query

  // Looks like a failed load to the panel and the map, which is how it is already handled
  return { ...query, data: undefined, status: 'error', isError: true, isSuccess: false, isPending: false } as UseQueryResult<RainResult>
}
