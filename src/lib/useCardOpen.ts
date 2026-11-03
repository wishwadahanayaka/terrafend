import { useEffect, useState } from 'react'
import type { Map as LeafletMap } from 'leaflet'
import { isCardZooming } from './usePopupFit'

// True while any map card (river or hazard) is open
export function useCardOpen(map: LeafletMap | null): boolean {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (!map) return
    const opened = () => setOpen(true)
    // A card closed only to zoom in comes straight back, so the buttons stay hidden
    const closed = () => {
      if (!isCardZooming(map)) setOpen(false)
    }
    map.on('popupopen', opened)
    map.on('popupclose', closed)
    return () => {
      map.off('popupopen', opened)
      map.off('popupclose', closed)
    }
  }, [map])

  return open
}

// For the buttons that float over the map. They fade out while a card is open, so
// they can't cover it. Written in full for Tailwind.
export function fadeWhenCardOpen(cardOpen: boolean): string {
  return `transition-opacity duration-200 ${cardOpen ? 'pointer-events-none opacity-0' : 'opacity-100'}`
}
