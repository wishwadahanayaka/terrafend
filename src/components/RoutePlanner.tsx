import { createElement, useEffect, useState } from 'react'
import { ChevronDown, ChevronUp, ExternalLink, LocateFixed, X } from 'lucide-react'
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
  fetchRoute,
  formatKm,
  googleMapsUrl,
  hazardSummary,
  type Place,
  type Point,
  type RouteResult,
} from '../lib/routing'
import { routeDuration } from '../lib/time'
import { useRouteHazards, type RouteHazard } from '../lib/useRoute'
import PlaceInput from './PlaceInput'

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

export default function RoutePlanner({
  map,
  userLatLng,
  hidden,
  panel,
  onPanelChange,
  route,
  onRouteChange,
  onSelectHazard,
}: Props) {
  const hazards = useRouteHazards(route)
  const [fromMe, setFromMe] = useState(true)
  const [from, setFrom] = useState<Place | null>(null)
  const [to, setTo] = useState<Place | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Changing this remounts the search boxes, which empties them
  const [resetCount, setResetCount] = useState(0)

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
    setFromMe(true)
    setFrom(null)
    setTo(null)
    setError(null)
    setResetCount((n) => n + 1)
  }

  // With the panel closed this still stays mounted, to keep the route line on the map
  if (hidden || panel === 'closed') return null

  const list = hazards.data ?? []
  const expanded = panel === 'open'

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-0 z-[1000] flex justify-center">
      <div className="pointer-events-auto flex max-h-[60dvh] w-full max-w-md flex-col rounded-t-2xl bg-white shadow-[0_-2px_12px_rgba(0,0,0,0.2)]">
        <div className="flex items-center pl-4 pr-1">
          <button
            type="button"
            onClick={() => onPanelChange(expanded ? 'collapsed' : 'open')}
            aria-expanded={expanded}
            className="flex h-14 flex-1 items-center gap-2 text-left"
          >
            <span className="text-base font-semibold text-slate-900">Route</span>
            {route && (
              <span className="truncate text-sm text-slate-600">
                {formatKm(route.distance_m)}
                {hazards.data && ` · ${list.length} ${list.length === 1 ? 'hazard' : 'hazards'}`}
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
                    key={`from-${resetCount}`}
                    label="From"
                    placeholder="Search for a starting place"
                    onChange={setFrom}
                    focus={focus}
                  />
                  <button
                    type="button"
                    onClick={() => {
                      setFromMe(true)
                      setFrom(null)
                    }}
                    className="mt-1 h-11 text-sm font-medium text-blue-700"
                  >
                    Use my location instead
                  </button>
                </div>
              )}

              <PlaceInput
                key={`to-${resetCount}`}
                label="To"
                placeholder="Search for a destination"
                onChange={setTo}
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

            {route && (
              <div className="mt-5 border-t border-slate-200 pt-4">
                <p className="text-lg font-semibold text-slate-900">
                  {formatKm(route.distance_m)} &middot; {routeDuration(route.duration_s)} (without traffic)
                </p>
                <p className="mt-1 text-xs text-slate-500">
                  Real travel times are often longer. Check Google Maps for live traffic.
                </p>
                <p className="mt-3 text-base text-slate-800">
                  {hazards.isPending
                    ? 'Checking for hazards…'
                    : hazards.isError
                      ? 'Couldn’t check this route for hazards.'
                      : hazardSummary(list) + (list.length >= 200 ? ' (first 200 shown)' : '')}
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

                <div className="mt-4 grid gap-2">
                  <a
                    href={googleMapsUrl(route.start, route.end)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex h-12 items-center justify-center gap-2 rounded-xl border-2 border-blue-600 text-base font-semibold text-blue-700 active:bg-blue-50"
                  >
                    <ExternalLink className="h-5 w-5" aria-hidden="true" />
                    Open in Google Maps
                  </a>
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
