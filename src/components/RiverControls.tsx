import { useEffect, useState } from 'react'
import { Droplet, Droplets, Info } from 'lucide-react'
import { latLngBounds, type Map as LeafletMap } from 'leaflet'
import {
  isAlertOrAbove,
  RIVER_CREDIT,
  STEP_COLOR,
  stepTextColor,
  worstStep,
  type RiverStep,
} from '../lib/riverGauges'
import { useRiverGauges } from '../lib/useRiverGauges'

type Props = {
  map: LeafletMap | null
  showAll: boolean
  onShowAllChange: (showAll: boolean) => void
}

// Shown in this order, with a plain-words meaning for each
const LEGEND: { step: RiverStep; meaning: string }[] = [
  { step: 'normal', meaning: 'Normal, below the alert level' },
  { step: 'alert', meaning: 'Alert' },
  { step: 'minor', meaning: 'Minor flood' },
  { step: 'major', meaning: 'Major flood' },
  { step: 'none', meaning: 'No official flood levels for this gauge' },
  { step: 'stale', meaning: 'Not reporting' },
]

export default function RiverControls({ map, showAll, onShowAllChange }: Props) {
  const { data, status } = useRiverGauges()
  const [legendOpen, setLegendOpen] = useState(false)

  // Any map card (river or hazard) opening closes the legend, so they don't overlap
  useEffect(() => {
    if (!map) return
    const close = () => setLegendOpen(false)
    map.on('popupopen', close)
    return () => {
      map.off('popupopen', close)
    }
  }, [map])

  const flooded = status === 'success' ? data.filter((g) => isAlertOrAbove(g.step)) : []
  const worst = worstStep(flooded)

  function showFlooded() {
    if (!map || flooded.length === 0) return
    map.fitBounds(latLngBounds(flooded.map((g) => [g.lat, g.lng])), { padding: [70, 70], maxZoom: 13 })
  }

  return (
    <div className="absolute right-4 top-[4.5rem] z-[1000] flex flex-col items-end gap-2">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => onShowAllChange(!showAll)}
          aria-pressed={showAll}
          className={`flex h-11 items-center gap-2 rounded-full px-4 text-sm font-semibold shadow-lg ${
            showAll ? 'bg-sky-600 text-white active:bg-sky-700' : 'bg-white text-slate-700 active:bg-slate-100'
          }`}
        >
          <Droplets className="h-5 w-5" aria-hidden="true" />
          Rivers
        </button>
        <button
          type="button"
          onClick={() => setLegendOpen((open) => !open)}
          aria-expanded={legendOpen}
          aria-label="What the river colours mean"
          className="flex h-11 w-11 items-center justify-center rounded-full bg-white text-slate-700 shadow-lg active:bg-slate-100"
        >
          <Info className="h-5 w-5" />
        </button>
      </div>

      {status === 'error' && (
        <p role="status" className="max-w-[14rem] rounded-lg bg-white/95 px-3 py-2 text-xs text-slate-700 shadow">
          River levels unavailable right now
        </p>
      )}

      {status === 'success' && worst && (
        <button
          type="button"
          onClick={showFlooded}
          className="rounded-full px-4 py-2 text-sm font-semibold shadow-lg"
          style={{ backgroundColor: STEP_COLOR[worst], color: stepTextColor(worst) }}
        >
          {flooded.length} {flooded.length === 1 ? 'river' : 'rivers'} at flood level
        </button>
      )}

      {status === 'success' && !worst && (
        <p className="rounded-full bg-white/90 px-3 py-1 text-xs text-slate-600 shadow">All rivers below alert</p>
      )}

      {legendOpen && (
        <div className="w-64 rounded-xl bg-white p-3 text-slate-800 shadow-lg">
          <p className="text-sm font-semibold">River gauge colours</p>
          <ul className="mt-2 space-y-1.5">
            {LEGEND.map(({ step, meaning }) => (
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
            those levels always show. The Rivers button adds all the others.
          </p>
          <p className="mt-2 text-[11px] leading-tight text-slate-500">{RIVER_CREDIT}</p>
        </div>
      )}
    </div>
  )
}
