import { keepPreviousData, useQuery } from '@tanstack/react-query'
import type { HazardType, Severity } from './hazards'
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
const REFRESH_MS = 60_000

export const REPORTS_KEY = 'reports'

export function useReportsInView(bounds: Bounds) {
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
    // Keeps the old markers on screen while the next area loads
    placeholderData: keepPreviousData,
    refetchInterval: REFRESH_MS,
  })
}
