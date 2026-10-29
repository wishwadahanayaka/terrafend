import { MapContainer, TileLayer } from 'react-leaflet'
import type { LatLngBoundsExpression } from 'leaflet'
import LocateButton from './LocateButton'

// Fitting to bounds instead of a fixed zoom keeps the island filling the screen on any size
const SRI_LANKA_BOUNDS: LatLngBoundsExpression = [
  [5.85, 79.6],
  [9.9, 81.95],
]

export default function HazardMap() {
  return (
    <MapContainer
      bounds={SRI_LANKA_BOUNDS}
      zoomSnap={0.25}
      zoomControl={false}
      className="h-full w-full"
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      <LocateButton />
    </MapContainer>
  )
}
