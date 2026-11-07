import { Fragment, useMemo, useState } from 'react'
import { CloudLightning, CloudRain } from 'lucide-react'
import type { LatLngTuple, LeafletMouseEvent } from 'leaflet'
import { Pane, Polygon, Polyline, Popup } from 'react-leaflet'
import { POPUP_PADDING } from '../lib/popupPadding'
import {
  MILD_BORDER,
  MILD_COLOR,
  MILD_LABEL,
  RAIN_COLOR,
  RAIN_CREDIT_URL,
  RAIN_LABEL,
  forecastWord,
} from '../lib/rainForecast'
import { formatMm, satelliteIndexAt, satelliteWhen, SATELLITE_GRID, SATELLITE_RAIN_CREDIT } from '../lib/rainMeasured'
import type { RainSquare } from '../lib/rainSquares'
import { sriLankaClock } from '../lib/time'
import { useRainSquares } from '../lib/useRainSquares'

type Props = {
  hidden: boolean
  // Heavy rain and thunderstorms always show. This adds light and moderate rain.
  showMild: boolean
}

const keyOf = (s: RainSquare) => s.level ?? s.mild ?? 'light'
const colorOf = (s: RainSquare) => (s.level ? RAIN_COLOR[s.level] : MILD_COLOR[s.mild ?? 'light'])
const labelOf = (s: RainSquare) => (s.level ? RAIN_LABEL[s.level] : MILD_LABEL[s.mild ?? 'light'])

const { nx } = SATELLITE_GRID

// All the squares of one kind of rain, drawn as a single shape
type Group = {
  key: string
  color: string
  border: string
  squares: RainSquare[]
}

function groupByKind(squares: RainSquare[]): Group[] {
  const groups = new Map<string, Group>()
  for (const square of squares) {
    const key = keyOf(square)
    let group = groups.get(key)
    if (!group) {
      group = { key, color: colorOf(square), border: square.level ? colorOf(square) : MILD_BORDER[square.mild ?? 'light'], squares: [] }
      groups.set(key, group)
    }
    group.squares.push(square)
  }
  return [...groups.values()]
}

// One ring per square. The squares never overlap, so they fill as one shape with no
// seams between them and no darker strips where edges meet.
const ring = (s: RainSquare): LatLngTuple[] => [
  [s.lat + s.halfLat, s.lng - s.halfLng],
  [s.lat + s.halfLat, s.lng + s.halfLng],
  [s.lat - s.halfLat, s.lng + s.halfLng],
  [s.lat - s.halfLat, s.lng - s.halfLng],
]

// The edges of a square that don't touch another square drawn in the same pane, so a
// border only runs round the outside of a patch of rain and never doubles up between neighbours
function outsideEdges(squares: RainSquare[], drawn: Set<number>): LatLngTuple[][] {
  const edges: LatLngTuple[][] = []
  for (const s of squares) {
    const index = satelliteIndexAt(s.lat, s.lng)
    if (index === null) continue
    const north: LatLngTuple[] = [[s.lat + s.halfLat, s.lng - s.halfLng], [s.lat + s.halfLat, s.lng + s.halfLng]]
    const south: LatLngTuple[] = [[s.lat - s.halfLat, s.lng - s.halfLng], [s.lat - s.halfLat, s.lng + s.halfLng]]
    const west: LatLngTuple[] = [[s.lat - s.halfLat, s.lng - s.halfLng], [s.lat + s.halfLat, s.lng - s.halfLng]]
    const east: LatLngTuple[] = [[s.lat - s.halfLat, s.lng + s.halfLng], [s.lat + s.halfLat, s.lng + s.halfLng]]
    if (!drawn.has(index - nx)) edges.push(north)
    if (!drawn.has(index + nx)) edges.push(south)
    if (index % nx === 0 || !drawn.has(index - 1)) edges.push(west)
    if (index % nx === nx - 1 || !drawn.has(index + 1)) edges.push(east)
  }
  return edges
}

type Selected = { square: RainSquare; at: LatLngTuple }

