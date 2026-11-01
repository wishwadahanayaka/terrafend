import { useState } from 'react'
import { MapContainer, TileLayer } from 'react-leaflet'
import type { LatLng, LatLngBoundsExpression, Map as LeafletMap } from 'leaflet'
import { useRouteHazards, type RouteHazard } from '../lib/useRoute'
import type { RouteResult } from '../lib/routing'
import LocateButton from './LocateButton'
import ReportMarkers from './ReportMarkers'
import ReportFlow, { type ReportMode } from './ReportFlow'
import RoutePlanner, { type PanelState } from './RoutePlanner'

// Fitting to bounds instead of a fixed zoom keeps the island filling the screen on any size
const SRI_LANKA_BOUNDS: LatLngBoundsExpression = [
  [5.85, 79.6],
  [9.9, 81.95],
]

export default function HazardMap() {
  // The report and route UI sit outside MapContainer so touches in them don't pan the map
  const [map, setMap] = useState<LeafletMap | null>(null)
  const [userLatLng, setUserLatLng] = useState<LatLng | null>(null)
  const [mode, setMode] = useState<ReportMode>('idle')

  const [panel, setPanel] = useState<PanelState>('closed')
  const [route, setRoute] = useState<RouteResult | null>(null)
  const [openRequest, setOpenRequest] = useState<{ id: string; n: number } | null>(null)
  const hazards = useRouteHazards(route)

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
        zoomSnap={0.25}
        zoomControl={false}
        className="h-full w-full"
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <ReportMarkers hidden={picking} extra={hazards.data ?? []} openRequest={openRequest} />
        <LocateButton
          onLocated={setUserLatLng}
          bottomClass={picking ? 'bottom-28' : panel === 'collapsed' ? 'bottom-20' : 'bottom-6'}
        />
      </MapContainer>

      {map && (
        <>
          <ReportFlow
            map={map}
            userLatLng={userLatLng}
            mode={mode}
            onModeChange={setMode}
            buttonVisible={panel === 'closed'}
          />
          <RoutePlanner
            map={map}
            userLatLng={userLatLng}
            hidden={picking}
            panel={panel}
            onPanelChange={setPanel}
            route={route}
            onRouteChange={setRoute}
            hazards={hazards}
            onSelectHazard={showHazard}
          />
        </>
      )}
    </div>
  )
}
