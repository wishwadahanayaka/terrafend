import { Marker, Pane, Polygon, Polyline, Popup } from 'react-leaflet'
import { useTranslation } from 'react-i18next'
import { divIcon, type DivIcon } from 'leaflet'
import { t } from '../i18n'
import { GDACS_ICON } from '../lib/gdacsIcons'
import {
  GDACS_CREDIT,
  GDACS_LEVEL_COLOR,
  GDACS_TYPE_LABEL,
  gdacsAlertLabel,
  gdacsDetails,
  isSerious,
  type GdacsEvent,
  type GdacsLevel,
  type GdacsType,
} from '../lib/gdacs'
import { iconToSvg } from '../lib/iconHtml'
import { POPUP_PADDING } from '../lib/popupPadding'
import { sriLankaTime, timeAgo } from '../lib/time'
import { usePopupFit } from '../lib/usePopupFit'
import { useGdacsEvents } from '../lib/useGdacs'

// A diamond with the type's icon in it, so global alerts can't be mistaken for the round
// hazard reports, the river drops or the square rain badges. Made once, when the file loads.
const TYPES = Object.keys(GDACS_TYPE_LABEL) as GdacsType[]
const LEVELS = Object.keys(GDACS_LEVEL_COLOR) as GdacsLevel[]

const icons = new Map<string, DivIcon>()
for (const type of TYPES) {
  const svg = iconToSvg(GDACS_ICON[type], { size: 20, strokeWidth: 2.25 })
  for (const level of LEVELS) {
    icons.set(
      `${type}:${level}`,
      divIcon({
        html: `<div style="width:46px;height:46px;display:flex;align-items:center;justify-content:center"><div style="width:34px;height:34px;transform:rotate(45deg);border-radius:7px;border:2px solid #fff;background:${GDACS_LEVEL_COLOR[level]};color:#fff;box-shadow:0 2px 6px rgba(0,0,0,0.4);display:flex;align-items:center;justify-content:center"><div style="transform:rotate(-45deg);display:flex">${svg}</div></div></div>`,
        className: '',
        iconSize: [46, 46],
        iconAnchor: [23, 23],
        popupAnchor: [0, -26],
      }),
    )
  }
}

type Props = {
  // Orange and Red always show. This adds Green.
  showGreen: boolean
}

// Global alerts from GDACS that concern Sri Lanka: a diamond for each, and for a cyclone
// its track and forecast area. Under the hazard reports, like the river drops. If the
// alerts can't be loaded there is simply nothing here.
export default function GdacsMarkers({ showGreen }: Props) {
  useTranslation() // redraws the marker names when the language changes
  const { events } = useGdacsEvents(showGreen)
  const popupFit = usePopupFit()
  if (!events) return null

  const shown = events.filter((e) => isSerious(e.level) || showGreen)

  return (
    <>
      {/* Above the rain squares (390), below the route line (400) */}
      <Pane name="gdacs-tracks" style={{ zIndex: 395 }}>
        {shown.map((e) => e.track && <Track key={e.id} event={e} />)}
      </Pane>

      {shown.map((event) => (
        <Marker
          key={event.id}
          position={[event.lat, event.lng]}
          icon={icons.get(`${event.type}:${event.level}`)}
          alt={t('gdacs.alt', { alert: gdacsAlertLabel(event.level), name: event.name })}
          eventHandlers={popupFit}
          // Hazard reports matter more, so they sit on top where the two overlap
          zIndexOffset={-600}
        >
          <Popup minWidth={230} {...POPUP_PADDING}>
            <GdacsCard event={event} />
          </Popup>
        </Marker>
      ))}
    </>
  )
}

// The forecast area under the track: past positions solid, forecast ones dashed.
// The area is mostly outline with only a faint tint, because it sits above the rain
// squares and a stronger fill muddied their colours.
function Track({ event }: { event: GdacsEvent }) {
  const color = GDACS_LEVEL_COLOR[event.level]
  return (
    <>
      {event.track?.cone.map((ring, i) => (
        <Polygon
          key={`cone-${i}`}
          positions={ring}
          interactive={false}
          pathOptions={{ color, weight: 2, opacity: 0.9, dashArray: '8 6', fillColor: color, fillOpacity: 0.04 }}
        />
      ))}
      {event.track?.lines.map((line, i) => (
        <Polyline
          key={`line-${i}`}
          positions={line.points}
          interactive={false}
          pathOptions={{ color, weight: 3, opacity: 0.9, dashArray: line.forecast ? '2 7' : undefined, lineCap: 'round' }}
        />
      ))}
    </>
  )
}

// Uses divs, not <p>, because Leaflet's popup CSS adds margins to paragraphs
function GdacsCard({ event }: { event: GdacsEvent }) {
  const { t } = useTranslation()
  const Icon = GDACS_ICON[event.type]
  const color = GDACS_LEVEL_COLOR[event.level]
  const happened = event.type === 'EQ' || event.type === 'VO'
  return (
    <div>
      <div className="flex items-start gap-2">
        <Icon className="mt-0.5 h-5 w-5 shrink-0" style={{ color }} aria-hidden="true" />
        <span className="text-base font-semibold text-slate-900">{event.name}</span>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
        <span className="rounded-full px-2.5 py-0.5 font-medium text-white" style={{ backgroundColor: color }}>
          {gdacsAlertLabel(event.level)}
        </span>
        <span className="text-slate-600">{GDACS_TYPE_LABEL[event.type]}</span>
      </div>

      {gdacsDetails(event).map((line) => (
        <div key={line} className="mt-2 text-sm text-slate-800">
          {line}
        </div>
      ))}
      {/* When it affects Sri Lanka, the Affected line above already says so */}
      {!event.affectsSriLanka && (
        <div className="mt-2 text-xs text-slate-600">{t('gdacs.distance', { km: Math.round(event.distanceKm) })}</div>
      )}

      <div className="mt-1 text-xs text-slate-600">
        {t(happened ? 'gdacs.happened' : 'gdacs.started', { time: sriLankaTime(new Date(event.from).toISOString()) })}
      </div>
      <div className="mt-1 text-xs text-slate-600">
        {t('gdacs.updated', { ago: timeAgo(new Date(event.modified).toISOString()) })}
      </div>

      <a
        href={event.url}
        target="_blank"
        rel="noopener noreferrer"
        className="mt-2 block text-sm font-medium text-blue-700 underline"
      >
        {t('gdacs.more')}
      </a>
      <div className="mt-2 text-xs italic text-slate-600">{t('gdacs.notice')}</div>
      <div className="mt-1 text-[11px] leading-tight text-slate-500">{GDACS_CREDIT}</div>
    </div>
  )
}
