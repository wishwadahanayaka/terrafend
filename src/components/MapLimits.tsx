import { useEffect } from 'react'
import { useMap } from 'react-leaflet'
import { latLngBounds, type LatLngBoundsLiteral } from 'leaflet'
import { POPUP_EDGE_GAP, POPUP_PADDING, popupContentMax, popupTotalWidth } from '../lib/popupPadding'

// A card opens centred on its marker. For markers on the coast, the map has to be
// able to show this much sea beside them, or the card hangs off the screen edge.
const WEST_COAST_LNG = 79.8
const EAST_COAST_LNG = 81.8
// The northernmost river gauge (Ma Oya at Yaka Wewa)
const NORTH_REF_LAT = 8.73
// A tall river card on a phone (the forecast box makes them tallest), in pixels
const TALL_CARD = 340
// From the bottom of a card down to its marker: the tip and the marker's popup anchor
const CARD_TO_MARKER = 41

type Props = {
  island: LatLngBoundsLiteral
  // The least sea margin around the island
  limits: LatLngBoundsLiteral
}

// Stops zooming out past the point where the whole island just fits the screen.
// That zoom depends on the screen size, so it's worked out again whenever the
// map is resized (window resize, phone rotation). The sea margin to the left and
// right is sized the same way, and the card width follows the screen too.
export default function MapLimits({ island, limits }: Props) {
  const map = useMap()

  useEffect(() => {
    const base = latLngBounds(limits)

    function update() {
      const size = map.getSize()
      if (size.x === 0 || size.y === 0) return

      // Leaflet pulls the view back in range itself if the current zoom is now too low
      map.setMinZoom(map.getBoundsZoom(island))

      // Read by the card CSS in index.css
      map.getContainer().style.setProperty('--popup-content-max', `${popupContentMax(size.x)}px`)

      // At the furthest zoom-out, a degree of longitude is this many pixels wide.
      // A card needs half its width plus a gap between its marker and the screen edge.
      const zoom = map.getMinZoom()
      const pixelsPerDegree = (256 * 2 ** zoom) / 360
      const room = (popupTotalWidth(size.x) / 2 + POPUP_EDGE_GAP) / pixelsPerDegree

      // Same idea for the north: a card opens above its marker, so the northernmost
      // gauge has to be able to sit this far down the screen. Measured in pixels
      // from the top of the screen, then turned back into a latitude.
      const markerY = POPUP_PADDING.autoPanPaddingTopLeft[1] + TALL_CARD + CARD_TO_MARKER
      const ref = map.project([NORTH_REF_LAT, 80.7], zoom)
      const north = map.unproject([ref.x, ref.y - markerY], zoom).lat

      map.setMaxBounds(
        latLngBounds(
          [base.getSouth(), Math.min(base.getWest(), WEST_COAST_LNG - room)],
          [Math.max(base.getNorth(), north), Math.max(base.getEast(), EAST_COAST_LNG + room)],
        ),
      )
    }

    update()
    map.on('resize', update)
    return () => {
      map.off('resize', update)
    }
  }, [map, island, limits])

  return null
}
