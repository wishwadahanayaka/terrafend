import { lazy, Suspense, useState } from 'react'
import { MapContainer, TileLayer } from 'react-leaflet'
import { Route as RouteIcon } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { latLngBounds, type LatLng, type Map as LeafletMap } from 'leaflet'
import { BUTTON_COLUMN_PX, SRI_LANKA_BOUNDS, SRI_LANKA_LIMITS } from '../lib/mapBounds'
import { fadeWhenCardOpen, useCardOpen } from '../lib/useCardOpen'
import { useNotice } from '../lib/useNotice'
import { useOnline } from '../lib/useOnline'
import { loadLayerSettings, saveLayerSetting, type LayerSettings } from '../lib/layerSettings'
import type { RouteHazard } from '../lib/useRoute'
import { reportStatus, type MyReportRow } from '../lib/myReportsList'
import { rainPath, type RainStretch } from '../lib/rainForecast'
import type { RouteResult } from '../lib/routing'
import LocateButton from './LocateButton'
import MapLimits from './MapLimits'
import ReportFlow, { type ReportMode } from './ReportFlow'
import LayerControls from './LayerControls'
import Notice from './Notice'
import type { PanelState } from './RoutePlanner'

// The data code (Supabase, hazards, the route planner) loads after the map
// has appeared, so the first screen shows up sooner
const ReportMarkers = lazy(() => import('./ReportMarkers'))
const RoutePlanner = lazy(() => import('./RoutePlanner'))
const RiverMarkers = lazy(() => import('./RiverMarkers'))
const RainOverlay = lazy(() => import('./RainOverlay'))
const RainMapOverlay = lazy(() => import('./RainMapOverlay'))
const MeasuredRainMarkers = lazy(() => import('./MeasuredRainMarkers'))
const GdacsMarkers = lazy(() => import('./GdacsMarkers'))
const MyReportsPanel = lazy(() => import('./MyReportsPanel'))

