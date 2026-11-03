import { useQuery } from '@tanstack/react-query'
import { parseGauges, RIVER_API_URL, type FloodMark, type RiverGauge } from './riverGauges'

const REFRESH_MS = 10 * 60_000
const FETCH_TIMEOUT_MS = 10_000

async function fetchGauges(): Promise<RiverGauge[]> {
  const res = await fetch(RIVER_API_URL, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })
  if (!res.ok) throw new Error(`River levels: HTTP ${res.status}`)
  const gauges = parseGauges(await res.json())
  return import.meta.env.DEV ? withTestLevels(gauges) : gauges
}

// For testing only. In the dev server, ?fakeRiver=<gauge id>:<alert|minor|major>,...
// raises those gauges to that step, so the alert styling can be seen on a dry day.
// The real forecast is dropped for them, since it was made for the real level.
// import.meta.env.DEV is false in the production build, so this is removed there.
function withTestLevels(gauges: RiverGauge[]): RiverGauge[] {
  const spec = new URLSearchParams(window.location.search).get('fakeRiver')
  if (!spec) return gauges
  const wanted = new Map(spec.split(',').map((part) => part.split(':') as [string, string]))
  return gauges.map((g) => {
    const step = wanted.get(g.id) as FloodMark | undefined
    if (!step || !g.marks || !(step in g.marks)) return g
    return { ...g, step, note: null, level: g.marks[step] + 0.3, forecast: null }
  })
}

// Their server is a volunteer project, so: one request every 10 minutes at most,
// none when the tab comes back into focus, and one retry after a pause.
export function useRiverGauges(enabled = true) {
  return useQuery({
    queryKey: ['river-gauges'],
    queryFn: fetchGauges,
    enabled,
    refetchInterval: REFRESH_MS,
    staleTime: REFRESH_MS / 2,
    refetchOnWindowFocus: false,
    retry: 1,
    retryDelay: 30_000,
  })
}
