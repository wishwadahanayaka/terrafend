import { createElement, useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, ChevronUp, Droplet, ExternalLink, LocateFixed, Route as RouteIcon, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import {
  circleMarker,
  latLngBounds,
  layerGroup,
  polyline,
  type ErrorEvent as LeafletErrorEvent,
  type LatLng,
  type LocationEvent,
  type Map as LeafletMap,
} from 'leaflet'
import { hazardIcon, hazardLabel, severityBg, severityLabel } from '../lib/hazards'
import {
  EMPTY_FIELD,
  fetchRoute,
  formatKm,
  googleMapsUrl,
  hazardSummary,
  ERROR_CHOOSE_START,
  ERROR_LOCATION_DENIED,
  ERROR_LOCATION_FAILED,
  GENERAL_ERROR,
  MAX_AVOID,
  routeErrorText,
  type Place,
  type PlaceField,
  type Point,
  type RouteResult,
} from '../lib/routing'
import { gaugeName, STEP_COLOR, STEP_LABEL, stepTextColor, worstStep } from '../lib/riverGauges'
import { gaugesNearRoute } from '../lib/routeGauges'
import { useRouteRecentRain } from '../lib/useRouteRecentRain'
import { GDACS_CREDIT, GDACS_LEVEL_COLOR, gdacsAlertLabel } from '../lib/gdacs'
import { GDACS_ICON } from '../lib/gdacsIcons'
import { gdacsAlongRoute, whyText } from '../lib/gdacsRoute'
import { useGdacsEvents } from '../lib/useGdacs'
import { routeDuration } from '../lib/time'
import { useOnline } from '../lib/useOnline'
import { useRiverGauges } from '../lib/useRiverGauges'
import { useRouteHazards, type RouteGroup, type RouteHazard } from '../lib/useRoute'
import { groupReports } from '../lib/duplicates'
import { RAIN_COLOR, worstRain, type RainStretch } from '../lib/rainForecast'
import { useRouteRain } from '../lib/useRouteRain'
import { addAvoidSpots, avoidedCount, blockedOn, detourWaypoints, notAvoided, type AvoidSpot } from '../lib/reroute'
import PlaceInput from './PlaceInput'
import RainSection from './RainSection'
import RerouteSection from './RerouteSection'

export type PanelState = 'closed' | 'open' | 'collapsed'

const REROUTE_PANE = 'reroute'
// One reroute, then one more if the new route hits a different blocked road
const MAX_REROUTES = 2

type Props = {
  map: LeafletMap
  userLatLng: LatLng | null
  hidden: boolean
  panel: PanelState
  onPanelChange: (panel: PanelState) => void
  route: RouteResult | null
  onRouteChange: (route: RouteResult | null) => void
  // A reroute around blocked roads, shown beside the route until it's used or dismissed
  alternative: RouteResult | null
  onAlternativeChange: (route: RouteResult | null) => void
  onSelectHazard: (hazard: RouteHazard) => void
  onSelectRain: (stretch: RainStretch) => void
  // Tells the map when the results are out of date, so the rain on it can fade too
  onStaleChange: (stale: boolean) => void
}

// Asks the browser for the position once. The map's own location events also
// reach the location button, so its blue dot updates too.
function findMe(map: LeafletMap): Promise<Point> {
  return new Promise((resolve, reject) => {
    const onFound = (e: LocationEvent) => {
      map.off('locationerror', onError)
      resolve({ lat: e.latlng.lat, lng: e.latlng.lng })
    }
    const onError = (e: LeafletErrorEvent) => {
      map.off('locationfound', onFound)
      reject(new Error(e.code === 1 ? ERROR_LOCATION_DENIED : ERROR_LOCATION_FAILED))
    }
    map.once('locationfound', onFound)
    map.once('locationerror', onError)
    map.locate({ enableHighAccuracy: true, timeout: 15000 })
  })
}

type Inputs = { fromMe: boolean; from: Place | null; to: Place | null }

const samePlace = (a: Place | null, b: Place | null) =>
  a === b || (a !== null && b !== null && a.lat === b.lat && a.lng === b.lng)

// "My location" counts as the same start every time, wherever you happen to be
function sameInputs(a: Inputs, b: Inputs): boolean {
  if (a.fromMe !== b.fromMe) return false
  if (!a.fromMe && !samePlace(a.from, b.from)) return false
  return samePlace(a.to, b.to)
}

export default function RoutePlanner({
  map,
  userLatLng,
  hidden,
  panel,
  onPanelChange,
  route,
  onRouteChange,
  alternative,
  onAlternativeChange,
  onSelectHazard,
  onSelectRain,
  onStaleChange,
}: Props) {
  const { t } = useTranslation()
  const online = useOnline()
  const hazards = useRouteHazards(route)
  const altHazards = useRouteHazards(alternative)
  // Reports of the same hazard close together count as one (see groupReports). The map
  // still shows every report, but the lists, counts and the reroute work on these.
  const groups = useMemo(() => groupReports(hazards.data ?? []), [hazards.data])
  const altGroups = useMemo(() => groupReports(altHazards.data ?? []), [altHazards.data])
  // One request per checked route, so it only runs when a route is checked
  const rain = useRouteRain(route)

  // Official river gauges at Alert or above within 2 km of the route. If the river
  // data can't be loaded this is simply empty, and the rest of the panel carries on.
  const rivers = useRiverGauges(route !== null)
  const riversNear = useMemo(
    () => (route && rivers.status === 'success' ? gaugesNearRoute(route.coordinates, rivers.data) : []),
    [route, rivers.status, rivers.data],
  )
  // What the satellite and the gauges near the road say about rain that has already fallen
  const recent = useRouteRecentRain(route)

  // Orange and Red global alerts the route passes through or near. If they can't be loaded
  // this is simply empty and the rest of the panel carries on.
  const alerts = useGdacsEvents(false)
  const globalAlerts = useMemo(
    () => (route && alerts.events ? gdacsAlongRoute(route, alerts.events) : []),
    [route, alerts.events],
  )
  // The inputs live here, not in the panel, so they're still there after it's closed and reopened
  const [fromMe, setFromMe] = useState(true)
  const [fromField, setFromField] = useState<PlaceField>(EMPTY_FIELD)
  const [toField, setToField] = useState<PlaceField>(EMPTY_FIELD)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // What the route on the map was checked with, to tell when the inputs have moved on from it
  const [checked, setChecked] = useState<Inputs | null>(null)

  // Rerouting around blocked roads. All of it starts again with each Check route.
  // The spots asked to be avoided so far, so a second reroute avoids the first ones too
  const [avoid, setAvoid] = useState<AvoidSpot[]>([])
  const [reroutes, setReroutes] = useState(0)
  // The route as first checked. Google Maps waypoints go where a reroute leaves it.
  const [firstRoute, setFirstRoute] = useState<RouteResult | null>(null)
  const [rerouting, setRerouting] = useState(false)
  const [rerouteError, setRerouteError] = useState<string | null>(null)
  // The route "Keep original" was tapped for, so it doesn't ask again
  const [keptRouteId, setKeptRouteId] = useState<number | null>(null)
  // The reroute that was taken, and how many blocked roads it avoids, for the note under the
  // summary. It belongs to that route only: a new check or clear drops it.
  const [taken, setTaken] = useState<{ routeId: number; avoids: number } | null>(null)
  const trip = useRef(0)

  const from = fromField.place
  const to = toField.place
  const outOfDate = route !== null && checked !== null && !sameInputs(checked, { fromMe, from, to })

  useEffect(() => {
    onStaleChange(outOfDate)
  }, [outOfDate, onStaleChange])

  // Search results are ranked around here, so nearby places come first
  const centre = map.getCenter().wrap()
  const focus: Point = userLatLng ?? { lat: centre.lat, lng: centre.lng }

  // The route line sits on the map itself, outside the React tree
  useEffect(() => {
    if (!route || hidden) return
    const latLngs = (r: RouteResult) => r.coordinates.map(([lng, lat]) => [lat, lng] as [number, number])
    // While a reroute is offered it goes above the route's rain colours (450), so the
    // blue line reads clearly where the two routes share a road
    if (alternative && !map.getPane(REROUTE_PANE)) map.createPane(REROUTE_PANE).style.zIndex = '455'
    const pane = alternative ? REROUTE_PANE : 'overlayPane'
    const dot = (p: Point, color: string) =>
      circleMarker([p.lat, p.lng], {
        radius: 8,
        color: '#ffffff',
        weight: 3,
        fillColor: color,
        fillOpacity: 1,
        interactive: false,
        pane,
      })
    const main = alternative ?? route
    const layers = [
      // The white line underneath keeps the blue one readable on busy map areas
      polyline(latLngs(main), { color: '#ffffff', weight: 10, opacity: 0.9, interactive: false, pane }),
      polyline(latLngs(main), { color: '#1d4ed8', weight: 6, interactive: false, pane }),
      dot(route.start, '#16a34a'),
      dot(route.end, '#dc2626'),
    ]
    // The original, greyed and dashed underneath the reroute
    if (alternative) {
      layers.unshift(
        polyline(latLngs(route), { color: '#64748b', weight: 5, opacity: 0.85, dashArray: '8 10', interactive: false }),
      )
    }
    const group = layerGroup(layers).addTo(map)
    return () => {
      group.remove()
    }
  }, [map, route, alternative, hidden])

  function resetReroute() {
    // A reroute still on its way belongs to the old trip, and is dropped when it arrives
    trip.current++
    onAlternativeChange(null)
    setAvoid([])
    setReroutes(0)
    setRerouteError(null)
    setKeptRouteId(null)
    setTaken(null)
    setRerouting(false)
  }

  // Asks for a route that misses every blocked road so far plus `blocked`, which were
  // found on `foundOn` (the route, or the reroute already on offer)
  async function findAnother(foundOn: RouteResult, blocked: RouteGroup[]) {
    if (!route) return
    // One spot for each blocked road, however many reports it has
    const spots = addAvoidSpots(avoid, foundOn, blocked)
    const thisTrip = trip.current
    setAvoid(spots)
    setRerouting(true)
    setRerouteError(null)
    try {
      const next = await fetchRoute(
        route.start,
        route.end,
        spots.slice(0, MAX_AVOID).map((s) => s.point),
      )
      if (thisTrip !== trip.current) return
      next.via = detourWaypoints(next, firstRoute ?? route)
      setReroutes((n) => n + 1)
      onAlternativeChange(next)
      const bottom = Math.min(window.innerHeight * 0.5, 420)
      map.fitBounds(
        latLngBounds([...route.coordinates, ...next.coordinates].map(([lng, lat]) => [lat, lng])),
        { paddingTopLeft: [24, 80], paddingBottomRight: [24, bottom] },
      )
    } catch (err) {
      if (thisTrip !== trip.current) return
      setRerouteError(err instanceof Error ? err.message : GENERAL_ERROR)
    } finally {
      if (thisTrip === trip.current) setRerouting(false)
    }
  }

  function adoptAlternative() {
    if (!alternative) return
    // Like the offer, only claims what was checked: nothing if the reroute's hazards didn't load
    setTaken({ routeId: alternative.id, avoids: altHazards.status === 'success' ? avoidedCount(avoid, altGroups) : 0 })
    // Everything keyed on the route (hazards, rivers, rain, global alerts) checks it afresh
    onRouteChange(alternative)
    onAlternativeChange(null)
    setRerouteError(null)
  }

  function keepOriginal() {
    if (route) setKeptRouteId(route.id)
    onAlternativeChange(null)
    setRerouteError(null)
  }

  async function check() {
    if (!to) return
    setBusy(true)
    setError(null)
    try {
      let start: Point
      if (fromMe) {
        start = userLatLng ? { lat: userLatLng.lat, lng: userLatLng.lng } : await findMe(map)
      } else if (from) {
        start = { lat: from.lat, lng: from.lng }
      } else {
        throw new Error(ERROR_CHOOSE_START)
      }

      const result = await fetchRoute(start, { lat: to.lat, lng: to.lng })
      resetReroute()
      setFirstRoute(result)
      onRouteChange(result)
      setChecked({ fromMe, from, to })

      // The panel covers the lower part of the screen, so leave room for it
      const bottom = Math.min(window.innerHeight * 0.5, 420)
      map.fitBounds(latLngBounds(result.coordinates.map(([lng, lat]) => [lat, lng])), {
        paddingTopLeft: [24, 80],
        paddingBottomRight: [24, bottom],
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : GENERAL_ERROR)
    } finally {
      setBusy(false)
    }
  }

  function clear() {
    resetReroute()
    setFirstRoute(null)
    onRouteChange(null)
    setChecked(null)
    setFromMe(true)
    setFromField(EMPTY_FIELD)
    setToField(EMPTY_FIELD)
    setError(null)
  }

  // With the panel closed this still stays mounted, to keep the route line on the map
  if (hidden || panel === 'closed') return null

  const list = groups
  const expanded = panel === 'open'

  // Only fully blocked roads lead to a reroute offer. Everything else stays a warning.
  const blocked = blockedOn(list)
  const altBlocked = blockedOn(altGroups)
  // Every report on the reroute, to tell which avoided roads it really stays clear of
  const avoidTotal = avoid.length + notAvoided(avoid, altBlocked).length
  const riverWorst = worstStep(riversNear.map((r) => r.gauge))
  const alertWorst = globalAlerts.some((a) => a.event.level === 'Red') ? 'Red' : globalAlerts.length > 0 ? 'Orange' : null
  const rainStretches = rain.data?.stretches ?? []
  // Every rain warning counts, whatever it came from: the forecast ahead, the satellite's
  // recent rain, or a gauge near the road
  const rainWarnings = rainStretches.length + recent.satellite.length + recent.gauges.length
  const rainWorst = worstRain([
    ...rainStretches.map((s) => s.level),
    ...recent.satellite.map((s) => s.level),
    ...recent.gauges.flatMap((g) => (g.item.level ? [g.item.level] : [])),
  ])

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-0 z-[1000] flex justify-center">
      <div className="pointer-events-auto flex max-h-[60dvh] w-full max-w-md flex-col rounded-t-2xl bg-white shadow-[0_-2px_12px_rgba(0,0,0,0.2)]">
        <div className="flex items-center pl-4 pr-1">
          <button
            type="button"
            onClick={() => onPanelChange(expanded ? 'collapsed' : 'open')}
            aria-expanded={expanded}
            className="flex min-h-14 flex-1 items-center gap-2 py-1 text-left"
          >
            <span className="text-base font-semibold text-slate-900">{t('route.title')}</span>
            {route && (
              <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-1.5 gap-y-0.5 text-sm text-slate-600">
                <span className="shrink-0">{formatKm(route.distance_m)}</span>
                {alertWorst && (
                  <>
                    <span aria-hidden="true">&middot;</span>
                    <span
                      className="max-w-full rounded-full px-2 py-0.5 text-xs font-semibold text-white"
                      style={{ backgroundColor: GDACS_LEVEL_COLOR[alertWorst] }}
                    >
                      {t('route.alertCount', { count: globalAlerts.length })}
                    </span>
                  </>
                )}
                {riverWorst && (
                  <>
                    <span aria-hidden="true">&middot;</span>
                    <span
                      className="max-w-full rounded-full px-2 py-0.5 text-xs font-semibold"
                      style={{ backgroundColor: STEP_COLOR[riverWorst], color: stepTextColor(riverWorst) }}
                    >
                      {t('route.riverCount', { count: riversNear.length })}
                    </span>
                  </>
                )}
                {rainWorst && (
                  <>
                    <span aria-hidden="true">&middot;</span>
                    <span
                      className="max-w-full rounded-full px-2 py-0.5 text-xs font-semibold text-white"
                      style={{ backgroundColor: RAIN_COLOR[rainWorst] }}
                    >
                      {t('route.rainCount', { count: rainWarnings })}
                    </span>
                  </>
                )}
                {hazards.data && (
                  <>
                    <span aria-hidden="true">&middot;</span>
                    <span className="truncate">
                      {t('route.hazardCount', { count: list.length })}
                    </span>
                  </>
                )}
                {outOfDate && (
                  <span className="max-w-full rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900">
                    {t('route.outOfDate')}
                  </span>
                )}
              </span>
            )}
            {expanded ? (
              <ChevronDown className="ml-auto h-5 w-5 shrink-0 text-slate-500" aria-label={t('route.collapse')} />
            ) : (
              <ChevronUp className="ml-auto h-5 w-5 shrink-0 text-slate-500" aria-label={t('route.expand')} />
            )}
          </button>
          <button
            type="button"
            onClick={() => onPanelChange('closed')}
            aria-label={t('route.closePanel')}
            className="flex h-11 w-11 items-center justify-center rounded-full text-slate-600 active:bg-slate-100"
          >
            <X className="h-6 w-6" />
          </button>
        </div>

        {expanded && (
          <div className="flex-1 overflow-y-auto px-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
            <div className="space-y-3">
              {fromMe ? (
                <div>
                  <p className="mb-1 text-sm font-medium text-slate-700">{t('route.from')}</p>
                  <div className="flex h-12 items-center justify-between rounded-xl border-2 border-slate-200 pl-3">
                    <span className="flex items-center gap-2 text-base text-slate-900">
                      <LocateFixed className="h-5 w-5 text-blue-600" aria-hidden="true" />
                      {t('route.myLocation')}
                    </span>
                    <button
                      type="button"
                      onClick={() => setFromMe(false)}
                      className="h-12 px-3 text-sm font-medium text-blue-700"
                    >
                      {t('route.change')}
                    </button>
                  </div>
                </div>
              ) : (
                <div>
                  <PlaceInput
                    label={t('route.from')}
                    placeholder={t('route.searchStart')}
                    value={fromField}
                    onChange={setFromField}
                    focus={focus}
                  />
                  <button
                    type="button"
                    onClick={() => {
                      setFromMe(true)
                      setFromField(EMPTY_FIELD)
                    }}
                    className="mt-1 h-11 text-sm font-medium text-blue-700"
                  >
                    {t('route.useMyLocation')}
                  </button>
                </div>
              )}

              <PlaceInput
                label={t('route.to')}
                placeholder={t('route.searchDestination')}
                value={toField}
                onChange={setToField}
                focus={focus}
              />

              {error && (
                <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
                  {routeErrorText(error)}
                </p>
              )}

              <button
                type="button"
                onClick={check}
                disabled={!to || busy || !online}
                className="h-14 w-full rounded-xl bg-blue-600 text-base font-semibold text-white active:bg-blue-700 disabled:bg-slate-300 disabled:text-slate-500"
              >
                {busy ? t('route.checking') : t('route.check')}
              </button>
              {!online && (
                <p role="status" className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
                  {t('offline.route')}
                </p>
              )}
            </div>

            {route && outOfDate && (
              <p role="status" className="mt-4 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
                {t('route.outOfDateNote')}
              </p>
            )}

            {route && (
              <div className="mt-5 border-t border-slate-200 pt-4">
                {/* Only the results fade, the buttons below stay at full strength */}
                <div className={outOfDate ? 'opacity-60' : ''}>
                <p className="text-lg font-semibold text-slate-900">
                  {t('route.summary', { distance: formatKm(route.distance_m), duration: routeDuration(route.duration_s) })}
                </p>
                {taken && taken.routeId === route.id && taken.avoids > 0 && (
                  <p className="mt-1 flex items-start gap-2 text-sm font-medium text-blue-800">
                    <RouteIcon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                    {t('reroute.usedNote', { count: taken.avoids })}
                  </p>
                )}
                <p className="mt-1 text-xs text-slate-500">
                  {t('route.trafficNote')}
                </p>

                <RerouteSection
                  route={route}
                  alternative={alternative}
                  blocked={blocked}
                  altBlocked={altBlocked}
                  altStatus={altHazards.status}
                  avoided={avoidedCount(avoid, altGroups)}
                  avoidTotal={avoidTotal}
                  canRerouteAgain={reroutes < MAX_REROUTES}
                  showPrompt={
                    blocked.length > 0 && !outOfDate && keptRouteId !== route.id && reroutes < MAX_REROUTES
                  }
                  busy={rerouting}
                  error={rerouteError}
                  outOfDate={outOfDate}
                  onFind={findAnother}
                  onUse={adoptAlternative}
                  onKeep={keepOriginal}
                />

                {/* Official warnings come first, before anything crowd-sourced, and the biggest first of those */}
                {globalAlerts.length > 0 && (
                  <div className="mt-3">
                    <p className="text-sm font-semibold text-slate-900">{t('route.alertsTitle')}</p>
                    <ul className="mt-2 space-y-2">
                      {globalAlerts.map(({ event, why }) => {
                        const Icon = GDACS_ICON[event.type]
                        return (
                          <li
                            key={event.id}
                            className="flex min-h-12 items-center gap-3 rounded-xl border-2 border-slate-200 px-2 py-1"
                          >
                            <Icon
                              className="h-6 w-6 shrink-0"
                              style={{ color: GDACS_LEVEL_COLOR[event.level] }}
                              aria-hidden="true"
                            />
                            <span className="text-sm text-slate-900">
                              {t('route.alertLine', { alert: gdacsAlertLabel(event.level), name: event.name, why: whyText(why) })}
                            </span>
                          </li>
                        )
                      })}
                    </ul>
                    <p className="mt-1 text-xs text-slate-500">
                      {t('gdacs.notice')} {GDACS_CREDIT}
                    </p>
                  </div>
                )}

                {riversNear.length > 0 && (
                  <div className="mt-3">
                    <p className="text-sm font-semibold text-slate-900">{t('route.riversTitle')}</p>
                    <ul className="mt-2 space-y-2">
                      {riversNear.map(({ gauge, distanceAlongM }) => (
                        <li
                          key={gauge.id}
                          className="flex min-h-12 items-center gap-3 rounded-xl border-2 border-slate-200 px-2 py-1"
                        >
                          <Droplet
                            className="h-6 w-6 shrink-0"
                            fill={STEP_COLOR[gauge.step]}
                            stroke="#ffffff"
                            strokeWidth={2}
                            aria-hidden="true"
                          />
                          <span className="text-sm text-slate-900">
                            {t('route.riverLine', {
                              name: gaugeName(gauge),
                              step: STEP_LABEL[gauge.step],
                              km: t('units.km', {
                                value: distanceAlongM < 10_000 ? (distanceAlongM / 1000).toFixed(1) : Math.round(distanceAlongM / 1000),
                              }),
                            })}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                <RainSection rain={rain} onSelect={onSelectRain} recent={recent} />

                <p className="mt-3 text-base text-slate-800">
                  {hazards.isPending
                    ? t('route.hazardsChecking')
                    : hazards.isError
                      ? t('route.hazardsError')
                      : hazardSummary(list, riversNear.length > 0 || globalAlerts.length > 0) + ((hazards.data?.length ?? 0) >= 200 ? t('route.first200') : '')}
                </p>
                {hazards.isError && (
                  <button
                    type="button"
                    onClick={() => hazards.refetch()}
                    className="mt-1 h-11 text-sm font-medium text-blue-700"
                  >
                    {t('common.tryAgain')}
                  </button>
                )}
                <p className="mt-1 text-xs text-slate-500">
                  {t('route.usersNote')}
                </p>

                {list.length > 0 && (
                  <ul className="mt-3 space-y-2">
                    {list.map((h) => (
                      <li key={h.id}>
                        <button
                          type="button"
                          onClick={() => onSelectHazard(h)}
                          className="flex min-h-12 w-full items-center gap-3 rounded-xl border-2 border-slate-200 px-2 py-1 text-left active:bg-slate-100"
                        >
                          <span
                            className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-white ${severityBg(h.severity)}`}
                          >
                            {createElement(hazardIcon(h.hazard_type), { className: 'h-5 w-5', 'aria-hidden': true })}
                          </span>
                          <span className="text-sm text-slate-900">
                            {t(h.members.length > 1 ? 'route.hazardLineMany' : 'route.hazardLine', {
                              km: t('units.km', { value: (h.distance_along_m / 1000).toFixed(1) }),
                              type: hazardLabel(h.hazard_type),
                              severity: severityLabel(h.severity),
                              reports: t('route.reports', { count: h.members.length }),
                            })}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                </div>

                <div className="mt-4 grid gap-2">
                  {outOfDate ? (
                    // The link would open the old route, so it's switched off until the next check
                    <span
                      role="link"
                      aria-disabled="true"
                      className="flex h-12 cursor-not-allowed items-center justify-center gap-2 rounded-xl border-2 border-slate-200 bg-slate-100 text-base font-semibold text-slate-400"
                    >
                      <ExternalLink className="h-5 w-5" aria-hidden="true" />
                      {t('route.openGoogle')}
                    </span>
                  ) : (
                    <a
                      href={googleMapsUrl(route.start, route.end, route.via)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex h-12 items-center justify-center gap-2 rounded-xl border-2 border-blue-600 text-base font-semibold text-blue-700 active:bg-blue-50"
                    >
                      <ExternalLink className="h-5 w-5" aria-hidden="true" />
                      {t('route.openGoogle')}
                    </a>
                  )}
                  <button
                    type="button"
                    onClick={clear}
                    className="h-12 rounded-xl border-2 border-slate-300 text-base font-semibold text-slate-700 active:bg-slate-100"
                  >
                    {t('route.clear')}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
