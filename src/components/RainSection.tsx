import { CloudLightning, CloudRain } from 'lucide-react'
import type { UseQueryResult } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { t } from '../i18n'
import { GAUGE_RAIN_CREDIT, measuredText, SATELLITE_RAIN_CREDIT } from '../lib/rainMeasured'
import {
  RAIN_COLOR,
  RAIN_CREDIT_URL,
  forecastQuietText,
  possibleText,
  RAIN_LABEL,
  rainPlace,
  rainPlaceAt,
  type RainResult,
  type RainStretch,
} from '../lib/rainForecast'
import { satelliteStretchText, type RecentRain } from '../lib/routeRecentRain'
import { sriLankaClock } from '../lib/time'

function describe(s: RainStretch): string {
  return t(s.fromKm === s.toKm ? 'rain.section.stretch_point' : 'rain.section.stretch_range', {
    label: RAIN_LABEL[s.level],
    where: rainPlace(s),
    time: sriLankaClock(s.at),
  })
}

type Props = {
  rain: UseQueryResult<RainResult>
  // Tapping a stretch zooms the map to it and opens its card
  onSelect: (stretch: RainStretch) => void
  // Rain that has already fallen: the satellite's, and the gauges within 5 km of the route
  recent: RecentRain
}

// A warning that isn't tappable, in the same look as the river gauges above
function Item({ icon, color, children }: { icon: 'storm' | 'rain'; color: string | undefined; children: string }) {
  const Icon = icon === 'storm' ? CloudLightning : CloudRain
  return (
    <li className="flex min-h-12 items-center gap-3 rounded-xl border-2 border-slate-200 px-2 py-1">
      <Icon className="h-6 w-6 shrink-0" style={{ color }} aria-hidden="true" />
      <span className="text-sm text-slate-900">{children}</span>
    </li>
  )
}

// Uses the same look as the river section above it. The warnings come from three places
// (the forecast ahead, the satellite's recent rain and the gauges), and so do the quieter
// light and moderate lines, so the section tells one story that matches the map.
export default function RainSection({ rain, onSelect, recent }: Props) {
  const { t } = useTranslation()
  const stretches = rain.data?.stretches ?? []
  const forecastQuiet = rain.data?.mild ?? null
  const warnings = stretches.length + recent.satellite.length + recent.gauges.length
  // A guess, not a warning, so it's one quiet line. It isn't on the map, so it shows whenever the route crosses one.
  const forecastPossible = rain.data?.possible ?? null
  const quiet = (forecastQuiet ? 1 : 0) + (forecastPossible ? 1 : 0) + recent.quiet.length

  return (
    <div className="mt-3">
      <p className="text-sm font-semibold text-slate-900">{t('rain.section.title')}</p>

      {rain.isPending && <p className="mt-1 text-sm text-slate-600">{t('rain.section.checking')}</p>}
      {rain.isError && <p className="mt-1 text-sm text-slate-600">{t('rain.section.unavailable')}</p>}

      {/* Only said when every source looked and found less than light rain. If the measured
          rain couldn't be loaded, it's only the forecast that was checked. */}
      {rain.data && warnings === 0 && quiet === 0 && (
        <p className="mt-1 text-sm text-slate-800">
          {recent.checked ? t('rain.section.noneRecent') : t('rain.section.noneLikely')}
        </p>
      )}

      {warnings > 0 && (
        <ul className="mt-2 space-y-2">
          {stretches.map((s) => {
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
          {recent.satellite.map((s) => (
            <Item key={s.id} icon="rain" color={RAIN_COLOR[s.level]}>
              {satelliteStretchText(s)}
            </Item>
          ))}
          {recent.gauges.map(({ item, distanceAlongM }) => (
            <Item key={item.id} icon="rain" color={item.level ? RAIN_COLOR[item.level] : undefined}>
              {t('rain.section.gauge', {
                label: item.level ? RAIN_LABEL[item.level] : t('rain.label.plain'),
                where: rainPlaceAt(distanceAlongM / 1000, recent.routeKm),
                station: item.station,
                measured: measuredText(item, ', '),
              })}
            </Item>
          ))}
        </ul>
      )}

      {/* Warnings come first, these quieter lines go under them */}
      {forecastQuiet && (
        <p className="mt-2 text-sm text-slate-800">
          {forecastQuietText(forecastQuiet.level, forecastQuiet.where, forecastQuiet.probability)}
        </p>
      )}
      {forecastPossible && (
        <p className="mt-2 text-sm text-slate-800">
          {possibleText(forecastPossible.level, forecastPossible.where)}
        </p>
      )}
      {recent.quiet.map((line) => (
        <p key={line} className="mt-2 text-sm text-slate-800">
          {line}
        </p>
      ))}

      {rain.data && (
        <p className="mt-1 text-xs text-slate-600">
          {t('rain.section.checked', {
            context: rain.data.partial ? 'partial' : undefined,
            from: sriLankaClock(rain.data.from),
            to: sriLankaClock(rain.data.to),
          })}
        </p>
      )}
      {recent.checked && (
        <>
          <p className="mt-1 text-xs text-slate-500">{GAUGE_RAIN_CREDIT}</p>
          <p className="mt-1 text-xs text-slate-500">{SATELLITE_RAIN_CREDIT}</p>
        </>
      )}
      {rain.data && (
        <p className="mt-1 text-xs text-slate-500">
          {t('common.forecastNotOfficial')}. Weather data by{' '}
          <a href={RAIN_CREDIT_URL} target="_blank" rel="noopener noreferrer" className="whitespace-nowrap underline">
            Open-Meteo.com
          </a>
        </p>
      )}
    </div>
  )
}
