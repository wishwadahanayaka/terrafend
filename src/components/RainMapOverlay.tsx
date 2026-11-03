import { CloudLightning, CloudRain } from 'lucide-react'
import { Pane, Popup, Rectangle } from 'react-leaflet'
import { POPUP_PADDING } from '../lib/popupPadding'
import { HOUR_MS } from '../lib/openMeteo'
import {
  MILD_COLOR,
  MILD_LABEL,
  RAIN_COLOR,
  RAIN_CREDIT_URL,
  RAIN_LABEL,
  RAIN_RANK,
} from '../lib/rainForecast'
import type { RainCell } from '../lib/rainMap'
import { sriLankaClock } from '../lib/time'
import { useRainMap } from '../lib/useRainMap'

type Props = {
  hidden: boolean
  // Heavy rain and thunderstorms always show. This adds light and moderate rain.
  showMild: boolean
}

const colorOf = (cell: RainCell) => (cell.level ? RAIN_COLOR[cell.level] : MILD_COLOR[cell.mild ?? 'light'])

// Worst last, so it's drawn on top where the soft edges meet
const byWorst = (a: RainCell, b: RainCell) => (a.level ? RAIN_RANK[a.level] : 0) - (b.level ? RAIN_RANK[b.level] : 0)

// The next few hours of rain over the whole island, as soft coloured squares. The panes
// sit under the route line and all the markers, so rain never hides a report or a river.
// Each pane is faded as a whole (not each square), so squares that touch or overlap
// don't show seams or get darker where they meet.
export default function RainMapOverlay({ hidden, showMild }: Props) {
  const rain = useRainMap()

  // After a failed refresh the old forecast is hidden too, rather than shown as if current
  if (hidden || rain.status !== 'success') return null

  const warnings = rain.data.cells.filter((c) => c.level).sort(byWorst)
  const mild = showMild ? rain.data.cells.filter((c) => !c.level) : []

  return (
    <>
      <Pane name="rain-mild" style={{ zIndex: 380, opacity: 0.35 }}>
        {mild.map((cell) => (
          <RainSquare key={`${cell.lat}-${cell.lng}`} cell={cell} />
        ))}
      </Pane>
      <Pane name="rain-warning" style={{ zIndex: 390, opacity: 0.5 }}>
        {warnings.map((cell) => (
          <RainSquare key={`${cell.lat}-${cell.lng}`} cell={cell} />
        ))}
      </Pane>
    </>
  )
}

function RainSquare({ cell }: { cell: RainCell }) {
  const color = colorOf(cell)
  return (
    <Rectangle
      bounds={[
        [cell.lat - cell.halfLat, cell.lng - cell.halfLng],
        [cell.lat + cell.halfLat, cell.lng + cell.halfLng],
      ]}
      pathOptions={{
        color,
        fillColor: color,
        fillOpacity: 1,
        opacity: 1,
        // A same-coloured rounded edge closes the hairline gaps between squares
        // and takes the sharpness off the corners
        weight: 8,
        lineJoin: 'round',
      }}
    >
      {/* Without this the card would go inside the faded rain pane and be see-through */}
      <Popup pane="popupPane" minWidth={220} {...POPUP_PADDING}>
        <RainMapCard cell={cell} />
      </Popup>
    </Rectangle>
  )
}

// "now until 3:00 pm" for the hour that's under way, otherwise "2:00 pm to 3:00 pm"
function hourText(cell: RainCell): string {
  const end = sriLankaClock(cell.hourStart + HOUR_MS)
  return cell.hourStart <= Date.now() ? `now until ${end}` : `${sriLankaClock(cell.hourStart)} to ${end}`
}

// Uses divs, not <p>, because Leaflet's popup CSS adds margins to paragraphs
function RainMapCard({ cell }: { cell: RainCell }) {
  const Icon = cell.level === 'thunder' ? CloudLightning : CloudRain
  const label = cell.level ? RAIN_LABEL[cell.level] : MILD_LABEL[cell.mild ?? 'light']
  return (
    <div>
      <div className="flex items-center gap-2">
        <Icon className="h-5 w-5 shrink-0" style={{ color: colorOf(cell) }} aria-hidden="true" />
        <span className="text-base font-semibold text-slate-900">{label}</span>
      </div>
      <div className="mt-2 text-sm text-slate-800">Expected {hourText(cell)}</div>
      <div className="mt-1 text-xs text-slate-600">The heaviest of the next 3 hours (Sri Lanka time)</div>
      <div className="mt-2 text-xs italic text-slate-600">Forecast, not an official warning</div>
      <div className="mt-1 text-[11px] leading-tight text-slate-500">
        Weather data by{' '}
        <a href={RAIN_CREDIT_URL} target="_blank" rel="noopener noreferrer" className="whitespace-nowrap underline">
          Open-Meteo.com
        </a>
      </div>
    </div>
  )
}
