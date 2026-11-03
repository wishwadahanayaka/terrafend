import { useQuery } from '@tanstack/react-query'
import { fetchRainMap } from './rainMap'

const HALF_HOUR_MS = 30 * 60_000

// One request for the whole island, kept for 30 minutes and refreshed every 30. A failed
// load gets one more try after a short pause. The map, the Layers panel and the threats
// chip all read this one query, so they never ask twice.
export function useRainMap() {
  return useQuery({
    queryKey: ['rain-map'],
    queryFn: fetchRainMap,
    staleTime: HALF_HOUR_MS,
    gcTime: HALF_HOUR_MS,
    refetchInterval: HALF_HOUR_MS,
    refetchOnWindowFocus: false,
    retry: 1,
    retryDelay: 2000,
  })
}
