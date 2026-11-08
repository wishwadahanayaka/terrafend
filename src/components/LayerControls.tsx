import { lazy, Suspense, useEffect, useState, type ReactNode } from 'react'
import { ClipboardList, CloudRain, Droplet, Droplets, Globe, Info, Languages, Layers, Mountain, TriangleAlert } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { Map as LeafletMap } from 'leaflet'
import type { LayerSettings } from '../lib/layerSettings'
import {
  FORECAST_MIN_PROBABILITY,
  THUNDER_MIN_MM,
  MILD_COLOR,
  MILD_LABEL,
  RAIN_COLOR,
  RAIN_CREDIT_URL,
  RAIN_LABEL,
} from '../lib/rainForecast'
import { LANGUAGES } from '../i18n/languages'
import { setLanguage } from '../i18n'
import { RIVER_CREDIT, STEP_COLOR, type RiverStep } from '../lib/riverGauges'
import { GAUGE_RAIN_CREDIT, SATELLITE_RAIN_CREDIT } from '../lib/rainMeasured'
import { GDACS_CREDIT, GDACS_LEVEL_COLOR, type GdacsLevel } from '../lib/gdacs'
import { useGdacsEvents } from '../lib/useGdacs'
import { useMeasuredRain } from '../lib/useMeasuredRain'
import { possibleNoteKey } from '../lib/rainMap'
import { useRainMap } from '../lib/useRainMap'
import { sriLankaWhen } from '../lib/time'
import { useRiverGauges } from '../lib/useRiverGauges'

// Counts reports from Supabase, so it loads after the map like the other data code
const ThreatChip = lazy(() => import('./ThreatChip'))
const ThreatList = lazy(() => import('./ThreatList'))

type Props = {
  map: LeafletMap | null
  settings: LayerSettings
  onChange: (name: keyof LayerSettings, value: boolean) => void
  // Opens the My reports panel
  onOpenMyReports: () => void
}

// Shown in this order, with a plain-words meaning for each
const RIVER_LEGEND: { step: RiverStep; key: string }[] = [
  { step: 'normal', key: 'legend.riverNormal' },
  { step: 'alert', key: 'legend.riverAlert' },
  { step: 'minor', key: 'legend.riverMinor' },
  { step: 'major', key: 'legend.riverMajor' },
  { step: 'none', key: 'legend.riverNone' },
  { step: 'stale', key: 'legend.riverStale' },
]

// The names are looked up when read, so build the list when drawing
const rainLegend = (): { color: string; meaning: string }[] => [
  { color: RAIN_COLOR.thunder, meaning: RAIN_LABEL.thunder },
  { color: RAIN_COLOR.veryHeavy, meaning: RAIN_LABEL.veryHeavy },
  { color: RAIN_COLOR.heavy, meaning: RAIN_LABEL.heavy },
  { color: MILD_COLOR.moderate, meaning: MILD_LABEL.moderate },
  { color: MILD_COLOR.light, meaning: MILD_LABEL.light },
]

const GDACS_LEGEND: { level: GdacsLevel; key: string }[] = [
  { level: 'Red', key: 'legend.alertRed' },
  { level: 'Orange', key: 'legend.alertOrange' },
  { level: 'Green', key: 'legend.alertGreen' },
]

type Open = 'none' | 'layers' | 'legend' | 'language'

