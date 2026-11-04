import { OctagonX, Route as RouteIcon } from 'lucide-react'
import { difference } from '../lib/reroute'
import { formatKm, NO_REROUTE, type RouteResult } from '../lib/routing'
import { routeDuration } from '../lib/time'
import type { RouteHazard } from '../lib/useRoute'

type Props = {
  route: RouteResult
  alternative: RouteResult | null
  // Blocked reports on the route, and on the reroute once it has been checked
  blocked: RouteHazard[]
  altBlocked: RouteHazard[]
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
  onFind: (foundOn: RouteResult, blocked: RouteHazard[]) => void
  onUse: () => void
  onKeep: () => void
}

const roads = (n: number) => `${n} blocked ${n === 1 ? 'road' : 'roads'}`

const kmAlong = (h: RouteHazard) => `${(h.distance_along_m / 1000).toFixed(1)} km`

export default function RerouteSection(props: Props) {
  const { route, alternative, blocked, busy, error, outOfDate, onFind } = props
  const disabled = busy || outOfDate

  if (!alternative) {
    if (busy) {
      return (
        <p role="status" className="mt-3 rounded-xl bg-slate-100 px-3 py-2 text-sm text-slate-700">
          Finding another route…
        </p>
      )
    }
    if (error) {
      return (
        <div role="alert" className="mt-3 rounded-xl border-2 border-amber-200 bg-amber-50 px-3 py-2">
          <p className="text-sm text-amber-900">{error}</p>
          {/* "No other route" won't change on a retry, but a dropped connection might */}
          {error !== NO_REROUTE && (
            <button
              type="button"
              onClick={() => onFind(route, blocked)}
              disabled={disabled}
              className="mt-1 h-11 text-sm font-medium text-blue-700 disabled:text-slate-400"
            >
              Try again
            </button>
          )}
        </div>
      )
    }
    if (!props.showPrompt) return null
    return (
      <div className="mt-3 rounded-xl border-2 border-red-200 bg-red-50 px-3 py-3">
        <p className="flex items-start gap-2 text-base font-medium text-red-900">
          <OctagonX className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
          This route passes {roads(blocked.length)}. Find another route?
        </p>
        <button
          type="button"
          onClick={() => onFind(route, blocked)}
          disabled={disabled}
          className="mt-2 h-12 w-full rounded-xl bg-blue-600 text-base font-semibold text-white active:bg-blue-700 disabled:bg-slate-300 disabled:text-slate-500"
        >
          Find another route
        </button>
      </div>
    )
  }

  const { altBlocked, altStatus } = props
  return (
    <div className="mt-3 rounded-xl border-2 border-blue-200 bg-blue-50 px-3 py-3">
      <p className="flex items-start gap-2 text-sm text-slate-900">
        <RouteIcon className="mt-0.5 h-5 w-5 shrink-0 text-blue-700" aria-hidden="true" />
        <span>
          <span className="font-semibold">New route:</span> {formatKm(alternative.distance_m)} &middot;{' '}
          {routeDuration(alternative.duration_s)} (
          {difference((alternative.distance_m - route.distance_m) / 1000, 'km')},{' '}
          {difference((alternative.duration_s - route.duration_s) / 60, 'min')})
          {altStatus === 'success' && props.avoided > 0 && <> &middot; avoids {roads(props.avoided)}</>}
        </span>
      </p>
      <p className="mt-1 text-xs text-slate-600">The original route is the grey dashed line on the map.</p>

      {altStatus === 'pending' && <p className="mt-2 text-sm text-slate-700">Checking the new route for hazards…</p>}
      {altStatus === 'error' && <p className="mt-2 text-sm text-slate-700">Couldn’t check the new route for hazards.</p>}

      {altBlocked.length > 0 && (
        <div className="mt-2 rounded-lg bg-red-100 px-2 py-1.5 text-sm text-red-900">
          The new route passes {altBlocked.length === 1 ? 'a different blocked road' : roads(altBlocked.length)}, at{' '}
          {altBlocked.map(kmAlong).join(', ')}.
          {props.canRerouteAgain ? (
            <button
              type="button"
              onClick={() => onFind(alternative, altBlocked)}
              disabled={disabled}
              className="mt-1 block h-11 text-sm font-semibold text-blue-700 disabled:text-slate-400"
            >
              {busy
                ? 'Finding another route…'
                : `Find a route that avoids ${props.avoidTotal === 2 ? 'both' : `all ${props.avoidTotal}`}`}
            </button>
          ) : (
            ' Take care, or check Google Maps.'
          )}
        </div>
      )}

      {error && (
        <p role="alert" className="mt-2 rounded-lg bg-amber-100 px-2 py-1.5 text-sm text-amber-900">
          {error}
        </p>
      )}

      <div className="mt-3 grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={props.onUse}
          disabled={disabled}
          className="h-12 rounded-xl bg-blue-600 text-base font-semibold text-white active:bg-blue-700 disabled:bg-slate-300 disabled:text-slate-500"
        >
          Use this route
        </button>
        <button
          type="button"
          onClick={props.onKeep}
          disabled={busy}
          className="h-12 rounded-xl border-2 border-slate-300 bg-white text-base font-semibold text-slate-700 active:bg-slate-100 disabled:text-slate-400"
        >
          Keep original
        </button>
      </div>
    </div>
  )
}
