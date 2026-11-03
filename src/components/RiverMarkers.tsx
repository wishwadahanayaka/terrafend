import { Droplet } from 'lucide-react'
import { Marker, Popup } from 'react-leaflet'
import { divIcon, type DivIcon } from 'leaflet'
import { iconToSvg } from '../lib/iconHtml'
import { POPUP_PADDING } from '../lib/popupPadding'
import {
  CROSSING_LABEL,
  formatFt,
  isAlertOrAbove,
  RIVER_CREDIT,
  STEP_COLOR,
  STEP_LABEL,
  stepTextColor,
  type RiverGauge,
  type RiverStep,
} from '../lib/riverGauges'
import { sriLankaTime, timeAgo } from '../lib/time'
import { useRiverGauges } from '../lib/useRiverGauges'

// A small filled drop, so gauges can't be mistaken for the round hazard markers
const STEPS: RiverStep[] = ['normal', 'alert', 'minor', 'major', 'none', 'stale']
const dropIcons = new Map<RiverStep, DivIcon>()
for (const step of STEPS) {
  const svg = iconToSvg(Droplet, { size: 30, strokeWidth: 2, fill: STEP_COLOR[step], stroke: '#ffffff' })
  const fade = step === 'stale' ? 'opacity:0.75;' : ''
  dropIcons.set(
    step,
    divIcon({
      html: `<div style="width:36px;height:36px;display:flex;align-items:center;justify-content:center;filter:drop-shadow(0 1px 2px rgba(0,0,0,0.5));${fade}">${svg}</div>`,
      className: '',
      iconSize: [36, 36],
      iconAnchor: [18, 30],
      popupAnchor: [0, -28],
    }),
  )
}

// Gauges at Alert or above always show. The rest only show when the user asks for them.
export default function RiverMarkers({ showAll }: { showAll: boolean }) {
  const { data, status } = useRiverGauges()

  // After a failed refresh the old readings are hidden too, rather than shown as if current
  if (status !== 'success') return null

  const shown = data.filter((gauge) => showAll || isAlertOrAbove(gauge.step))

  return (
    <>
      {shown.map((gauge) => (
        <Marker
          key={gauge.id}
          position={[gauge.lat, gauge.lng]}
          icon={dropIcons.get(gauge.step)}
          alt={`${gauge.river} at ${gauge.station}: ${STEP_LABEL[gauge.step]}`}
          // Hazard reports matter more, so they sit on top where the two overlap
          zIndexOffset={-1000}
        >
          <Popup minWidth={230} {...POPUP_PADDING}>
            <RiverCard gauge={gauge} />
          </Popup>
        </Marker>
      ))}
    </>
  )
}

const DIRECTION_WORD = { rising: 'rising', falling: 'falling', steady: 'steady' } as const

// Uses divs, not <p>, because Leaflet's popup CSS adds margins to paragraphs
function RiverCard({ gauge }: { gauge: RiverGauge }) {
  const { step, level, marks, forecast } = gauge

  return (
    <div>
      <div className="text-base font-semibold text-slate-900">
        {gauge.river} at {gauge.station}
      </div>

      <span
        className="mt-2 inline-block rounded-full px-2.5 py-0.5 text-xs font-medium"
        style={{ backgroundColor: STEP_COLOR[step], color: stepTextColor(step) }}
      >
        {STEP_LABEL[step]}
      </span>
      {gauge.note && <span className="ml-2 text-xs text-slate-600">{gauge.note}</span>}

      {step === 'none' && (
        <div className="mt-2 text-sm text-slate-700">No official flood levels for this gauge</div>
      )}
      {step === 'stale' && <div className="mt-2 text-sm text-slate-700">Not reporting</div>}

      {step !== 'stale' && (
        <div className="mt-2 text-sm text-slate-800">
          Level: {level === null ? 'not available' : formatFt(level)}
        </div>
      )}

      {marks && (
        <div className="mt-1 text-xs text-slate-600">
          Alert {formatFt(marks.alert)} &middot; Minor flood {formatFt(marks.minor)} &middot; Major flood{' '}
          {formatFt(marks.major)}
        </div>
      )}

      {gauge.observedAt && (
        <div className="mt-1 text-xs text-slate-600">
          Reading: {sriLankaTime(gauge.observedAt)} &middot; {timeAgo(gauge.observedAt)}
        </div>
      )}

      {forecast && (
        <div className="mt-2 rounded-lg bg-slate-100 px-2 py-1.5 text-xs text-slate-700">
          <span className="font-medium">Next hour:</span> about {formatFt(forecast.levelFt)}
          {forecast.lowFt !== null && forecast.highFt !== null &&
            ` (${forecast.lowFt.toFixed(2)} to ${forecast.highFt.toFixed(2)})`}
          {forecast.direction && `, ${DIRECTION_WORD[forecast.direction]}`}
          {forecast.crossing && `. May reach the ${CROSSING_LABEL[forecast.crossing]} mark`}
          <div className="mt-0.5 italic">forecast, not an official warning</div>
        </div>
      )}

      {gauge.url && (
        <a
          href={gauge.url}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-2 block text-sm font-medium text-blue-700 underline"
        >
          More on Sri Lanka Water Levels
        </a>
      )}
      <div className="mt-2 text-[11px] leading-tight text-slate-500">{RIVER_CREDIT}</div>
    </div>
  )
}
