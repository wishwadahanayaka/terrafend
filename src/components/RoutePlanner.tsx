import { createElement, useEffect, useMemo, useState } from 'react'
import { ChevronDown, ChevronUp, Droplet, ExternalLink, LocateFixed, X } from 'lucide-react'
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
  type Place,
  type PlaceField,
  type Point,
  type RouteResult,
} from '../lib/routing'
import { STEP_COLOR, STEP_LABEL, stepTextColor, worstStep } from '../lib/riverGauges'
import { gaugesNearRoute } from '../lib/routeGauges'
import { useRouteRecentRain } from '../lib/useRouteRecentRain'
import { GDACS_CREDIT, GDACS_LEVEL_COLOR, GDACS_NOTICE } from '../lib/gdacs'
import { GDACS_ICON } from '../lib/gdacsIcons'
import { gdacsAlongRoute } from '../lib/gdacsRoute'
import { useGdacsEvents } from '../lib/useGdacs'
import { routeDuration } from '../lib/time'
import { useRiverGauges } from '../lib/useRiverGauges'
import { useRouteHazards, type RouteHazard } from '../lib/useRoute'
import { RAIN_COLOR, worstRain, type RainStretch } from '../lib/rainForecast'
import { useRouteRain } from '../lib/useRouteRain'
import PlaceInput from './PlaceInput'
import RainSection from './RainSection'

export type PanelState = 'closed' | 'open' | 'collapsed'

