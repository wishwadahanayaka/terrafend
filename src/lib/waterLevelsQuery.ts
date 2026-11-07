// The river levels and the measured rain both come from waterlevels.lk, a volunteer
// project. They share these settings so they refresh together and the site gets
// the same gentle pace from each: every 10 minutes at most, nothing when the tab
// comes back into focus, and one retry after a pause.
import { SAVED_MAX_AGE_MS } from './offline'

export const WATER_LEVELS_REFRESH_MS = 10 * 60_000
export const WATER_LEVELS_TIMEOUT_MS = 10_000

export const WATER_LEVELS_QUERY = {
  refetchInterval: WATER_LEVELS_REFRESH_MS,
  staleTime: WATER_LEVELS_REFRESH_MS / 2,
  // Kept as long as it is saved on the phone, so it is there to show when offline
  gcTime: SAVED_MAX_AGE_MS,
  refetchOnWindowFocus: false,
  retry: 1,
  retryDelay: 30_000,
} as const