export default function LayerControls({ map, settings, onChange, onOpenMyReports }: Props) {
  const { t, i18n } = useTranslation()
  const { status: riverStatus } = useRiverGauges()
  const rain = useRainMap()
  const measured = useMeasuredRain()
  const alerts = useGdacsEvents(settings.greenAlerts)

  // Forecast storms and heavy showers that don't pass the tests for a warning are not
  // drawn, because there are often dozens of them. They get this one line instead.
  const possibleKey = rain.status === 'success' ? possibleNoteKey(rain.data.cells) : null
  const possibleNote = possibleKey ? t(`layers.${possibleKey}`) : null
  const [open, setOpen] = useState<Open>('none')

  // A map card opening, or a tap on the map, closes the panel so it can't cover anything
  useEffect(() => {
    if (!map) return
    const close = () => setOpen('none')
    map.on('popupopen', close)
    map.on('click', close)
    return () => {
      map.off('popupopen', close)
      map.off('click', close)
    }
  }, [map])

  // Only one thing is open at a time on a small screen: opening a panel closes any map card
  // (opening a card closes the panel too, above)
  function show(which: Exclude<Open, 'none'>) {
    map?.closePopup()
    setOpen(which)
  }
  const toggle = (which: Exclude<Open, 'none'>) => (open === which ? setOpen('none') : show(which))

  return (
    <div className="absolute right-4 top-[calc(var(--banner-bottom,56px)+1rem)] z-[1000] flex flex-col items-end gap-2">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => toggle('language')}
          aria-expanded={open === 'language'}
          aria-label={t('language.button')}
          className={`flex h-11 min-w-11 items-center justify-center gap-1 rounded-full px-3 text-sm font-semibold shadow-lg ${
            open === 'language' ? 'bg-sky-600 text-white active:bg-sky-700' : 'bg-white text-slate-700 active:bg-slate-100'
          }`}
        >
          <Languages className="h-5 w-5 shrink-0" aria-hidden="true" />
          {LANGUAGES.find((l) => l.code === i18n.language)?.short ?? 'EN'}
        </button>
        <button
          type="button"
          onClick={() => toggle('layers')}
          aria-expanded={open === 'layers'}
          className={`flex h-11 items-center gap-2 rounded-full px-4 text-sm font-semibold shadow-lg max-[339px]:px-3 ${
            open === 'layers' ? 'bg-sky-600 text-white active:bg-sky-700' : 'bg-white text-slate-700 active:bg-slate-100'
          }`}
        >
          <Layers className="h-5 w-5 shrink-0" aria-hidden="true" />
          {/* On the very narrowest phones only the icon shows, so four buttons fit in the row */}
          <span className="max-[339px]:sr-only">{t('layers.button')}</span>
        </button>
        <button
          type="button"
          onClick={() => {
            map?.closePopup()
            setOpen('none')
            onOpenMyReports()
          }}
          aria-label={t('myReports.button')}
          title={t('myReports.button')}
          className="flex h-11 w-11 items-center justify-center rounded-full bg-white text-slate-700 shadow-lg active:bg-slate-100"
        >
          <ClipboardList className="h-5 w-5" aria-hidden="true" />
        </button>
        <button
          type="button"
          onClick={() => toggle('legend')}
          aria-expanded={open === 'legend'}
          aria-label={t('layers.legendLabel')}
          className="flex h-11 w-11 items-center justify-center rounded-full bg-white text-slate-700 shadow-lg active:bg-slate-100"
        >
          <Info className="h-5 w-5" />
        </button>
      </div>

      {riverStatus === 'error' && (
        <p role="status" className="max-w-[14rem] rounded-lg bg-white/95 px-3 py-2 text-xs text-slate-700 shadow">
          {t('layers.riversUnavailable')}
        </p>
      )}

      <Suspense fallback={null}>
        <ThreatChip map={map} onMore={() => show('layers')} />
      </Suspense>

      {open === 'language' && (
        <div role="menu" aria-label={t('language.menu')} className="w-56 rounded-xl bg-white p-1 text-slate-800 shadow-lg">
          {LANGUAGES.map(({ code, name }) => (
            <button
              key={code}
              type="button"
              role="menuitemradio"
              aria-checked={i18n.language === code}
              lang={code}
              onClick={() => {
                void setLanguage(code)
                setOpen('none')
              }}
              className={`flex min-h-12 w-full items-center justify-between rounded-lg px-3 py-2 text-left text-base active:bg-slate-100 ${
                i18n.language === code ? 'font-semibold text-sky-700' : ''
              }`}
            >
              {name}
              {i18n.language === code && <span aria-hidden="true">✓</span>}
            </button>
          ))}
        </div>
      )}

      {open === 'layers' && (
        <div className="max-h-[max(12rem,calc(100dvh-26.5rem-var(--banner-extra,0px)))] w-72 overflow-y-auto rounded-xl bg-white p-2 text-slate-800 shadow-lg">
          <Suspense fallback={null}>
            <ThreatList />
          </Suspense>
          <Toggle
            icon={<TriangleAlert className="h-5 w-5" aria-hidden="true" />}
            label={t('layers.reports')}
            hint={t('layers.reportsHint')}
            checked={settings.passableReports}
            onChange={(value) => onChange('passableReports', value)}
          />
          <Toggle
            icon={<Droplets className="h-5 w-5" aria-hidden="true" />}
            label={t('layers.rivers')}
            hint={t('layers.riversHint')}
            checked={settings.normalRivers}
            onChange={(value) => onChange('normalRivers', value)}
          />
          <Toggle
            icon={<CloudRain className="h-5 w-5" aria-hidden="true" />}
            label={t('layers.rain')}
            hint={t('layers.rainHint')}
            checked={settings.mildRain}
            onChange={(value) => onChange('mildRain', value)}
          />
          {possibleNote && (
            <p className="mx-2 mb-1 rounded-lg bg-slate-100 px-3 py-2 text-xs text-slate-700">{possibleNote}</p>
          )}
          {rain.status === 'error' && (
            <p role="status" className="mx-2 mb-1 rounded-lg bg-slate-100 px-3 py-2 text-xs text-slate-700">
              {t('layers.forecastUnavailable')}
            </p>
          )}
          {/* A refresh failed, but the older forecast still reaches the next 3 hours, so it stays on the map */}
          {rain.status === 'success' && rain.olderFrom !== null && (
            <p role="status" className="mx-2 mb-1 rounded-lg bg-slate-100 px-3 py-2 text-xs text-slate-700">
              {t('layers.forecastFrom', { when: sriLankaWhen(rain.olderFrom) })}
            </p>
          )}
          {/* The map carries on with the forecast alone, so this is only a quiet note */}
          {measured.status === 'error' && (
            <p role="status" className="mx-2 mb-1 rounded-lg bg-slate-100 px-3 py-2 text-xs text-slate-700">
              {t('layers.measuredUnavailable')}
            </p>
          )}

          <Toggle
            icon={<Globe className="h-5 w-5" aria-hidden="true" />}
            label={t('layers.globalAlerts')}
            hint={t('layers.globalAlertsHint')}
            checked={settings.greenAlerts}
            onChange={(value) => onChange('greenAlerts', value)}
          />
          {alerts.status === 'error' && (
            <p role="status" className="mx-2 mb-1 rounded-lg bg-slate-100 px-3 py-2 text-xs text-slate-700">
              {t('layers.alertsUnavailable')}
            </p>
          )}

          <div className="mt-1 border-t border-slate-200 pt-1">
            <ComingSoon icon={<Mountain className="h-5 w-5" aria-hidden="true" />} label={t('layers.landslides')} soon={t('layers.comingSoon')} />
          </div>
        </div>
      )}

      {open === 'legend' && (
        <div className="max-h-[max(12rem,calc(100dvh-26.5rem-var(--banner-extra,0px)))] w-64 overflow-y-auto rounded-xl bg-white p-3 text-slate-800 shadow-lg">
          <p className="text-sm font-semibold">{t('legend.riverTitle')}</p>
          <ul className="mt-2 space-y-1.5">
            {RIVER_LEGEND.map(({ step, key }) => (
              <li key={step} className="flex items-center gap-2 text-xs">
                <Droplet
                  className="h-5 w-5 shrink-0"
                  fill={STEP_COLOR[step]}
                  stroke="#ffffff"
                  strokeWidth={2}
                  // The same fading the map uses for gauges that aren't reporting
                  style={{ opacity: step === 'stale' ? 0.75 : 1, filter: 'drop-shadow(0 0 1px rgba(0,0,0,0.6))' }}
                  aria-hidden="true"
                />
                <span>{t(key)}</span>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-xs text-slate-600">{t('legend.riverNote')}</p>
          <p className="mt-2 text-[11px] leading-tight text-slate-500">{RIVER_CREDIT}</p>

          <p className="mt-4 text-sm font-semibold">{t('legend.rainTitle')}</p>
          <ul className="mt-2 space-y-1.5">
            {rainLegend().map(({ color, meaning }) => (
              <li key={meaning} className="flex items-center gap-2 text-xs">
                <span
                  className="h-4 w-5 shrink-0 rounded-md border border-black/10"
                  style={{ backgroundColor: color }}
                  aria-hidden="true"
                />
                <span>{meaning}</span>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-xs text-slate-600">
            {t('legend.rainNote', { chance: FORECAST_MIN_PROBABILITY, mm: THUNDER_MIN_MM })}
          </p>
          <p className="mt-2 text-[11px] leading-tight text-slate-500">{GAUGE_RAIN_CREDIT}</p>
          <p className="mt-1 text-[11px] leading-tight text-slate-500">{SATELLITE_RAIN_CREDIT}</p>
          <p className="mt-1 text-[11px] leading-tight text-slate-500">
            Forecast: weather data by{' '}
            <a href={RAIN_CREDIT_URL} target="_blank" rel="noopener noreferrer" className="whitespace-nowrap underline">
              Open-Meteo.com
            </a>
          </p>

          <p className="mt-4 text-sm font-semibold">{t('legend.alertsTitle')}</p>
          <ul className="mt-2 space-y-1.5">
            {GDACS_LEGEND.map(({ level, key }) => (
              <li key={level} className="flex items-center gap-2 text-xs">
                <span
                  className="ml-1 h-3.5 w-3.5 shrink-0 rotate-45 rounded-[3px] border border-white shadow"
                  style={{ backgroundColor: GDACS_LEVEL_COLOR[level] }}
                  aria-hidden="true"
                />
                <span className="ml-1">{t(key)}</span>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-xs text-slate-600">{t('legend.alertsNote')}</p>
          <p className="mt-2 text-[11px] leading-tight text-slate-500">{GDACS_CREDIT}</p>
        </div>
      )}
    </div>
  )
}

type ToggleProps = {
  icon: ReactNode
  label: string
  hint: string
  checked: boolean
  onChange: (value: boolean) => void
}

// The whole row is the button, so it's an easy target on a phone
function Toggle({ icon, label, hint, checked, onChange }: ToggleProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="flex min-h-14 w-full items-center gap-3 rounded-lg px-2 py-2 text-left active:bg-slate-100"
    >
      <span className="text-slate-600">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold text-slate-900">{label}</span>
        <span className="block text-xs leading-snug text-slate-600">{hint}</span>
      </span>
      <span
        className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${checked ? 'bg-sky-600' : 'bg-slate-300'}`}
        aria-hidden="true"
      >
        <span
          className={`absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${checked ? 'translate-x-5' : ''}`}
        />
      </span>
    </button>
  )
}

function ComingSoon({ icon, label, soon }: { icon: ReactNode; label: string; soon: string }) {
  return (
    <div aria-disabled="true" className="flex min-h-12 items-center gap-3 px-2 py-2 text-slate-400">
      {icon}
      <span className="flex-1 text-sm font-semibold">{label}</span>
      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs">{soon}</span>
    </div>
  )
}
