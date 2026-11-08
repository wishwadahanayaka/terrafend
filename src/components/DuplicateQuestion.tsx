import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { severityChoices } from '../lib/duplicates'
import { severityBg, severityLabel, type Severity } from '../lib/hazards'
import { REPORTS_KEY, SIMILAR_KEY } from '../lib/queryKeys'
import { confirmAndChange, confirmExisting, type DuplicateOutcome, type SimilarReport } from '../lib/reports'
import { timeAgo } from '../lib/time'
import { MY_VOTE_KEY, useMyVote } from '../lib/useVotes'

export type Confirmed = { kind: 'confirmed' } | { kind: 'updated'; severity: Severity }

type Props = {
  match: SimilarReport
  online: boolean
  // "No, this is a different one": carry on with a new report
  onDifferent: () => void
  // The vote (and the new severity, if any) went through, so no new report is needed
  onConfirmed: (what: Confirmed) => void
}

// Shown in the report form when an active report of the same type is within 100 m. Asking
// first keeps one fallen tree from turning into five pins, and every extra "still there"
// keeps the real report alive and makes it more believable.
export default function DuplicateQuestion({ match, online, onDifferent, onConfirmed }: Props) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const myVote = useMyVote(match.id)
  const [sending, setSending] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const busy = sending !== null
  // Someone who said "gone" can't turn around and say it is worse
  const saidGone = myVote.data === 'gone'
  const alreadyVoted = myVote.data != null

  async function run(which: string, send: () => Promise<DuplicateOutcome>, result: Confirmed) {
    setSending(which)
    setError(null)
    const outcome = await send()
    setSending(null)

    // A vote may have counted even when the severity did not, so refresh either way
    queryClient.invalidateQueries({ queryKey: [REPORTS_KEY] })
    queryClient.invalidateQueries({ queryKey: [MY_VOTE_KEY, match.id] })
    if (outcome.done) {
      onConfirmed(result)
      return
    }
    setError(outcome.message)
    // The report ran out while the question was open: look again, there may be nothing to ask
    if (outcome.gone) queryClient.invalidateQueries({ queryKey: [SIMILAR_KEY] })
  }

  const button =
    'min-h-12 w-full rounded-xl border-2 px-3 py-2 text-left text-sm font-medium leading-tight disabled:opacity-50'

  return (
    <div role="group" aria-label={t('report.dup.title')} className="mt-4 rounded-xl border-2 border-blue-200 bg-blue-50 p-3">
      <p className="text-base font-semibold text-slate-900">{t(`report.dup.question.${match.hazard_type}`)}</p>
      <p className="mt-1 text-sm text-slate-700">
        {t('report.dup.details', {
          ago: timeAgo(match.created_at),
          distance: t('units.m', { value: Math.max(1, Math.round(match.distance_m)) }),
        })}
      </p>
      <p className="mt-1 flex items-center gap-2 text-sm text-slate-700">
        {t('report.dup.current')}
        <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium text-white ${severityBg(match.severity)}`}>
          {severityLabel(match.severity)}
        </span>
      </p>

      {alreadyVoted && (
        <p className="mt-2 rounded-lg bg-white px-2 py-1.5 text-sm text-slate-700">
          {t('report.dup.youVoted', { vote: t(myVote.data === 'gone' ? 'vote.gone' : 'vote.stillThere') })}
        </p>
      )}

      <div className="mt-3 grid gap-2">
        <button
          type="button"
          onClick={() => run('yes', () => confirmExisting(match.id), { kind: 'confirmed' })}
          disabled={busy || !online || alreadyVoted}
          className={`${button} border-blue-600 bg-blue-600 text-white active:bg-blue-700 disabled:border-slate-300 disabled:bg-slate-300 disabled:text-slate-500`}
        >
          {sending === 'yes' ? t('report.sending') : t('report.dup.yes')}
        </button>

        {severityChoices(match.severity).map(({ severity, direction }) => (
          <button
            key={severity}
            type="button"
            onClick={() => run(severity, () => confirmAndChange(match.id, severity), { kind: 'updated', severity })}
            disabled={busy || !online || saidGone}
            className={`${button} border-slate-300 bg-white text-slate-800 active:bg-slate-100`}
          >
            {sending === severity
              ? t('report.sending')
              : t(direction === 'worse' ? 'report.dup.worse' : 'report.dup.better', { severity: severityLabel(severity) })}
          </button>
        ))}

        <button
          type="button"
          onClick={onDifferent}
          disabled={busy}
          className={`${button} border-slate-300 bg-white text-slate-800 active:bg-slate-100`}
        >
          {t('report.dup.no')}
        </button>
      </div>

      {error && (
        <p role="alert" className="mt-2 rounded-lg bg-red-50 px-2 py-1.5 text-sm text-red-700">
          {error}
        </p>
      )}
    </div>
  )
}
