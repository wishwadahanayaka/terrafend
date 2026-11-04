import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { fetchCoreAlerts, fetchGreenAlerts, type GdacsEvent } from './gdacs'

const REFRESH_MS = 15 * 60_000

// Both lists refresh every 15 minutes, with one retry after a short pause
const OPTIONS = {
  refetchInterval: REFRESH_MS,
  staleTime: REFRESH_MS / 2,
  refetchOnWindowFocus: false,
  retry: 1,
  retryDelay: 5000,
} as const

// The map, the Layers panel, the threats chip and the route panel all read this.
// Orange and Red events always load (the core list). The hundreds of Green ones only
// load while the Global alerts switch is on, so the other users of this hook share the
// one core request and never trigger the big one.
export function useGdacsEvents(includeGreen: boolean): {
  // null until the core list has loaded, and after it failed
  events: GdacsEvent[] | null
  status: 'pending' | 'success' | 'error'
} {
  const core = useQuery({ queryKey: ['gdacs', 'core'], queryFn: fetchCoreAlerts, ...OPTIONS })
  const green = useQuery({ queryKey: ['gdacs', 'green'], queryFn: fetchGreenAlerts, enabled: includeGreen, ...OPTIONS })

  const coreEvents = core.status === 'success' ? core.data : null
  const greenEvents = includeGreen && green.status === 'success' ? green.data : null

  // Kept as one array until the data changes, so what's worked out from it isn't redone every render
  const events = useMemo(() => {
    if (!coreEvents) return null
    const byId = new Map(coreEvents.map((e) => [e.id, e]))
    for (const e of greenEvents ?? []) byId.set(e.id, e)
    return [...byId.values()]
  }, [coreEvents, greenEvents])

  if (core.status !== 'success') return { events: null, status: core.status }
  // The Green list failing is still a failure the panel should mention, but the Orange
  // and Red events carry on
  return { events, status: includeGreen && green.status === 'error' ? 'error' : 'success' }
}
