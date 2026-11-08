import { useQuery } from '@tanstack/react-query'
import { updateMyReports } from './myReports'
import { reportStatus, sortMyReports, syncMyReports, type MyReportRow } from './myReportsList'
import { MY_REPORTS_KEY } from './queryKeys'
import { ensureAnonymousSession } from './session'
import { supabase } from './supabase'

const usingFake = () => import.meta.env.DEV && new URLSearchParams(window.location.search).has('fakeMyReports')

async function fetchMyReports(): Promise<MyReportRow[]> {
  // Dev only: ?fakeMyReports=1 (see fakeMyReports.ts)
  if (usingFake()) return (await import('./fakeMyReports')).fakeMyReportRows()

  await ensureAnonymousSession()
  const { data, error } = await supabase.rpc('my_reports')
  if (error) throw error
  const rows = data as MyReportRow[]
  // The database knows which reports are this browser's, so the list kept on the phone for
  // the map is brought in line with it
  const now = Date.now()
  updateMyReports((list) => syncMyReports(list, rows, now), now)
  return rows
}

// Active ones first, each with whether it is still active as of now (see sortMyReports)
export type MyReportItem = { row: MyReportRow; active: boolean }

function toItems(rows: MyReportRow[]): MyReportItem[] {
  const now = Date.now()
  return sortMyReports(rows, now).map((row) => ({ row, active: reportStatus(row, now) === 'active' }))
}

// Only asked for while the panel is open. A load that fails isn't retried on its own more
// than once, and the panel has a Try again button.
export function useMyReports(enabled: boolean) {
  return useQuery({
    queryKey: [MY_REPORTS_KEY],
    queryFn: fetchMyReports,
    enabled,
    select: toItems,
    retry: 1,
    gcTime: 60_000,
  })
}
