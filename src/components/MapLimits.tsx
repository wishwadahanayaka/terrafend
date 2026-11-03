import { useEffect } from 'react'
import { useMap } from 'react-leaflet'
import type { LatLngBoundsExpression } from 'leaflet'

// Stops zooming out past the point where the whole island just fits the screen.
// That zoom depends on the screen size, so it's worked out again whenever the
// map is resized (window resize, phone rotation).
export default function MapLimits({ island }: { island: LatLngBoundsExpression }) {
  const map = useMap()

  useEffect(() => {
    function updateMinZoom() {
      const size = map.getSize()
      if (size.x === 0 || size.y === 0) return
      // Leaflet pulls the view back in range itself if the current zoom is now too low
      map.setMinZoom(map.getBoundsZoom(island))
    }
    updateMinZoom()
    map.on('resize', updateMinZoom)
    return () => {
      map.off('resize', updateMinZoom)
    }
  }, [map, island])

  return null
}
