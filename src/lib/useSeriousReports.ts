import { useQuery } from '@tanstack/react-query'
import { isSerious } from './hazards'
import { liveReports, SAVED_MAX_AGE_MS } from './offline'
import { REPORTS_KEY } from './queryKeys'
import { SRI_LANKA_LIMITS } from './mapBounds'
import { supabase } from './supabase'
import { REFRESH_MS, type Report } from './useReports'

const [[minLat, minLng], [maxLat, maxLng]] = SRI_LANKA_LIMITS

const seriousOnly = (all: Report[]) => liveReports(all, Date.now()).filter((report) => isSerious(report.severity))

// The map only loads the reports in view, but the threats chip counts the whole island,
// so this asks for everything and keeps the serious ones. The whole list is what gets
// saved on the phone, so the map can show reports offline too (see useReportsInView).
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
      return data as Report[]
    },
    select: seriousOnly,
    gcTime: SAVED_MAX_AGE_MS,
    refetchInterval: REFRESH_MS,
  })
}
