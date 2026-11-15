import { useTranslation } from 'react-i18next'
import { severityBg, severityLabel } from '../lib/hazards'
import type { SimilarReport } from '../lib/reports'
import { timeAgo } from '../lib/time'

type Props = {
  match: SimilarReport
  // Close the form and open My reports at this report
  onUpdate: () => void
  // "No, this is a different one": carry on with a new report
  onDifferent: () => void
}

// Shown in the report form instead of the usual question when the report nearby is one this
// browser sent. It can't be voted on (the database refuses), so the way forward is to change
// or remove it in My reports.
export default function OwnReportNotice({ match, onUpdate, onDifferent }: Props) {
  const { t } = useTranslation()
  const button = 'min-h-12 w-full rounded-xl border-2 px-3 py-2 text-left text-sm font-medium leading-tight'

  return (
    <div role="group" aria-label={t('report.dup.title')} className="mt-4 rounded-xl border-2 border-blue-200 bg-blue-50 p-3">
      <p className="text-base font-semibold text-slate-900">
        {t(`report.dup.own.${match.hazard_type}`, { ago: timeAgo(match.created_at) })}
      </p>
      <p className="mt-1 flex items-center gap-2 text-sm text-slate-700">
        {t('report.dup.current')}
        <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium text-white ${severityBg(match.severity)}`}>
          {severityLabel(match.severity)}
        </span>
      </p>

      <div className="mt-3 grid gap-2">
        <button
          type="button"
          onClick={onUpdate}
          className={`${button} border-blue-600 bg-blue-600 text-white active:bg-blue-700`}
        >
          {t('report.dup.ownUpdate')}
        </button>
        <button
          type="button"
          onClick={onDifferent}
          className={`${button} border-slate-300 bg-white text-slate-800 active:bg-slate-100`}
        >
          {t('report.dup.no')}
        </button>
      </div>
    </div>
  )
}
