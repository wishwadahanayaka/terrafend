import { useQuery } from '@tanstack/react-query'
import { fetchMeasuredRain } from './rainMeasured'
import { WATER_LEVELS_QUERY } from './waterLevelsQuery'

// Gauge readings and satellite rain, from the same site as the river levels and on the
// same schedule. The map, the Layers panel, the chip and the route panel all share it.
export function useMeasuredRain(enabled = true) {
  return useQuery({
    queryKey: ['rain-measured'],
    queryFn: fetchMeasuredRain,
    enabled,
    ...WATER_LEVELS_QUERY,
  })
}
