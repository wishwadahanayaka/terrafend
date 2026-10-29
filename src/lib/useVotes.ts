import { useQuery } from '@tanstack/react-query'
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