type Props = {
  map: LeafletMap
  userLatLng: LatLng | null
  hidden: boolean
  panel: PanelState
  onPanelChange: (panel: PanelState) => void
  route: RouteResult | null
  onRouteChange: (route: RouteResult | null) => void
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
      reject(
        new Error(
          e.code === 1
            ? 'Location permission was denied. Allow it in your browser settings, or search for a starting place.'
            : 'Couldn’t find your location. Search for a starting place instead.',
        ),
      )
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
  onSelectHazard,
  onSelectRain,
  onStaleChange,
}: Props) {
  const hazards = useRouteHazards(route)
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
    const points = route.coordinates.map(([lng, lat]) => [lat, lng] as [number, number])
    const dot = (p: Point, color: string) =>
      circleMarker([p.lat, p.lng], {
        radius: 8,
        color: '#ffffff',
        weight: 3,
        fillColor: color,
        fillOpacity: 1,
        interactive: false,
      })
    const group = layerGroup([
      // The white line underneath keeps the blue one readable on busy map areas
      polyline(points, { color: '#ffffff', weight: 10, opacity: 0.9, interactive: false }),
      polyline(points, { color: '#1d4ed8', weight: 6, interactive: false }),
      dot(route.start, '#16a34a'),
      dot(route.end, '#dc2626'),
    ]).addTo(map)
    return () => {
      group.remove()
    }
  }, [map, route, hidden])

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
        throw new Error('Choose where to start from, or use your location.')
      }

      const result = await fetchRoute(start, { lat: to.lat, lng: to.lng })
      onRouteChange(result)
      setChecked({ fromMe, from, to })

      // The panel covers the lower part of the screen, so leave room for it
      const bottom = Math.min(window.innerHeight * 0.5, 420)
      map.fitBounds(latLngBounds(result.coordinates.map(([lng, lat]) => [lat, lng])), {
        paddingTopLeft: [24, 80],
        paddingBottomRight: [24, bottom],
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  function clear() {
    onRouteChange(null)
    setChecked(null)
    setFromMe(true)
    setFromField(EMPTY_FIELD)
    setToField(EMPTY_FIELD)
    setError(null)
  }

  // With the panel closed this still stays mounted, to keep the route line on the map
  if (hidden || panel === 'closed') return null

  const list = hazards.data ?? []
  const expanded = panel === 'open'
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
            <span className="text-base font-semibold text-slate-900">Route</span>
            {route && (
              <span className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5 text-sm text-slate-600">
                <span className="shrink-0">{formatKm(route.distance_m)}</span>
                {alertWorst && (
                  <>
                    <span aria-hidden="true">&middot;</span>
                    <span
                      className="shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold text-white"
                      style={{ backgroundColor: GDACS_LEVEL_COLOR[alertWorst] }}
                    >
                      {globalAlerts.length} {globalAlerts.length === 1 ? 'global alert' : 'global alerts'}
                    </span>
                  </>
                )}
                {riverWorst && (
                  <>
                    <span aria-hidden="true">&middot;</span>
                    <span
                      className="shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold"
                      style={{ backgroundColor: STEP_COLOR[riverWorst], color: stepTextColor(riverWorst) }}
                    >
                      {riversNear.length} {riversNear.length === 1 ? 'river warning' : 'river warnings'}
                    </span>
                  </>
                )}
                {rainWorst && (
                  <>
                    <span aria-hidden="true">&middot;</span>
                    <span
                      className="shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold text-white"
                      style={{ backgroundColor: RAIN_COLOR[rainWorst] }}
                    >
                      {rainWarnings} {rainWarnings === 1 ? 'rain warning' : 'rain warnings'}
                    </span>
                  </>
                )}
                {hazards.data && (
                  <>
                    <span aria-hidden="true">&middot;</span>
                    <span className="truncate">
                      {list.length} {list.length === 1 ? 'hazard' : 'hazards'}
                    </span>
                  </>
                )}
                {outOfDate && (
                  <span className="shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900">
                    out of date
                  </span>
                )}
              </span>
            )}
            {expanded ? (
              <ChevronDown className="ml-auto h-5 w-5 shrink-0 text-slate-500" aria-label="Collapse" />
            ) : (
              <ChevronUp className="ml-auto h-5 w-5 shrink-0 text-slate-500" aria-label="Expand" />
            )}
          </button>
          <button
            type="button"
            onClick={() => onPanelChange('closed')}
            aria-label="Close route panel"
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
                  <p className="mb-1 text-sm font-medium text-slate-700">From</p>
                  <div className="flex h-12 items-center justify-between rounded-xl border-2 border-slate-200 pl-3">
                    <span className="flex items-center gap-2 text-base text-slate-900">
                      <LocateFixed className="h-5 w-5 text-blue-600" aria-hidden="true" />
                      My location
                    </span>
                    <button
                      type="button"
                      onClick={() => setFromMe(false)}
                      className="h-12 px-3 text-sm font-medium text-blue-700"
                    >
                      Change
                    </button>
                  </div>
                </div>
              ) : (
                <div>
                  <PlaceInput
                    label="From"
                    placeholder="Search for a starting place"
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
                    Use my location instead
                  </button>
                </div>
              )}

              <PlaceInput
                label="To"
                placeholder="Search for a destination"
                value={toField}
                onChange={setToField}
                focus={focus}
              />

              {error && (
                <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
                  {error}
                </p>
              )}

              <button
                type="button"
                onClick={check}
                disabled={!to || busy}
                className="h-14 w-full rounded-xl bg-blue-600 text-base font-semibold text-white active:bg-blue-700 disabled:bg-slate-300 disabled:text-slate-500"
              >
                {busy ? 'Checking…' : 'Check route'}
              </button>
            </div>

            {route && outOfDate && (
              <p role="status" className="mt-4 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
                You changed the From or To. The results below are for the earlier route. Tap Check route to
                update them.
              </p>
            )}

            {route && (
              <div className="mt-5 border-t border-slate-200 pt-4">
                {/* Only the results fade, the buttons below stay at full strength */}
                <div className={outOfDate ? 'opacity-60' : ''}>
                <p className="text-lg font-semibold text-slate-900">
                  {formatKm(route.distance_m)} &middot; {routeDuration(route.duration_s)} (without traffic)
                </p>
                <p className="mt-1 text-xs text-slate-500">
                  Real travel times are often longer. Check Google Maps for live traffic.
                </p>

                {/* Official warnings come first, before anything crowd-sourced, and the biggest first of those */}
                {globalAlerts.length > 0 && (
                  <div className="mt-3">
                    <p className="text-sm font-semibold text-slate-900">Global alerts</p>
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
                              {event.level} alert: {event.name}. {why}.
                            </span>
                          </li>
                        )
                      })}
                    </ul>
                    <p className="mt-1 text-xs text-slate-500">
                      {GDACS_NOTICE} {GDACS_CREDIT}
                    </p>
                  </div>
                )}

                {riversNear.length > 0 && (
                  <div className="mt-3">
                    <p className="text-sm font-semibold text-slate-900">River gauges near the route</p>
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
                            {gauge.river} at {gauge.station} &middot; {STEP_LABEL[gauge.step]} &middot; near{' '}
                            {distanceAlongM < 10_000
                              ? (distanceAlongM / 1000).toFixed(1)
                              : Math.round(distanceAlongM / 1000)}{' '}
                            km
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                <RainSection rain={rain} onSelect={onSelectRain} recent={recent} />

                <p className="mt-3 text-base text-slate-800">
                  {hazards.isPending
                    ? 'Checking for hazards…'
                    : hazards.isError
                      ? 'Couldn’t check this route for hazards.'
                      : hazardSummary(list, riversNear.length > 0 || globalAlerts.length > 0) + (list.length >= 200 ? ' (first 200 shown)' : '')}
                </p>
                {hazards.isError && (
                  <button
                    type="button"
                    onClick={() => hazards.refetch()}
                    className="mt-1 h-11 text-sm font-medium text-blue-700"
                  >
                    Try again
                  </button>
                )}
                <p className="mt-1 text-xs text-slate-500">
                  Based on reports from TerraFend users. Not an official source.
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
                            {(h.distance_along_m / 1000).toFixed(1)} km &middot; {hazardLabel(h.hazard_type)} &middot;{' '}
                            {severityLabel(h.severity)}
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
                      Open in Google Maps
                    </span>
                  ) : (
                    <a
                      href={googleMapsUrl(route.start, route.end)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex h-12 items-center justify-center gap-2 rounded-xl border-2 border-blue-600 text-base font-semibold text-blue-700 active:bg-blue-50"
                    >
                      <ExternalLink className="h-5 w-5" aria-hidden="true" />
                      Open in Google Maps
                    </a>
                  )}
                  <button
                    type="button"
                    onClick={clear}
                    className="h-12 rounded-xl border-2 border-slate-300 text-base font-semibold text-slate-700 active:bg-slate-100"
                  >
                    Clear route
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
