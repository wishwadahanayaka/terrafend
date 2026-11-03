import { useEffect, useRef } from 'react'
import { CloudLightning, CloudRain } from 'lucide-react'
import { Marker, Pane, Polyline, Popup } from 'react-leaflet'
import { divIcon, type DivIcon, type Marker as LeafletMarker } from 'leaflet'
import { iconToSvg } from '../lib/iconHtml'
import { POPUP_PADDING } from '../lib/popupPadding'
import {
  RAIN_COLOR,
  RAIN_CREDIT_URL,
  RAIN_LABEL,
  rainMiddle,
  rainPath,
  rainPlace,
  type RainLevel,
  type RainStretch,
} from '../lib/rainForecast'
import type { RouteResult } from '../lib/routing'
import { sriLankaClock } from '../lib/time'
import { usePopupFit } from '../lib/usePopupFit'
import { useRouteRain } from '../lib/useRouteRain'

const LEVELS: RainLevel[] = ['heavy', 'veryHeavy', 'thunder']

// Rounded squares, so they can't be mistaken for the round hazard markers or the river drops
const icons = new Map<RainLevel, DivIcon>()
for (const level of LEVELS) {
  const svg = iconToSvg(level === 'thunder' ? CloudLightning : CloudRain, { size: 22, strokeWidth: 2.25 })
  icons.set(
    level,
    divIcon({
      html: `<div style="width:38px;height:38px;display:flex;align-items:center;justify-content:center;border-radius:10px;border:2px solid #fff;background:${RAIN_COLOR[level]};color:#fff;box-shadow:0 2px 6px rgba(0,0,0,0.4)">${svg}</div>`,
      className: '',
      iconSize: [38, 38],
      iconAnchor: [19, 19],
      popupAnchor: [0, -22],
    }),
  )
}

type Props = {
  route: RouteResult
  hidden: boolean
  // The route's results no longer match the From and To boxes
  outOfDate: boolean
  // Asks for one stretch's card to open. The number makes a repeat tap count as new.
  openRequest: { id: string; n: number } | null
}

// The rain stretches drawn on the route, each with an icon at its middle. The forecast
// comes from the same query the route panel uses, so this adds no request.
export default function RainOverlay({ route, hidden, outOfDate, openRequest }: Props) {
  const rain = useRouteRain(route)
  const popupFit = usePopupFit()
  const markers = useRef(new Map<string, LeafletMarker>())

  useEffect(() => {
    if (openRequest) markers.current.get(openRequest.id)?.openPopup()
  }, [openRequest])

  if (hidden || !rain.data) return null
  const fade = outOfDate ? 0.35 : 1

  return (
    <>
      {/* Above the route line (the default overlay layer), below the markers */}
      <Pane name="rain" style={{ zIndex: 450 }}>
        {rain.data.stretches.map((s) => {
          const path = rainPath(route, s)
          return (
            <Polyline
              key={s.id}
              positions={path}
              interactive={false}
              // White underneath like the route line, and wider than it, so the colour stands out
              pathOptions={{ color: '#ffffff', weight: 15, opacity: 0.9 * fade, lineCap: 'butt' }}
            />
          )
        })}
        {rain.data.stretches.map((s) => (
          <Polyline
            key={`${s.id}-colour`}
            positions={rainPath(route, s)}
            interactive={false}
            pathOptions={{ color: RAIN_COLOR[s.level], weight: 10, opacity: fade, lineCap: 'butt' }}
          />
        ))}
      </Pane>

      {rain.data.stretches.map((s) => (
        <Marker
          key={s.id}
          ref={(marker) => {
            if (marker) markers.current.set(s.id, marker)
            else markers.current.delete(s.id)
          }}
          position={rainMiddle(route, s)}
          icon={icons.get(s.level)}
          alt={`${RAIN_LABEL[s.level]} ${rainPlace(s)}`}
          opacity={fade}
          // Hazard reports matter more, so they sit on top where the two overlap
          zIndexOffset={-500}
          eventHandlers={popupFit}
        >
          <Popup minWidth={220} {...POPUP_PADDING}>
            <RainCard stretch={s} />
          </Popup>
        </Marker>
      ))}
    </>
  )
}

// Uses divs, not <p>, because Leaflet's popup CSS adds margins to paragraphs
function RainCard({ stretch }: { stretch: RainStretch }) {
  const Icon = stretch.level === 'thunder' ? CloudLightning : CloudRain
  return (
    <div>
      <div className="flex items-center gap-2">
        <Icon className="h-5 w-5 shrink-0" style={{ color: RAIN_COLOR[stretch.level] }} aria-hidden="true" />
        <span className="text-base font-semibold text-slate-900">{RAIN_LABEL[stretch.level]}</span>
      </div>
      <div className="mt-2 text-sm text-slate-800">Likely {rainPlace(stretch)}</div>
      <div className="mt-1 text-sm text-slate-800">
        When you’d be there: about {sriLankaClock(stretch.at)}
      </div>
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
