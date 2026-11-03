import { useQuery } from '@tanstack/react-query'
import { isSerious } from './hazards'
import { REPORTS_KEY } from './queryKeys'
import { SRI_LANKA_LIMITS } from './mapBounds'
import { supabase } from './supabase'
import { REFRESH_MS, type Report } from './useReports'

const [[minLat, minLng], [maxLat, maxLng]] = SRI_LANKA_LIMITS

// The map only loads the reports in view, but the threats chip counts the whole island,
// so this asks for everything and keeps the serious ones.
export function useSeriousReports() {
  return useQuery({
    queryKey: [REPORTS_KEY, 'island'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('reports_in_view', {
        min_lng: minLng,
        min_lat: minLat,
        max_lng: maxLng,
        max_lat: maxLat,
      })
      if (error) throw error
      return (data as Report[]).filter((report) => isSerious(report.severity))
    },
    refetchInterval: REFRESH_MS,
  })
}
