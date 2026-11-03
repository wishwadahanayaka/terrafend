import { lazy, Suspense, useState } from 'react'
import { MapContainer, TileLayer } from 'react-leaflet'
import { Route as RouteIcon } from 'lucide-react'
import { latLngBounds, type LatLng, type Map as LeafletMap } from 'leaflet'
import { SRI_LANKA_BOUNDS, SRI_LANKA_LIMITS } from '../lib/mapBounds'
import { fadeWhenCardOpen, useCardOpen } from '../lib/useCardOpen'
import { loadLayerSettings, saveLayerSetting, type LayerSettings } from '../lib/layerSettings'
import type { RouteHazard } from '../lib/useRoute'
import { rainPath, type RainStretch } from '../lib/rainForecast'
import type { RouteResult } from '../lib/routing'
import LocateButton from './LocateButton'
import MapLimits from './MapLimits'
import ReportFlow, { type ReportMode } from './ReportFlow'
import LayerControls from './LayerControls'
import type { PanelState } from './RoutePlanner'

// The data code (Supabase, hazards, the route planner) loads after the map
// has appeared, so the first screen shows up sooner
const ReportMarkers = lazy(() => import('./ReportMarkers'))
const RoutePlanner = lazy(() => import('./RoutePlanner'))
const RiverMarkers = lazy(() => import('./RiverMarkers'))
const RainOverlay = lazy(() => import('./RainOverlay'))
const RainMapOverlay = lazy(() => import('./RainMapOverlay'))

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
  const [rainRequest, setRainRequest] = useState<{ id: string; n: number } | null>(null)
  // True while the route's results no longer match the From and To boxes
  const [routeStale, setRouteStale] = useState(false)
  // Serious items always show. These switches only add the less serious ones.
  const [layers, setLayers] = useState(loadLayerSettings)

  const picking = mode === 'picking'
  // The buttons down the right fade out while a card is open, so they can't cover it
  const cardOpen = useCardOpen(map)

  function showHazard(hazard: RouteHazard) {
    if (!map) return
    // Out of the way of the map, then jump there. Without animation the marker
    // is already in place when its card opens.
    setPanel('collapsed')
    map.setView([hazard.lat, hazard.lng], Math.max(map.getZoom(), 16), { animate: false })
    setOpenRequest({ id: hazard.id, n: Date.now() })
  }

  function showRain(stretch: RainStretch) {
    if (!map || !route) return
    setPanel('collapsed')
    // No animation, so the icon is already in place when its card opens
    map.fitBounds(latLngBounds(rainPath(route, stretch)), { padding: [40, 40], maxZoom: 13, animate: false })
    setRainRequest({ id: stretch.id, n: Date.now() })
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
        <MapLimits island={SRI_LANKA_BOUNDS} limits={SRI_LANKA_LIMITS} />
        <Suspense fallback={null}>
          <RainMapOverlay hidden={picking} showMild={layers.mildRain} />
        </Suspense>
        <Suspense fallback={null}>
          <ReportMarkers
            hidden={picking}
            route={route}
            showPassable={layers.passableReports}
            openRequest={openRequest}
          />
        </Suspense>
        {route && (
          <Suspense fallback={null}>
            <RainOverlay route={route} hidden={picking} outOfDate={routeStale} openRequest={rainRequest} />
          </Suspense>
        )}
        {!picking && (
          <Suspense fallback={null}>
            <RiverMarkers showAll={layers.normalRivers} />
          </Suspense>
        )}
        <LocateButton
          onLocated={setUserLatLng}
          hidden={cardOpen}
          bottomClass={picking ? 'bottom-28' : panel === 'collapsed' ? 'bottom-20' : 'bottom-6'}
        />
      </MapContainer>

      {!picking && (
        <LayerControls
          map={map}
          settings={layers}
          onChange={(name: keyof LayerSettings, value) => {
            setLayers((current) => ({ ...current, [name]: value }))
            saveLayerSetting(name, value)
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
            cardOpen={cardOpen}
          />

          {panel === 'closed' && !picking && (
            <button
              type="button"
              inert={cardOpen}
              onClick={() => {
                setPlannerOpened(true)
                setPanel('open')
              }}
              className={`absolute bottom-[10.5rem] right-4 z-[1000] flex h-14 items-center gap-2 rounded-full bg-white px-5 font-semibold text-blue-700 shadow-lg active:bg-slate-100 ${fadeWhenCardOpen(cardOpen)}`}
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
                onSelectRain={showRain}
                onStaleChange={setRouteStale}
              />
            </Suspense>
          )}
        </>
      )}
    </div>
  )
}
