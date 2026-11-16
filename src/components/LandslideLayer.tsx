import { useEffect, useMemo, useState } from 'react'
import { Mountain } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { LatLngTuple } from 'leaflet'
import { Pane, Polygon, Popup, useMap } from 'react-leaflet'
import { areasToDraw, areaStyle, cardContent, isDrawnLevel, LEVEL_COLOR, MAP_ATTRIBUTION, type ActiveWarning, type Level } from '../lib/landslide'
import { placeAreas, type Drawn } from '../lib/landslideShapes'
import { POPUP_PADDING } from '../lib/popupPadding'
import { useLandslide, useLandslideShapes } from '../lib/useLandslide'

type Props = {
  // The Landslide warnings switch. It only adds Level 1 (Watch): Level 2 and 3 always show.
  enabled: boolean
  // True while the person is picking a spot for a report, when the map is kept clear
  hidden: boolean
  // "Emergency: 117" on the card opens the emergency numbers screen
  onOpenEmergency: () => void
  // Tells the map which levels are drawn (none: nothing is), so its small legend shows only those
  onShown: (levels: Level[]) => void
}

// Text that reads on each level's colour
const PILL_TEXT: Record<1 | 2 | 3, string> = { 1: '#422006', 2: '#431407', 3: '#ffffff' }

type Selected = { code: string; at: LatLngTuple }

// NBRO's landslide warning, drawn as the DS divisions it names: a light fill and an outline in the
// level's colour (the outline gets heavier with the level, and Level 1 is dashed). The pane sits
// under the rain squares (380 and 390) and every marker, so a warning never hides a report or a river.
// Like the other layers, the serious levels (Evacuate and Alert) always show while the warning is
// valid, and the switch only adds Watch. The outlines (136 KB gzipped) are only downloaded when there
// is something to draw: a valid Level 2 or 3 area, or a valid Level 1 area with the switch on.
export default function LandslideLayer({ enabled, hidden, onOpenEmergency, onShown }: Props) {
  const map = useMap()
  const { view } = useLandslide()
  const warning = view?.kind === 'active' ? view.warning : null
  const wanted = warning !== null && areasToDraw(warning.areas, enabled).length > 0
  const shapes = useLandslideShapes(wanted)
  const [selected, setSelected] = useState<Selected | null>(null)

  const placed = useMemo(() => (warning && shapes.data ? placeAreas(warning.areas, shapes.data) : null), [warning, shapes.data])
  const drawn = useMemo<Drawn[]>(
    () => (!hidden && placed ? placed.drawn.filter((d) => isDrawnLevel(d.area.level, enabled)) : []),
    [enabled, hidden, placed],
  )

  // Highest level first, as the legend lists them. The key keeps this from running on every redraw.
  const levelsKey = [...new Set(drawn.map((d) => d.area.level))].sort((a, b) => b - a).join('')
  useEffect(() => {
    onShown([...levelsKey].map(Number) as Level[])
    return () => onShown([])
  }, [levelsKey, onShown])

  // The boundaries' credit sits in the map's own corner while their areas are drawn
  useEffect(() => {
    if (drawn.length === 0) return
    map.attributionControl.addAttribution(MAP_ATTRIBUTION)
    return () => {
      map.attributionControl.removeAttribution(MAP_ATTRIBUTION)
    }
  }, [map, drawn.length])

  // Drawn lowest level first (placeAreas sorts them), so a heavier area is on top where two touch
  const polygons = useMemo(
    () =>
      drawn.map((d) => (
        <Polygon
          key={d.area.code}
          positions={d.positions}
          pathOptions={areaStyle(d.area.level)}
          eventHandlers={{
            click: (event) => setSelected({ code: d.area.code as string, at: [event.latlng.lat, event.latlng.lng] }),
          }}
        />
      )),
    [drawn],
  )

  // The card belongs to an area that is still drawn: when the warning ends or the switch goes off, it goes
  const mine = selected ? drawn.find((d) => d.area.code === selected.code) : undefined
  if (drawn.length === 0 || !warning) return null

  return (
    <>
      <Pane name="landslide-areas" style={{ zIndex: 370 }}>
        {polygons}
      </Pane>
      {mine && selected && (
        // pane="popupPane" so the card isn't inside the areas' pane
        <Popup
          key={mine.area.code}
          position={selected.at}
          pane="popupPane"
          minWidth={220}
          {...POPUP_PADDING}
          eventHandlers={{ remove: () => setSelected((current) => (current === selected ? null : current)) }}
        >
          <LandslideCard
            drawn={mine}
            warning={warning}
            onOpenEmergency={() => {
              map.closePopup()
              onOpenEmergency()
            }}
          />
        </Popup>
      )}
    </>
  )
}

// Uses divs, not <p>, because Leaflet's popup CSS adds margins to paragraphs
function LandslideCard({ drawn, warning, onOpenEmergency }: { drawn: Drawn; warning: ActiveWarning; onOpenEmergency: () => void }) {
  const { t } = useTranslation()
  const card = cardContent(drawn.area, warning, drawn.names)
  return (
    <div>
      <div className="flex items-start gap-2">
        <Mountain className="mt-0.5 h-5 w-5 shrink-0" style={{ color: LEVEL_COLOR[card.level] }} aria-hidden="true" />
        <span className="text-base font-semibold text-slate-900">{t('landslide.title')}</span>
      </div>
      <div className="mt-2">
        <span
          className="inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold"
          style={{ backgroundColor: LEVEL_COLOR[card.level], color: PILL_TEXT[card.level] }}
        >
          {card.levelText}
        </span>
      </div>
      <div className="mt-2 text-sm font-medium text-slate-900">{card.place}</div>
      {card.change && <div className="mt-1 text-sm text-slate-800">{card.change}</div>}
      <div className="mt-2 text-xs text-slate-700">{card.issued}</div>
      <div className="mt-0.5 text-sm font-medium text-slate-900">{card.validUntil}</div>
      <div className="mt-1 text-xs text-slate-600">{card.source}</div>
      {card.pdfUrl && (
        <a href={card.pdfUrl} target="_blank" rel="noopener noreferrer" className="mt-2 block text-sm font-medium text-blue-700 underline">
          {t('landslide.openPdf')}
        </a>
      )}
      <div className="mt-2 text-sm text-slate-900">
        {t('landslide.follow')}{' '}
        <button type="button" onClick={onOpenEmergency} className="font-semibold text-red-700 underline">
          {t('landslide.emergency')}
        </button>
      </div>
    </div>
  )
}
