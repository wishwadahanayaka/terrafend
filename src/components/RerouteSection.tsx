import { OctagonX, Route as RouteIcon } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { reportTotal } from '../lib/duplicates'
import { difference } from '../lib/reroute'
import { formatKm, NO_REROUTE, routeErrorText, type RouteResult } from '../lib/routing'
import { t } from '../i18n'
import { routeDuration } from '../lib/time'
import { useOnline } from '../lib/useOnline'
import type { RouteGroup } from '../lib/useRoute'

type Props = {
  route: RouteResult
  alternative: RouteResult | null
  // Blocked reports on the route, and on the reroute once it has been checked
  blocked: RouteGroup[]
  altBlocked: RouteGroup[]
  altStatus: 'pending' | 'error' | 'success'
  // How many of the blocked roads asked for the reroute avoids
  avoided: number
  // Blocked roads asked to be avoided so far, plus the new ones on the reroute
  avoidTotal: number
  canRerouteAgain: boolean
  showPrompt: boolean
  busy: boolean
  error: string | null
  outOfDate: boolean
  onFind: (foundOn: RouteResult, blocked: RouteGroup[]) => void
  onUse: () => void
  onKeep: () => void
}

const kmAlong = (h: RouteGroup) => t('units.km', { value: (h.distance_along_m / 1000).toFixed(1) })

export default function RerouteSection(props: Props) {
  const { route, alternative, blocked, busy, error, outOfDate, onFind } = props
  const { t } = useTranslation()
  const online = useOnline()
  const disabled = busy || outOfDate
  // Finding a route asks the routing service, so it can't be done offline
  const findDisabled = disabled || !online
  const offlineNote = !online && <p className="mt-2 text-xs text-slate-700">{t('offline.reroute')}</p>

  if (!alternative) {
    if (busy) {
      return (
        <p role="status" className="mt-3 rounded-xl bg-slate-100 px-3 py-2 text-sm text-slate-700">
          {t('reroute.finding')}
        </p>
      )
    }
    if (error) {
      return (
        <div role="alert" className="mt-3 rounded-xl border-2 border-amber-200 bg-amber-50 px-3 py-2">
          <p className="text-sm text-amber-900">{routeErrorText(error)}</p>
          {/* "No other route" won't change on a retry, but a dropped connection might */}
          {error !== NO_REROUTE && (
            <button
              type="button"
              onClick={() => onFind(route, blocked)}
              disabled={findDisabled}
              className="mt-1 h-11 text-sm font-medium text-blue-700 disabled:text-slate-400"
            >
              {t('common.tryAgain')}
            </button>
          )}
          {offlineNote}
        </div>
      )
    }
    if (!props.showPrompt) return null
    // "2 blocked roads (5 reports)" when several reports stand behind them
    const reports = reportTotal(blocked)
    return (
      <div className="mt-3 rounded-xl border-2 border-red-200 bg-red-50 px-3 py-3">
        <p className="flex items-start gap-2 text-base font-medium text-red-900">
          <OctagonX className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
          {reports > blocked.length
            ? t('reroute.promptReports', { count: blocked.length, reports: t('route.reports', { count: reports }) })
            : t('reroute.prompt', { count: blocked.length })}
        </p>
        <button
          type="button"
          onClick={() => onFind(route, blocked)}
          disabled={findDisabled}
          className="mt-2 h-12 w-full rounded-xl bg-blue-600 text-base font-semibold text-white active:bg-blue-700 disabled:bg-slate-300 disabled:text-slate-500"
        >
          {t('reroute.find')}
        </button>
        {offlineNote}
      </div>
    )
  }

  const { altBlocked, altStatus } = props
  return (
    <div className="mt-3 rounded-xl border-2 border-blue-200 bg-blue-50 px-3 py-3">
      <p className="flex items-start gap-2 text-sm text-slate-900">
        <RouteIcon className="mt-0.5 h-5 w-5 shrink-0 text-blue-700" aria-hidden="true" />
        <span>
          {t('reroute.newRoute', {
            distance: formatKm(alternative.distance_m),
            duration: routeDuration(alternative.duration_s),
            extraDistance: difference((alternative.distance_m - route.distance_m) / 1000, 'km'),
            extraTime: difference((alternative.duration_s - route.duration_s) / 60, 'min'),
          })}
          {altStatus === 'success' && props.avoided > 0 && <> &middot; {t('reroute.avoids', { count: props.avoided })}</>}
        </span>
      </p>
      <p className="mt-1 text-xs text-slate-600">{t('reroute.originalNote')}</p>

      {altStatus === 'pending' && <p className="mt-2 text-sm text-slate-700">{t('reroute.checkingNew')}</p>}
      {altStatus === 'error' && <p className="mt-2 text-sm text-slate-700">{t('reroute.checkError')}</p>}

      {altBlocked.length > 0 && (
        <div className="mt-2 rounded-lg bg-red-100 px-2 py-1.5 text-sm text-red-900">
          {t('reroute.different', { count: altBlocked.length, where: altBlocked.map(kmAlong).join(', ') })}
          {props.canRerouteAgain ? (
            <button
              type="button"
              onClick={() => onFind(alternative, altBlocked)}
              disabled={findDisabled}
              className="mt-1 block h-11 text-sm font-semibold text-blue-700 disabled:text-slate-400"
            >
              {busy
                ? t('reroute.finding')
                : props.avoidTotal === 2
                  ? t('reroute.avoidBoth')
                  : t('reroute.avoidAll', { count: props.avoidTotal })}
            </button>
          ) : (
 ` ${t('reroute.takeCare')}`
          )}
          {props.canRerouteAgain && offlineNote}
        </div>
      )}

      {error && (
        <p role="alert" className="mt-2 rounded-lg bg-amber-100 px-2 py-1.5 text-sm text-amber-900">
          {routeErrorText(error)}
        </p>
      )}

      <div className="mt-3 grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={props.onUse}
          disabled={disabled}
          className="h-12 rounded-xl bg-blue-600 text-base font-semibold text-white active:bg-blue-700 disabled:bg-slate-300 disabled:text-slate-500"
        >
          {t('reroute.use')}
        </button>
        <button
          type="button"
          onClick={props.onKeep}
          disabled={busy}
          className="h-12 rounded-xl border-2 border-slate-300 bg-white text-base font-semibold text-slate-700 active:bg-slate-100 disabled:text-slate-400"
        >
          {t('reroute.keep')}
        </button>
      </div>
    </div>
  )
}
