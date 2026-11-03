import { lazy, Suspense, useState } from 'react'
import { MapContainer, TileLayer } from 'react-leaflet'
import { Route as RouteIcon } from 'lucide-react'
import type { LatLng, LatLngBoundsExpression, Map as LeafletMap } from 'leaflet'
import type { RouteHazard } from '../lib/useRoute'
import type { RouteResult } from '../lib/routing'
import LocateButton from './LocateButton'
import MapLimits from './MapLimits'
import ReportFlow, { type ReportMode } from './ReportFlow'
import RiverControls from './RiverControls'
import type { PanelState } from './RoutePlanner'

// The data code (Supabase, hazards, the route planner) loads after the map
// has appeared, so the first screen shows up sooner
const ReportMarkers = lazy(() => import('./ReportMarkers'))
const RoutePlanner = lazy(() => import('./RoutePlanner'))
const RiverMarkers = lazy(() => import('./RiverMarkers'))

const SHOW_ALL_RIVERS_KEY = 'terrafend:showAllRivers'

// Storage can be missing or blocked (private windows, strict settings), so it's only ever a bonus
function loadShowAllRivers(): boolean {
  try {
    return localStorage.getItem(SHOW_ALL_RIVERS_KEY) === '1'
  } catch {
    return false
  }
}

function saveShowAllRivers(value: boolean) {
  try {
    localStorage.setItem(SHOW_ALL_RIVERS_KEY, value ? '1' : '0')
  } catch {
    // not saved, the choice still works until the page is closed
  }
}

// Fitting to bounds instead of a fixed zoom keeps the island filling the screen on any size
const SRI_LANKA_BOUNDS: LatLngBoundsExpression = [
  [5.85, 79.6],
  [9.9, 81.95],
]

// The island plus a margin of sea. The map can't be dragged outside this.
const SRI_LANKA_LIMITS: LatLngBoundsExpression = [
  [5.55, 79.3],
  [10.2, 82.25],
]

export default function HazardMap() {
  // The report and route UI sit outside MapContainer so touches in them don't pan the map
  const [map, setMap] = useState<LeafletMap | null>(null)
  const [userLatLng, setUserLatLng] = useState<LatLng | null>(null)
  const [mode, setMode] = useState<ReportMode>('idle')

  const [panel, setPanel] = useState<PanelState>('closed')
  const [route, setRoute] = useState<RouteResult | null>(null)
  // The planner keeps the From and To boxes, so once it has been opened it stays loaded
  const [plannerOpened, setPlannerOpened] = useState(false)
  const [openRequest, setOpenRequest] = useState<{ id: string; n: number } | null>(null)
  // Gauges at Alert or above always show. This adds all the others.
  const [showAllRivers, setShowAllRivers] = useState(loadShowAllRivers)

  const picking = mode === 'picking'

  function showHazard(hazard: RouteHazard) {
    if (!map) return
    // Out of the way of the map, then jump there. Without animation the marker
    // is already in place when its card opens.
    setPanel('collapsed')
    map.setView([hazard.lat, hazard.lng], Math.max(map.getZoom(), 16), { animate: false })
    setOpenRequest({ id: hazard.id, n: Date.now() })
  }

  return (
    <div className="relative h-full w-full">
      <MapContainer
        ref={setMap}
        bounds={SRI_LANKA_BOUNDS}
        maxBounds={SRI_LANKA_LIMITS}
        maxBoundsViscosity={1}
        zoomSnap={0.25}
        zoomControl={false}
        className="h-full w-full"
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <MapLimits island={SRI_LANKA_BOUNDS} />
        <Suspense fallback={null}>
          <ReportMarkers hidden={picking} route={route} openRequest={openRequest} />
        </Suspense>
        {!picking && (
          <Suspense fallback={null}>
            <RiverMarkers showAll={showAllRivers} />
          </Suspense>
        )}
        <LocateButton
          onLocated={setUserLatLng}
          bottomClass={picking ? 'bottom-28' : panel === 'collapsed' ? 'bottom-20' : 'bottom-6'}
        />
      </MapContainer>

      {!picking && (
        <RiverControls
          map={map}
          showAll={showAllRivers}
          onShowAllChange={(value) => {
            setShowAllRivers(value)
            saveShowAllRivers(value)
          }}
        />
      )}

      {map && (
        <>
          <ReportFlow
            map={map}
            userLatLng={userLatLng}
            mode={mode}
            onModeChange={setMode}
            buttonVisible={panel === 'closed'}
          />

          {panel === 'closed' && !picking && (
            <button
              type="button"
              onClick={() => {
                setPlannerOpened(true)
                setPanel('open')
              }}
              className="absolute bottom-[10.5rem] right-4 z-[1000] flex h-14 items-center gap-2 rounded-full bg-white px-5 font-semibold text-blue-700 shadow-lg active:bg-slate-100"
            >
              <RouteIcon className="h-6 w-6" aria-hidden="true" />
              Route
            </button>
          )}

          {/* Stays loaded once opened: it draws the route line and remembers the inputs */}
          {plannerOpened && (
            <Suspense fallback={null}>
              <RoutePlanner
                map={map}
                userLatLng={userLatLng}
                hidden={picking}
                panel={panel}
                onPanelChange={setPanel}
                route={route}
                onRouteChange={setRoute}
                onSelectHazard={showHazard}
              />
            </Suspense>
          )}
        </>
      )}
    </div>
  )
}
