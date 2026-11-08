import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { submitVote, VOTE_ERRORS, type Vote } from '../lib/reports'
import { REPORTS_KEY } from '../lib/queryKeys'
import { useOnline } from '../lib/useOnline'
import { MY_VOTE_KEY, useMyVote } from '../lib/useVotes'

const VOTE_KEYS: Record<Vote, string> = {
  still_there: 'vote.stillThere',
  gone: 'vote.gone',
}

export default function VoteSection({ reportId }: { reportId: string }) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const online = useOnline()
  const myVote = useMyVote(reportId)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function vote(choice: Vote) {
    setSending(true)
    setError(null)
    const result = await submitVote(reportId, choice)
    setSending(false)

    if (result === 'ok') {
      queryClient.setQueryData([MY_VOTE_KEY, reportId], choice)
    } else {
      setError(VOTE_ERRORS[result])
      // Pick up the vote we already have, or the report's new state
      if (result === 'already_voted') queryClient.invalidateQueries({ queryKey: [MY_VOTE_KEY, reportId] })
    }
    // Reloads the card's expiry time, and drops the marker if this vote cleared the report
    queryClient.invalidateQueries({ queryKey: [REPORTS_KEY] })
  }

  if (myVote.data) {
    return (
      <div className="mt-3 border-t border-slate-200 pt-3 text-sm text-slate-700">
        {t('vote.youVoted')} <span className="font-medium">{t(VOTE_KEYS[myVote.data])}</span>
      </div>
    )
  }

  return (
    <div className="mt-3 border-t border-slate-200 pt-3">
      <div className="mb-2 text-xs text-slate-500">{t('vote.question')}</div>
      <div className="grid grid-cols-2 gap-2">
        {(Object.keys(VOTE_KEYS) as Vote[]).map((choice) => (
          <button
            key={choice}
            type="button"
            onClick={() => vote(choice)}
            disabled={sending || myVote.isPending || !online}
            className="h-11 rounded-lg border-2 border-slate-300 px-1 text-sm font-medium text-slate-800 active:bg-slate-100 disabled:opacity-50"
          >
            {t(VOTE_KEYS[choice])}
          </button>
        ))}
      </div>
      {!online && <div className="mt-2 rounded-lg bg-amber-50 px-2 py-1.5 text-xs text-amber-900">{t('offline.vote')}</div>}
      {error && (
        <div role="alert" className="mt-2 rounded-lg bg-red-50 px-2 py-1.5 text-xs text-red-700">
          {error}
        </div>
      )}
    </div>
  )
}