// The rain over the island as soft coloured squares on one 0.1 degree grid: what the
// satellite saw in the past 3 hours or what the forecast says is likely in the next 3,
// whichever is worse. The panes sit under the route line and all the markers, so rain
// never hides a report or a river. Each pane is faded as a whole, so nothing gets darker
// where shapes meet.
export default function RainMapOverlay({ hidden, showMild }: Props) {
  const squares = useRainSquares()
  const [selected, setSelected] = useState<Selected | null>(null)

  // Built only when the rain data or the switch changes, not each time a card opens
  const layers = useMemo(() => {
    const all = squares ?? []
    const warnings = all.filter((s) => s.level)
    const mild = showMild ? all.filter((s) => !s.level) : []
    const cellsOf = (list: RainSquare[]) => new Set(list.flatMap((s) => satelliteIndexAt(s.lat, s.lng) ?? []))
    const warningCells = cellsOf(warnings)
    const mildCells = cellsOf(mild)

    // For finding the square under a tap: the grid cell of the tap says which one
    const byCell = new Map<number, RainSquare>()
    for (const s of [...warnings, ...mild]) {
      const i = satelliteIndexAt(s.lat, s.lng)
      if (i !== null) byCell.set(i, s)
    }
    function pick(event: LeafletMouseEvent) {
      const i = satelliteIndexAt(event.latlng.lat, event.latlng.lng)
      const square = i === null ? undefined : byCell.get(i)
      if (square) setSelected({ square, at: [event.latlng.lat, event.latlng.lng] })
    }

    const draw = (groups: Group[], drawn: Set<number>, warning: boolean) =>
      groups.map((group) => (
        <Fragment key={group.key}>
          <Polygon
            positions={group.squares.map((s) => [ring(s)])}
            pathOptions={{ stroke: false, fillColor: group.color, fillOpacity: 1 }}
            eventHandlers={{ click: pick }}
          />
          <Polyline
            positions={outsideEdges(group.squares, drawn)}
            interactive={false}
            // Warnings get a rounded edge in their own colour, which softens the corners. The
            // quieter levels get a thin darker edge instead, so they can still be seen.
            pathOptions={
              warning
                ? { color: group.color, weight: 3, lineCap: 'round', lineJoin: 'round' }
                : { color: group.border, weight: 1.5, lineCap: 'round', lineJoin: 'round' }
            }
          />
        </Fragment>
      ))

    return {
      mild: draw(groupByKind(mild), mildCells, false),
      warning: draw(groupByKind(warnings), warningCells, true),
    }
  }, [squares, showMild])

  if (hidden || !squares) return null

  // The card goes away when it is the one that was open, so opening a second one
  // doesn't get closed by the first one's cleanup
  const mine = selected
  return (
    <>
      <Pane name="rain-mild" style={{ zIndex: 380, opacity: 0.5 }}>
        {layers.mild}
      </Pane>
      <Pane name="rain-warning" style={{ zIndex: 390, opacity: 0.5 }}>
        {layers.warning}
      </Pane>
      {mine && (
        // pane="popupPane": without it the card would go inside the faded rain pane
        <Popup
          key={`${mine.at[0]}-${mine.at[1]}`}
          position={mine.at}
          pane="popupPane"
          minWidth={220}
          {...POPUP_PADDING}
          eventHandlers={{ remove: () => setSelected((current) => (current === mine ? null : current)) }}
        >
          <RainSquareCard square={mine.square} />
        </Popup>
      )}
    </>
  )
}

function headline(square: RainSquare, now: number): string {
  const label = labelOf(square)
  if (square.source === 'satellite') return `${label} ${satelliteWhen(square, now)} (satellite)`
  const when =
    square.from <= now
      ? `until ${sriLankaClock(square.to)}`
      : `${sriLankaClock(square.from)} to ${sriLankaClock(square.to)}`
  // A forecast never says "expected": it says "likely" or "possible" by how sure the model is
  return `${label} ${forecastWord(square.probability)} ${when} (forecast)`
}

// Uses divs, not <p>, because Leaflet's popup CSS adds margins to paragraphs
function RainSquareCard({ square }: { square: RainSquare }) {
  const Icon = square.level === 'thunder' ? CloudLightning : CloudRain
  // Read once when the card opens, so the wording doesn't change under the reader
  const [now] = useState(Date.now)
  const satellite = square.source === 'satellite'
  // A light or moderate forecast. Its chance is for any rain somewhere in the square, so
  // "100% chance of rain" alone read as a promise for the exact spot.
  const mildForecast = !satellite && square.level === null
  return (
    <div>
      <div className="flex items-start gap-2">
        <Icon className="mt-0.5 h-5 w-5 shrink-0" style={{ color: colorOf(square) }} aria-hidden="true" />
        <span className="text-base font-semibold text-slate-900">{headline(square, now)}</span>
      </div>
      {square.probability !== null && (
        <div className="mt-2 text-sm text-slate-800">
          {Math.round(square.probability)}%{' '}
          {mildForecast ? 'chance of some rain in this area (about 11 km across)' : 'chance of rain'}
        </div>
      )}
      {mildForecast && (
        <div className="mt-1 text-xs text-slate-600">Rain forecasts are often wrong for a specific spot.</div>
      )}
      {square.mm !== null && (
        <div className="mt-1 text-sm text-slate-800">
          Up to {formatMm(square.mm)} mm an hour in the worst hour
        </div>
      )}
      <div className="mt-1 text-xs text-slate-600">
        {satellite
          ? `Satellite estimate for ${sriLankaClock(square.from)} to ${sriLankaClock(square.to)} (Sri Lanka time)`
          : 'Open-Meteo forecast, next 3 hours (Sri Lanka time)'}
      </div>
      {satellite && (
        <div className="mt-1 text-xs text-slate-600">Satellite estimates can read high in the dry zone.</div>
      )}
      <div className="mt-2 text-xs italic text-slate-600">
        {satellite ? 'Estimate from space, not an official warning' : 'Forecast, not an official warning'}
      </div>
      <div className="mt-1 text-[11px] leading-tight text-slate-500">
        {satellite ? (
          SATELLITE_RAIN_CREDIT
        ) : (
          <>
            Weather data by{' '}
            <a href={RAIN_CREDIT_URL} target="_blank" rel="noopener noreferrer" className="whitespace-nowrap underline">
              Open-Meteo.com
            </a>
          </>
        )}
      </div>
    </div>
  )
}
