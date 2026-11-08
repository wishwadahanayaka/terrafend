import { useQuery } from '@tanstack/react-query'
import type { HazardType } from './hazards'
import { SIMILAR_KEY } from './queryKeys'
import { fetchSimilar } from './reports'

// Active reports of the chosen type within 100 m of the spot, nearest first. It only runs
// once a type is chosen. If it fails the form just carries on as before, so a slow or
// broken lookup never stops someone from reporting.
export function useSimilarReports(lat: number, lng: number, hazardType: HazardType | null) {
  return useQuery({
    queryKey: [SIMILAR_KEY, lat, lng, hazardType],
    enabled: hazardType !== null,
    queryFn: async () => {
      if (!hazardType) return []
      return fetchSimilar(lat, lng, hazardType)
    },
    retry: 1,
    gcTime: 60_000,
  })
}
