import { useState } from 'react'
import { MapContainer, TileLayer } from 'react-leaflet'
import type { LatLng, LatLngBoundsExpression, Map as LeafletMap } from 'leaflet'
import LocateButton from './LocateButton'
import ReportMarkers from './ReportMarkers'
import ReportFlow,{ type ReportMode } from './ReportFlow'

// Fitting to bounds instead of a fixed zoom keeps the island filling the screen on any size
const SRI_LANKA_BOUNDS: LatLngBoundsExpression = [
  [5.85, 79.6],
  [9.9, 81.95],
]

export default function HazardMap() {
  // The report UI sits outside MapContainer so touches in the form don't pan the map
  const [map, setMap] = useState<LeafletMap | null>(null)
  const [userLatLng, setUserLatLng] = useState<LatLng | null>(null)
  const [mode, setMode] = useState<ReportMode>('idle')

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
        <ReportMarkers hidden={mode === 'picking'} />
        <LocateButton onLocated={setUserLatLng} raised={mode === 'picking'} />
      </MapContainer>

      {map && (
        <ReportFlow map={map} userLatLng={userLatLng} mode={mode} onModeChange={setMode} />
      )}
    </div>
  )
}
