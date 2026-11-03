import { CloudLightning, CloudRain } from 'lucide-react'
import type { UseQueryResult } from '@tanstack/react-query'
import {
  RAIN_COLOR,
  RAIN_CREDIT_URL,
  MILD_LABEL,
  RAIN_LABEL,
  rainPlace,
  type RainResult,
  type RainStretch,
} from '../lib/rainForecast'
import { sriLankaClock } from '../lib/time'

function describe(s: RainStretch): string {
  const at = sriLankaClock(s.at)
  const when = s.fromKm === s.toKm ? `about ${at}` : `when you’d be there, about ${at}`
  return `${RAIN_LABEL[s.level]} likely ${rainPlace(s)} (${when})`
}

type Props = {
  rain: UseQueryResult<RainResult>
  // Tapping a stretch zooms the map to it and opens its card
  onSelect: (stretch: RainStretch) => void
}

// Uses the same look as the river section above it
export default function RainSection({ rain, onSelect }: Props) {
  return (
    <div className="mt-3">
      <p className="text-sm font-semibold text-slate-900">Rain along the route</p>

      {rain.isPending && <p className="mt-1 text-sm text-slate-600">Checking the rain forecast…</p>}
      {rain.isError && <p className="mt-1 text-sm text-slate-600">Rain forecast unavailable right now</p>}

      {rain.data && (
        <>
          {rain.data.stretches.length === 0 && !rain.data.mild && (
            <p className="mt-1 text-sm text-slate-800">No rain expected along the route</p>
          )}
          {rain.data.stretches.length > 0 && (
            <ul className="mt-2 space-y-2">
              {rain.data.stretches.map((s) => {
                const Icon = s.level === 'thunder' ? CloudLightning : CloudRain
                return (
                  <li key={s.id}>
                    <button
                      type="button"
                      onClick={() => onSelect(s)}
                      className="flex min-h-12 w-full items-center gap-3 rounded-xl border-2 border-slate-200 px-2 py-1 text-left active:bg-slate-100"
                    >
                      <Icon className="h-6 w-6 shrink-0" style={{ color: RAIN_COLOR[s.level] }} aria-hidden="true" />
                      <span className="text-sm text-slate-900">{describe(s)}</span>
                    </button>
                  </li>
                )
              })}
            </ul>
          )}

          {/* Warnings come first, this quieter line goes under them */}
          {rain.data.mild && (
            <p className="mt-2 text-sm text-slate-800">
              {MILD_LABEL[rain.data.mild.level]} likely {rain.data.mild.where}
            </p>
          )}

          <p className="mt-1 text-xs text-slate-600">
            Checked for {sriLankaClock(rain.data.from)} to {sriLankaClock(rain.data.to)} (Sri Lanka time)
            {rain.data.partial && '. The forecast doesn’t reach the end of the trip, so only the first part was checked'}
          </p>
          <p className="mt-1 text-xs text-slate-500">
            Forecast, not an official warning. Weather data by{' '}
            <a href={RAIN_CREDIT_URL} target="_blank" rel="noopener noreferrer" className="whitespace-nowrap underline">
              Open-Meteo.com
            </a>
          </p>
        </>
      )}
    </div>
  )
}
