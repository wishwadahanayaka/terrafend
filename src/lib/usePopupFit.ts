import { useEffect, useMemo, useRef } from 'react'
import { useMap } from 'react-leaflet'
import { latLngBounds, LatLngBounds, point, type Map as LeafletMap, type Marker, type Popup, type PopupEvent } from 'leaflet'

// Just fully on screen. Leaflet also nudges the card clear of the buttons when there's room.
const SCREEN_GAP = 8

// The map can only move within its maxBounds, so near the coast a card may not be
// able to get fully on screen. Works out whether the pan Leaflet is about to do
// (to bring the card into view) is possible.
function canFit(map: LeafletMap, popup: Popup, element: HTMLElement): boolean {
  const view = map.getContainer().getBoundingClientRect()
  const box = element.getBoundingClientRect()
  // The gap under the card holds its tip
  const tip = parseInt(getComputedStyle(element).marginBottom, 10) || 0
  const left = box.left - view.left
  const right = box.right - view.left
  const top = box.top - view.top
  const bottom = box.bottom - view.top + tip

  const size = map.getSize()
  const topLeft = point(popup.options.autoPanPaddingTopLeft ?? [0, 0])
  const bottomRight = point(popup.options.autoPanPaddingBottomRight ?? [0, 0])

  // How far the view has to move (right and down are positive) to show the whole card.
  // A card bigger than the screen can't be fixed by moving or zooming, so it's left alone.
  let dx = 0
  if (right - left <= size.x - 2 * SCREEN_GAP) {
    if (right > size.x - SCREEN_GAP) dx = right - (size.x - SCREEN_GAP)
    if (left - dx < SCREEN_GAP) dx = left - SCREEN_GAP
  }
  let dy = 0
  if (bottom - top <= size.y - topLeft.y - bottomRight.y) {
    if (bottom + bottomRight.y > size.y) dy = bottom - size.y + bottomRight.y
    if (top - dy - topLeft.y < 0) dy = top - topLeft.y
  }
  if (dx === 0 && dy === 0) return true

  // The view may only move until its edge reaches the edge of maxBounds
  const set = map.options.maxBounds
  if (!set) return true
  const limits = set instanceof LatLngBounds ? set : latLngBounds(set)
  const nw = map.latLngToContainerPoint(limits.getNorthWest())
  const se = map.latLngToContainerPoint(limits.getSouthEast())
  const reachable = (need: number, low: number, high: number) =>
    need === 0 || (low <= high && need >= low - 1 && need <= high + 1)
  return reachable(dx, nw.x, se.x - size.x) && reachable(dy, nw.y, se.y - size.y)
}

// Maps that have a card closed for a moment, to zoom in before it reopens
const zooming = new WeakSet<LeafletMap>()

export function isCardZooming(map: LeafletMap): boolean {
  return zooming.has(map)
}

type Open = { marker: Marker; popup: Popup }

// idle: nothing special. zooming: a card was closed to zoom in and will reopen.
// reopened: the card is open again after zooming, and isn't checked a second time.
type Phase = 'idle' | 'zooming' | 'reopened'

// Event handlers for a marker that has a card. If the card can't be brought fully on
// screen at this zoom, the map zooms in one step towards the marker and then opens it.
export function usePopupFit() {
  const map = useMap()
  const open = useRef<Open | null>(null)
  const phase = useRef<Phase>('idle')

  // Leaflet fires this just before it pans to bring a card into view. By then the card
  // has its size. The first time a card opens, react-leaflet adds its contents a moment
  // after Leaflet opens it, so an event before the contents exist is skipped.
  useEffect(() => {
    function checkFit() {
      const current = open.current
      if (!current || phase.current !== 'idle') return
      const element = current.popup.getElement()
      if (!element?.querySelector('.leaflet-popup-content')?.firstChild) return
      if (canFit(map, current.popup, element)) return
      if (map.getZoom() >= map.getMaxZoom()) return

      phase.current = 'zooming'
      // Waits a moment, because Leaflet starts its own pan as soon as this handler returns
      window.setTimeout(() => {
        zooming.add(map)
        current.marker.closePopup()
        // animate: true because Leaflet skips a zoom animation when the marker is
        // far from the centre, and then no zoomend would tell us when to reopen
        map.setView(current.marker.getLatLng(), map.getZoom() + (map.options.zoomDelta ?? 1), { animate: true })
        map.once('zoomend', () => {
          phase.current = 'reopened'
          zooming.delete(map)
          current.marker.openPopup()
        })
      }, 0)
    }
    map.on('autopanstart', checkFit)
    return () => {
      map.off('autopanstart', checkFit)
    }
  }, [map])

  return useMemo(
    () => ({
      popupopen(e: PopupEvent) {
        open.current = { marker: e.target as Marker, popup: e.popup }
      },
      popupclose() {
        // Closing to zoom in doesn't count: the card comes back
        if (phase.current === 'zooming') return
        open.current = null
        phase.current = 'idle'
      },
    }),
    [],
  )
}
