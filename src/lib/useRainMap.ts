import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { FORECAST_MAX_AGE_MS } from './forecastAge'
import { FORECAST_SAVED_MAX_AGE_MS } from './offline'
import { refreshDelay, shouldRetry } from './openMeteoLimit'
import { fetchForecastGrid, rainMapAt, rainMapState, type RainMapState } from './rainMap'
import { useHourClock } from './useHourClock'
import { useWaiting } from './useWaiting'

const HOUR_MS = 60 * 60_000
// The dev switch ?fakeForecast=429later refreshes every minute, so the failure shows quickly
const FAKE_REFRESH_MS = 60_000

function normalRefreshMs(): number {
  if (!import.meta.env.DEV) return HOUR_MS
  return globalThis.location?.search.includes('fakeForecast=429later') ? FAKE_REFRESH_MS : HOUR_MS
}

// One request for the whole island, kept for an hour and refreshed every hour. It brings the
// hourly numbers for today and tomorrow, and the "next 3 hours" are picked from them here, so
// a forecast that is a bit old is still right until it runs out of hours. If a refresh fails
// the old one stays on the map for as long as it still covers the next 3 hours (rainMapState).
// A 429 isn't retried: the next try comes once the wait is over (openMeteoLimit.ts). The map,
// the Layers panel and the threats chip all read this, and share the one request.
export function useRainMap(): RainMapState {
  const query = useQuery({
    queryKey: ['rain-map'],
    queryFn: fetchForecastGrid,
    staleTime: HOUR_MS,
    // Kept as long as a saved forecast is still of use, for showing when offline
    gcTime: FORECAST_SAVED_MAX_AGE_MS,
    refetchInterval: (q) => refreshDelay(q.state.error, Date.now(), normalRefreshMs()),
    refetchOnWindowFocus: false,
    retry: shouldRetry,
    retryDelay: 2000,
  })
  const now = useHourClock()
  const grid = query.data
  const map = useMemo(() => (grid ? rainMapAt(grid, now) : null), [grid, now])
  // The clock above only moves on the hour, so the 6-hour age limit has a timer of its own
  const expiresAt = grid ? grid.fetchedAt + FORECAST_MAX_AGE_MS : null
  const notExpired = useWaiting(expiresAt)
  return rainMapState(grid, expiresAt !== null && !notExpired ? null : map, query)
}