export default function HazardMap({ onOpenEmergency }: { onOpenEmergency: () => void }) {
  // The report and route UI sit outside MapContainer so touches in them don't pan the map
  const [map, setMap] = useState<LeafletMap | null>(null)
  const [userLatLng, setUserLatLng] = useState<LatLng | null>(null)
  const [mode, setMode] = useState<ReportMode>('idle')
  const [myReportsOpen, setMyReportsOpen] = useState(false)

  const [panel, setPanel] = useState<PanelState>('closed')
  const [route, setRoute] = useState<RouteResult | null>(null)
  // A reroute around blocked roads, on offer until it's used or dismissed
  const [alternative, setAlternative] = useState<RouteResult | null>(null)
  // The planner keeps the From and To boxes, so once it has been opened it stays loaded
  const [plannerOpened, setPlannerOpened] = useState(false)
  const [openRequest, setOpenRequest] = useState<{ id: string; n: number } | null>(null)
  const [rainRequest, setRainRequest] = useState<{ id: string; n: number } | null>(null)
  // True while the route's results no longer match the From and To boxes
  const [routeStale, setRouteStale] = useState(false)
  // Serious items always show. These switches only add the less serious ones.
  const [layers, setLayers] = useState(loadLayerSettings)

  const { t } = useTranslation()
  const online = useOnline()
  const [notice, showNotice] = useNotice()

  const picking = mode === 'picking'
  // The buttons down the right fade out while a card is open, so they can't cover it
  const cardOpen = useCardOpen(map)

  // Opening the route panel closes any open map card, so the two never sit on screen together.
  // (Collapsing it, or showing a hazard from it, leaves cards alone: showing one opens its card.)
  function changePanel(next: PanelState) {
    if (next === 'open') map?.closePopup()
    setPanel(next)
  }

  function showHazard(hazard: RouteHazard) {
    if (!map) return
    // Out of the way of the map, then jump there. Without animation the marker
    // is already in place when its card opens.
    setPanel('collapsed')
    map.setView([hazard.lat, hazard.lng], Math.max(map.getZoom(), 16), { animate: false })
    setOpenRequest({ id: hazard.id, n: Date.now() })
  }

  // Tapping one of your own reports: close the list and fly there. An active report's card
  // opens when the flight ends (a cleared one is no longer on the map, so only the place shows).
  function showMine(row: MyReportRow) {
    setMyReportsOpen(false)
    if (!map) return
    if (panel === 'open') setPanel('collapsed')
    map.flyTo([row.lat, row.lng], Math.max(map.getZoom(), 16), { duration: 0.8 })
    if (reportStatus(row, Date.now()) === 'active') {
      map.once('moveend', () => setOpenRequest({ id: row.id, n: Date.now() }))
    }
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
        boundsOptions={{ paddingBottomRight: [BUTTON_COLUMN_PX, 0] }}
        maxBoundsViscosity={1}
        zoomSnap={0.25}
        zoomControl={false}
        className="h-full w-full"
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
          // A tile asked for this way can be kept by the service worker. Without it the
          // answer is opaque and can't be checked or stored safely.
          crossOrigin="anonymous"
        />
        <MapLimits island={SRI_LANKA_BOUNDS} limits={SRI_LANKA_LIMITS} />
        <Suspense fallback={null}>
          <RainMapOverlay hidden={picking} showMild={layers.mildRain} />
        </Suspense>
        <Suspense fallback={null}>
          <ReportMarkers
            hidden={picking}
            route={route}
            alternative={alternative}
            showPassable={layers.passableReports}
            openRequest={openRequest}
          />
        </Suspense>
        {route && (
          <Suspense fallback={null}>
            {/* Faded while a reroute is on offer, since its colours belong to the grey original */}
            <RainOverlay
              route={route}
              hidden={picking}
              outOfDate={routeStale || alternative !== null}
              openRequest={rainRequest}
            />
          </Suspense>
        )}
        {!picking && (
          <Suspense fallback={null}>
            <RiverMarkers showAll={layers.normalRivers} />
          </Suspense>
        )}
        {!picking && (
          <Suspense fallback={null}>
            <GdacsMarkers showGreen={layers.greenAlerts} />
          </Suspense>
        )}
        {!picking && (
          <Suspense fallback={null}>
            <MeasuredRainMarkers showMild={layers.mildRain} />
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
          onOpenMyReports={() => setMyReportsOpen(true)}
          onOpenEmergency={onOpenEmergency}
          onChange={(name: keyof LayerSettings, value) => {
            setLayers((current) => ({ ...current, [name]: value }))
            saveLayerSetting(name, value)
          }}
        />
      )}

      <Notice message={notice} />

      {myReportsOpen && (
        <Suspense fallback={null}>
          <MyReportsPanel onClose={() => setMyReportsOpen(false)} onShow={showMine} />
        </Suspense>
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
            offline={!online}
            onOfflineTap={() => showNotice(t('offline.report'))}
            showPassable={layers.passableReports}
          />

          {panel === 'closed' && !picking && (
            <button
              type="button"
              inert={cardOpen}
              onClick={() => {
                // Offline, a route already checked can still be opened and read. A new
                // one can't be checked.
                if (!online && !route) {
                  showNotice(t('offline.route'))
                  return
                }
                setPlannerOpened(true)
                changePanel('open')
              }}
              aria-disabled={!online && !route}
              aria-label={t('route.title')}
              title={t('route.title')}
              className={`absolute bottom-[10.5rem] right-4 z-[1000] flex h-14 w-14 items-center justify-center rounded-full shadow-lg ${!online && !route ? 'bg-slate-200 text-slate-500' : 'bg-white text-blue-700 active:bg-slate-100'} ${fadeWhenCardOpen(cardOpen)}`}
            >
              <RouteIcon className="h-7 w-7" aria-hidden="true" />
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
                onPanelChange={changePanel}
                route={route}
                onRouteChange={setRoute}
                alternative={alternative}
                onAlternativeChange={setAlternative}
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
