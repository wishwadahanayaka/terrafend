import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { landslideView, msUntilExpiry, type LandslideView } from './landslide'
import { landslideQueryOptions, loadLandslide } from './landslideFetch'
import { loadShapes } from './landslideShapes'
import { LANDSLIDE_KEY, LANDSLIDE_SHAPES_KEY } from './queryKeys'
import { useMinuteClock } from './useMinuteClock'
import { useOnline } from './useOnline'

export type LandslideStatus = 'pending' | 'success' | 'error'

// The newest landslide warning, as the app should show it at this moment. The chip, the Layers panel
// and the map layer share this one query.
// - view: null until there is an answer. Whether a warning is still valid is worked out here from its
//   valid_to and the clock, never from the server's flag, so an answer saved on the phone and shown
//   hours later (or offline) runs out on time. The clock ticks every minute and also at the moment
//   the warning ends.
// - status: 'error' means nothing has loaded and nothing is saved (or it is offline with nothing).
// - stale: there is an answer, but it could not be refreshed (offline, or the last refresh failed),
//   so the panel says when it was saved.
export function useLandslide(): { view: LandslideView | null; status: LandslideStatus; savedAt: number | null; stale: boolean } {
  const query = useQuery({ queryKey: [LANDSLIDE_KEY], queryFn: () => loadLandslide(), ...landslideQueryOptions })
  const online = useOnline()
  const minute = useMinuteClock()
  const [woken, setWoken] = useState(0)
  const answer = query.data
  const now = Math.max(minute, woken)

  useEffect(() => {
    const wait = msUntilExpiry(answer, Date.now())
    if (wait === null) return
    const timer = setTimeout(() => setWoken(Date.now()), wait + 50)
    return () => clearTimeout(timer)
  }, [answer])

  const view = useMemo(() => (answer ? landslideView(answer, now) : null), [answer, now])

  // Offline with nothing saved the query is only waiting, which would read as "loading" for ever
  const status: LandslideStatus = answer ? 'success' : query.isError || query.fetchStatus === 'paused' ? 'error' : 'pending'
  const stale = !!answer && (!online || query.errorUpdatedAt > query.dataUpdatedAt)
  return { view, status, savedAt: answer ? query.dataUpdatedAt : null, stale }
}

// The outlines of the DS divisions. Loaded only when `enabled`: the layer is on and the newest warning
// is valid. Kept for the rest of the session, and by the service worker for offline.
export function useLandslideShapes(enabled: boolean) {
  return useQuery({
    queryKey: [LANDSLIDE_SHAPES_KEY],
    queryFn: loadShapes,
    enabled,
    staleTime: Infinity,
    gcTime: Infinity,
    retry: 1,
    retryDelay: 3000,
  })
}
