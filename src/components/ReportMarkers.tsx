import { createElement, useEffect, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { createRoot } from 'react-dom/client'
import { Marker, Popup, useMap, useMapEvents } from 'react-leaflet'
import { divIcon, type DivIcon, type Map as LeafletMap, type Marker as LeafletMarker } from 'leaflet'
import {
  HAZARD_TYPES,
  hazardIcon,
  hazardLabel,
  severityBg,
  severityLabel,
  type HazardType,
  type Severity,
} from '../lib/hazards'
import type { RouteResult } from '../lib/routing'
import { expiresIn, timeAgo } from '../lib/time'
import { useReportsInView, type Bounds, type Report } from '../lib/useReports'
import { useRouteHazards } from '../lib/useRoute'
import ReportPhoto from './ReportPhoto'
import VoteSection from './VoteSection'

const DEBOUNCE_MS = 400

// Loads slightly more than what's on screen, so small pans don't leave empty edges
function readBounds(map: LeafletMap): Bounds {
  const b = map.getBounds().pad(0.25)
  // Round outward (min down, max up) so the box never shrinks. Plain rounding
  // can collapse a zoomed-in view into a zero-width box and return nothing.
  const down = (n: number) => Math.floor(n * 100) / 100
  const up = (n: number) => Math.ceil(n * 100) / 100
  return {
    minLng: down(b.getWest()),
    minLat: down(b.getSouth()),
    maxLng: up(b.getEast()),
    maxLat: up(b.getNorth()),
  }
}

// Leaflet markers are plain HTML, so each icon is drawn once into text. This
// avoids react-dom/server, which would add a lot to the download. It runs when
// this file loads, not during a render, because flushSync can't run in one.
const iconSvg = new Map<HazardType, string>()
for (const { value, icon } of HAZARD_TYPES) {
  const host = document.createElement('div')
  const root = createRoot(host)
  flushSync(() => root.render(createElement(icon, { size: 24, strokeWidth: 2.25, 'aria-hidden': true })))
  iconSvg.set(value, host.innerHTML)
  root.unmount()
}

const iconCache = new Map<string, DivIcon>()

function markerIcon(type: HazardType, severity: Severity): DivIcon {
  const key = `${type}:${severity}`
  let icon = iconCache.get(key)
  if (!icon) {
    // 44px is the usual minimum size for a comfortable tap
    const html = `<div class="flex h-11 w-11 items-center justify-center rounded-full border-2 border-white text-white shadow-lg ${severityBg(severity)}">${iconSvg.get(type) ?? ''}</div>`
    icon = divIcon({ html, className: '', iconSize: [44, 44], iconAnchor: [22, 22], popupAnchor: [0, -24] })
    iconCache.set(key, icon)
  }
  return icon
}

type Props = {
  hidden: boolean
  // The planned route, if any. Its hazards are shown even outside the loaded area.
  route: RouteResult | null
  // Asks for one report's card to open. The number makes a repeat tap count as new.
  openRequest: { id: string; n: number } | null
}

export default function ReportMarkers({ hidden, route, openRequest }: Props) {
  const map = useMap()
  const [bounds, setBounds] = useState(() => readBounds(map))
  const timer = useRef<number | undefined>(undefined)
  const markers = useRef(new Map<string, LeafletMarker>())

  // Wait for the map to stop moving, so dragging doesn't send a request per frame
  useMapEvents({
    moveend() {
      window.clearTimeout(timer.current)
      timer.current = window.setTimeout(() => setBounds(readBounds(map)), DEBOUNCE_MS)
    },
  })
  useEffect(() => () => window.clearTimeout(timer.current), [])

  const { data } = useReportsInView(bounds)
  // Same query as the route panel uses, so this shares its result instead of asking again
  const { data: routeHazards } = useRouteHazards(route)

  useEffect(() => {
    if (openRequest) markers.current.get(openRequest.id)?.openPopup()
  }, [openRequest])

  // The query keeps running while hidden, so markers are fresh when picking ends
  if (hidden) return null

  // Merged by id, so a report in both lists is only drawn once
  const all = new Map<string, Report>()
  for (const report of [...(data ?? []), ...(routeHazards ?? [])]) all.set(report.id, report)

  return (
    <>
      {[...all.values()].map((report) => (
        <Marker
          key={report.id}
          ref={(marker) => {
            if (marker) markers.current.set(report.id, marker)
            else markers.current.delete(report.id)
          }}
          position={[report.lat, report.lng]}
          icon={markerIcon(report.hazard_type, report.severity)}
          alt={hazardLabel(report.hazard_type)}
        >
          <Popup minWidth={220}>
            <ReportCard report={report} />
          </Popup>
        </Marker>
      ))}
    </>
  )
}

// Uses divs, not <p>, because Leaflet's popup CSS adds margins to paragraphs
function ReportCard({ report }: { report: Report }) {
  return (
    <div>
      <div className="flex items-center gap-2">
        {createElement(hazardIcon(report.hazard_type), {
          className: 'h-5 w-5 shrink-0 text-slate-700',
          'aria-hidden': true,
        })}
        <span className="text-base font-semibold text-slate-900">{hazardLabel(report.hazard_type)}</span>
      </div>
      <span
        className={`mt-2 inline-block rounded-full px-2.5 py-0.5 text-xs font-medium text-white ${severityBg(report.severity)}`}
      >
        {severityLabel(report.severity)}
      </span>
      {report.note && <div className="mt-2 break-words text-sm text-slate-700">{report.note}</div>}
      {report.photo_path && <ReportPhoto path={report.photo_path} />}
      <div className="mt-2 text-xs text-slate-500">
        {timeAgo(report.created_at)} &middot; {expiresIn(report.expires_at)}
      </div>
      <VoteSection reportId={report.id} />
    </div>
  )
}
