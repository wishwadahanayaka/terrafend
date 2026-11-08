import { useQuery } from '@tanstack/react-query'
import { REPORTS_KEY } from './queryKeys'
import type { Vote } from './reports'
import { ensureAnonymousSession } from './session'
import { supabase } from './supabase'

export const MY_VOTE_KEY = 'my-vote'

// RLS only lets a user read their own votes, so no user filter is needed.
// Only runs when a report card is open, one small request per report.
export function useMyVote(reportId: string) {
  return useQuery({
    queryKey: [MY_VOTE_KEY, reportId],
    queryFn: async () => {
      // A test report (?fakeNearby=) isn't in the database, so nobody has voted on it
      if (import.meta.env.DEV && reportId.startsWith('fake-')) return null
      await ensureAnonymousSession()
      const { data, error } = await supabase
        .from('report_votes')
        .select('vote')
        .eq('report_id', reportId)
        .maybeSingle()
      if (error) throw error
      return (data?.vote ?? null) as Vote | null
    },
  })
}

// How many people said "still there". The database function returns only the number, never
// who voted. Under the reports key, so a new vote refreshes it along with the reports.
// If the number can't be loaded the card simply leaves the line out.
export function useConfirmations(reportId: string) {
  return useQuery({
    queryKey: [REPORTS_KEY, 'confirmations', reportId],
    queryFn: async () => {
      // Test reports (?fakeReport=) aren't in the database
      if (import.meta.env.DEV && reportId.startsWith('fake-')) return 3
      const { data, error } = await supabase.rpc('report_confirmations', { p_report_id: reportId })
      if (error) throw error
      return data as number
    },
    retry: 1,
  })
}
