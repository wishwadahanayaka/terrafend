import type { LatLngBoundsLiteral } from 'leaflet'

// Fitting to bounds instead of a fixed zoom keeps the island filling the screen on any size
export const SRI_LANKA_BOUNDS: LatLngBoundsLiteral = [
  [5.85, 79.6],
  [9.9, 81.95],
]

// The island plus a margin of sea. The map can't be dragged outside this, except
// that MapLimits widens it left and right on narrow screens to make room for cards.
// "Is this person in Sri Lanka" checks use this fixed box, not the widened one.
export const SRI_LANKA_LIMITS: LatLngBoundsLiteral = [
  [5.55, 79.3],
  [10.2, 82.25],
]

export type BoxBounds = { minLng: number; minLat: number; maxLng: number; maxLat: number }

// Rounds to 2 decimals (about 1 km), so tiny pans reuse the same cached query. Rounds
// outward (min down, max up) so the box never shrinks: plain rounding can collapse a
// zoomed-in view into a zero-width box that finds nothing.
export function roundOutward(b: BoxBounds): BoxBounds {
  const down = (n: number) => Math.floor(n * 100) / 100
  const up = (n: number) => Math.ceil(n * 100) / 100
  return { minLng: down(b.minLng), minLat: down(b.minLat), maxLng: up(b.maxLng), maxLat: up(b.maxLat) }
}
