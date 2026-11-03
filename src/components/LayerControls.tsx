import { lazy, Suspense, useEffect, useState, type ReactNode } from 'react'
import { CloudRain, Droplet, Droplets, Globe, Info, Layers, Mountain, TriangleAlert } from 'lucide-react'
import type { Map as LeafletMap } from 'leaflet'
import type { LayerSettings } from '../lib/layerSettings'
import {
  MILD_COLOR,
  MILD_LABEL,
  RAIN_COLOR,
  RAIN_CREDIT_URL,
  RAIN_LABEL,
} from '../lib/rainForecast'
import { RIVER_CREDIT, STEP_COLOR, type RiverStep } from '../lib/riverGauges'
import { useRainMap } from '../lib/useRainMap'
import { useRiverGauges } from '../lib/useRiverGauges'

// Counts reports from Supabase, so it loads after the map like the other data code
const ThreatChip = lazy(() => import('./ThreatChip'))

type Props = {
  map: LeafletMap | null
  settings: LayerSettings
  onChange: (name: keyof LayerSettings, value: boolean) => void
}

// Shown in this order, with a plain-words meaning for each
const RIVER_LEGEND: { step: RiverStep; meaning: string }[] = [
  { step: 'normal', meaning: 'Normal, below the alert level' },
  { step: 'alert', meaning: 'Alert' },
  { step: 'minor', meaning: 'Minor flood' },
  { step: 'major', meaning: 'Major flood' },
  { step: 'none', meaning: 'No official flood levels for this gauge' },
  { step: 'stale', meaning: 'Not reporting' },
]

const RAIN_LEGEND: { color: string; meaning: string }[] = [
  { color: RAIN_COLOR.thunder, meaning: RAIN_LABEL.thunder },
  { color: RAIN_COLOR.veryHeavy, meaning: RAIN_LABEL.veryHeavy },
  { color: RAIN_COLOR.heavy, meaning: RAIN_LABEL.heavy },
  { color: MILD_COLOR.moderate, meaning: MILD_LABEL.moderate },
  { color: MILD_COLOR.light, meaning: MILD_LABEL.light },
]

type Open = 'none' | 'layers' | 'legend'

export default function LayerControls({ map, settings, onChange }: Props) {
  const { status: riverStatus } = useRiverGauges()
  const rain = useRainMap()
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

  const toggle = (which: Exclude<Open, 'none'>) => setOpen((current) => (current === which ? 'none' : which))

  return (
    <div className="absolute right-4 top-[4.5rem] z-[1000] flex flex-col items-end gap-2">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => toggle('layers')}
          aria-expanded={open === 'layers'}
          className={`flex h-11 items-center gap-2 rounded-full px-4 text-sm font-semibold shadow-lg ${
            open === 'layers' ? 'bg-sky-600 text-white active:bg-sky-700' : 'bg-white text-slate-700 active:bg-slate-100'
          }`}
        >
          <Layers className="h-5 w-5" aria-hidden="true" />
          Layers
        </button>
        <button
          type="button"
          onClick={() => toggle('legend')}
          aria-expanded={open === 'legend'}
          aria-label="What the colours mean"
          className="flex h-11 w-11 items-center justify-center rounded-full bg-white text-slate-700 shadow-lg active:bg-slate-100"
        >
          <Info className="h-5 w-5" />
        </button>
      </div>

      {riverStatus === 'error' && (
        <p role="status" className="max-w-[14rem] rounded-lg bg-white/95 px-3 py-2 text-xs text-slate-700 shadow">
          River levels unavailable right now
        </p>
      )}

      <Suspense fallback={null}>
        <ThreatChip map={map} />
      </Suspense>

      {open === 'layers' && (
        <div className="w-72 rounded-xl bg-white p-2 text-slate-800 shadow-lg">
          <Toggle
            icon={<TriangleAlert className="h-5 w-5" aria-hidden="true" />}
            label="Reports"
            hint="Blocked and restricted roads always show. Switch on to add passable ones."
            checked={settings.passableReports}
            onChange={(value) => onChange('passableReports', value)}
          />
          <Toggle
            icon={<Droplets className="h-5 w-5" aria-hidden="true" />}
            label="Rivers"
            hint="Gauges at Alert or above always show. Switch on to add the rest."
            checked={settings.normalRivers}
            onChange={(value) => onChange('normalRivers', value)}
          />
          <Toggle
            icon={<CloudRain className="h-5 w-5" aria-hidden="true" />}
            label="Rain"
            hint="Heavy rain and thunderstorms always show. Switch on to add light and moderate rain."
            checked={settings.mildRain}
            onChange={(value) => onChange('mildRain', value)}
          />
          {rain.status === 'error' && (
            <p role="status" className="mx-2 mb-1 rounded-lg bg-slate-100 px-3 py-2 text-xs text-slate-700">
              Rain forecast unavailable right now
            </p>
          )}

          <div className="mt-1 border-t border-slate-200 pt-1">
            <ComingSoon icon={<Globe className="h-5 w-5" aria-hidden="true" />} label="Global alerts" />
            <ComingSoon icon={<Mountain className="h-5 w-5" aria-hidden="true" />} label="Landslide warnings" />
          </div>
        </div>
      )}

      {open === 'legend' && (
        <div className="w-64 rounded-xl bg-white p-3 text-slate-800 shadow-lg">
          <p className="text-sm font-semibold">River gauge colours</p>
          <ul className="mt-2 space-y-1.5">
            {RIVER_LEGEND.map(({ step, meaning }) => (
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
                <span>{meaning}</span>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-xs text-slate-600">
            Alert, Minor flood and Major flood are the official steps set by the Department of Irrigation. Gauges at
            those levels always show. The Layers menu adds all the others.
          </p>
          <p className="mt-2 text-[11px] leading-tight text-slate-500">{RIVER_CREDIT}</p>

          <p className="mt-4 text-sm font-semibold">Rain forecast colours</p>
          <ul className="mt-2 space-y-1.5">
            {RAIN_LEGEND.map(({ color, meaning }) => (
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
            The worst rain expected in each area over the next 3 hours. Heavy rain, very heavy rain and thunderstorms
            always show. Moderate and light rain show when Rain is switched on in the Layers menu. A forecast, not an
            official warning.
          </p>
          <p className="mt-2 text-[11px] leading-tight text-slate-500">
            Weather data by{' '}
            <a href={RAIN_CREDIT_URL} target="_blank" rel="noopener noreferrer" className="whitespace-nowrap underline">
              Open-Meteo.com
            </a>
          </p>
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

function ComingSoon({ icon, label }: { icon: ReactNode; label: string }) {
  return (
    <div aria-disabled="true" className="flex min-h-12 items-center gap-3 px-2 py-2 text-slate-400">
      {icon}
      <span className="flex-1 text-sm font-semibold">{label}</span>
      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs">Coming soon</span>
    </div>
  )
}
