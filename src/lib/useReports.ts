import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { HazardType, Severity } from './hazards'
import { liveReports, reportsInBox } from './offline'
import { REPORTS_KEY } from './queryKeys'
import { supabase } from './supabase'

export type Bounds = {
  minLng: number
  minLat: number
  maxLng: number
  maxLat: number
}

export type Report = {
  id: string
  hazard_type: HazardType
  severity: Severity
  note: string | null
  lat: number
  lng: number
  created_at: string
  expires_at: string
  photo_path: string | null
}

// Reports expire after a few hours, so a minute is fresh enough
export const REFRESH_MS = 60_000

// Reports that ran out while the data was sitting there (offline, or saved) are left out
const stillActive = (reports: Report[]) => liveReports(reports, Date.now())

export function useReportsInView(bounds: Bounds) {
  const queryClient = useQueryClient()
  return useQuery({
    queryKey: [REPORTS_KEY, bounds],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('reports_in_view', {
        min_lng: bounds.minLng,
        min_lat: bounds.minLat,
        max_lng: bounds.maxLng,
        max_lat: bounds.maxLat,
      })
      if (error) throw error
      return data as Report[]
    },
    // Until this view has loaded (offline, that is always) the markers come from the
    // island-wide list, which is the one that is saved on the phone. If there is none,
    // the old markers stay on screen while the next area loads.
    placeholderData: (previous) =>
      reportsInBox(queryClient.getQueryData<Report[]>([REPORTS_KEY, 'island']), bounds) ?? previous,
    select: stillActive,
    refetchInterval: REFRESH_MS,
  })
}
