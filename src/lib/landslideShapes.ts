import type { LatLngTuple } from 'leaflet'
import type { LandslideArea, Level } from './landslide'

// Putting the warning's areas on the map: finding each matched DS division's outline in the boundary
// file. The file itself (src/data/areas/ds.json, 134 KB gzipped) is loaded by loadShapes, only when
// the layer is on and there is a warning to draw, as a chunk of its own.

type Named = { en: string; si: string; ta: string }

export type Feature = {
  properties: { code: string; district: string } & Named
  geometry: { type: 'Polygon'; coordinates: number[][][] } | { type: 'MultiPolygon'; coordinates: number[][][][] }
}
export type ShapeData = {
  ds: { features: Feature[] }
  districtNames: Record<string, Named>
}

// A dynamic import, and the only way the app reaches the file
export async function loadShapes(): Promise<ShapeData> {
  const module = await import('../data/areas/dsAreas')
  return module.default as unknown as ShapeData
}

export type Drawn = {
  area: LandslideArea
  names: { division: Named; district: Named | undefined }
  // Leaflet's order (latitude, longitude), one entry per part of the division, each a list of rings
  positions: LatLngTuple[][][]
  // south-west and north-east corners
  box: [LatLngTuple, LatLngTuple]
  // The outline as the file has it (longitude first), for checking a route against it
  geometry: Feature['geometry']
}

const flip = ([lng, lat]: number[]): LatLngTuple => [lat, lng]

function partsOf(feature: Feature): number[][][][] {
  return feature.geometry.type === 'Polygon' ? [feature.geometry.coordinates] : feature.geometry.coordinates
}

function drawnFor(area: LandslideArea, feature: Feature, data: ShapeData): Drawn {
  const positions = partsOf(feature).map((part) => part.map((ring) => ring.map(flip)))
  let south = 90
  let west = 180
  let north = -90
  let east = -180
  for (const [lat, lng] of positions.flat(2)) {
    south = Math.min(south, lat)
    north = Math.max(north, lat)
    west = Math.min(west, lng)
    east = Math.max(east, lng)
  }
  return {
    area,
    names: { division: feature.properties, district: data.districtNames[feature.properties.district] },
    positions,
    box: [[south, west], [north, east]],
    geometry: feature.geometry,
  }
}

// The areas that can be drawn (lowest level first, so the heavier ones are on top) and the ones that
// can't: names with no match, and matched ones whose code the boundary file doesn't have. Those are
// listed as text. Nothing is dropped.
export function placeAreas(areas: LandslideArea[], data: ShapeData): { drawn: Drawn[]; notDrawn: LandslideArea[] } {
  const byCode = new Map(data.ds.features.map((f) => [f.properties.code, f]))
  const drawn: Drawn[] = []
  const notDrawn: LandslideArea[] = []
  for (const area of areas) {
    const feature = area.code ? byCode.get(area.code) : undefined
    if (feature) drawn.push(drawnFor(area, feature, data))
    else notDrawn.push(area)
  }
  drawn.sort((a, b) => a.area.level - b.area.level)
  return { drawn, notDrawn }
}

// The corners of the boxes round the areas of these levels, for fitting the map to them
export function boxPoints(drawn: Drawn[], levels: Level[]): LatLngTuple[] {
  return drawn.filter((d) => levels.includes(d.area.level)).flatMap((d) => d.box)
}
