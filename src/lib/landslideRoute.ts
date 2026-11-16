import booleanIntersects from '@turf/boolean-intersects'
import type { LatLngTuple } from 'leaflet'
import { t } from '../i18n'
import { matchedAreas, officialPdfUrl, pickName, type LandslideArea, type LandslideView, type Level } from './landslide'
import { boxPoints, placeAreas, type Drawn, type ShapeData } from './landslideShapes'
import { sriLankaDateTime } from './time'

// NBRO's landslide warning against a checked route. Which of the warning's DS divisions the route line
// passes through, and what the route panel says about them. No network and no React here, so it can all
// be tested. The areas are placed by the same placeAreas the map draws with, from the same outlines,
// so the route and the map can never disagree about where an area is.

// How the route got on with the outlines:
// 'checking' = they are still loading, 'failed' = they could not be loaded, 'done' = checked
export type RouteStatus = 'checking' | 'failed' | 'done'

export type RouteLandslide =
  // Nothing to say: no warning, or the newest one has ended
  | { kind: 'none' }
  // The newest warning could not be read. An older one is never put in its place.
  | { kind: 'unreadable'; pdfUrl: string | null }
  | {
      kind: 'active'
      status: RouteStatus
      validTo: number
      pdfUrl: string | null
      // The divisions the route passes through, by level (empty until `status` is 'done')
      level3: Drawn[]
      level2: Drawn[]
      level1: Drawn[]
      // Names in the warning that a route can't be checked against: no match to a division, or a
      // division the boundary file doesn't have
      unchecked: LandslideArea[]
    }

// ---- Does the route pass through an area? ----

type Line = [number, number][]

// south, west, north, east
function boxOf(line: Line): [number, number, number, number] {
  let south = 90
  let west = 180
  let north = -90
  let east = -180
  for (const [lng, lat] of line) {
    south = Math.min(south, lat)
    north = Math.max(north, lat)
    west = Math.min(west, lng)
    east = Math.max(east, lng)
  }
  return [south, west, north, east]
}

// True when the route line has a point inside the outline, or crosses its edge. The outlines are
// simplified to about 200 m, so a road that runs within a couple of hundred metres of an edge can fall
// either side of it. That is the file's accuracy and is not made up for here. A line that only
// touches an edge counts, which is the safe side.
export function routePassesThrough(line: Line, drawn: Drawn, box = boxOf(line)): boolean {
  if (line.length < 2) return false
  const [[south, west], [north, east]] = drawn.box
  // Most areas are nowhere near the route: skip the exact check for them
  if (box[2] < south || box[0] > north || box[3] < west || box[1] > east) return false
  return booleanIntersects({ type: 'LineString', coordinates: line }, drawn.geometry)
}

export type Passed = { level3: Drawn[]; level2: Drawn[]; level1: Drawn[] }

export function areasOnRoute(line: Line, drawn: Drawn[]): Passed {
  const passed: Passed = { level3: [], level2: [], level1: [] }
  const box = boxOf(line)
  for (const d of drawn) {
    if (!routePassesThrough(line, d, box)) continue
    passed[d.area.level === 3 ? 'level3' : d.area.level === 2 ? 'level2' : 'level1'].push(d)
  }
  return passed
}

// ---- What the route panel is told ----

// The route's outlines are only downloaded when a route is on screen and the newest warning is valid and
// has a name that can be matched to a division. Level 1 counts too: the route's Watch note shows whatever
// the Layers switch says, because it is about the route and not about the map.
export function wantsOutlines(view: LandslideView | null, hasRoute: boolean): boolean {
  return hasRoute && view?.kind === 'active' && matchedAreas(view.warning.areas).length > 0
}

type Outlines = { data: ShapeData | undefined; failed: boolean }

export function landslideOnRoute(view: LandslideView | null, line: Line | null, outlines: Outlines): RouteLandslide {
  if (!line || !view || view.kind === 'none') return { kind: 'none' }
  if (view.kind === 'unreadable') return { kind: 'unreadable', pdfUrl: officialPdfUrl(view.pdfUrl) }

  const { areas, validTo, pdfUrl } = view.warning
  const base = { kind: 'active' as const, validTo, pdfUrl: officialPdfUrl(pdfUrl) }
  const none: Passed = { level3: [], level2: [], level1: [] }
  const unmatched = areas.filter((a) => a.code === null)

  // Only unmatched names: nothing to download, and nothing the route can be checked against
  if (unmatched.length === areas.length) return { ...base, status: 'done', ...none, unchecked: unmatched }
  if (!outlines.data) {
    return { ...base, status: outlines.failed ? 'failed' : 'checking', ...none, unchecked: unmatched }
  }
  const placed = placeAreas(areas, outlines.data)
  return { ...base, status: 'done', ...areasOnRoute(line, placed.drawn), unchecked: placed.notDrawn }
}

// The areas that count as hazards on the route, like a river at Alert or above: Level 3 and Level 2.
// Level 1 (Watch) is a soft note and is never counted.
export const seriousAreas = (r: RouteLandslide): Drawn[] => (r.kind === 'active' ? [...r.level3, ...r.level2] : [])
export const worstLevel = (r: RouteLandslide): 3 | 2 | null => {
  if (r.kind !== 'active') return null
  return r.level3.length > 0 ? 3 : r.level2.length > 0 ? 2 : null
}

// Corners to fit the map to, for the areas of these levels the route passes through
export const pointsFor = (areas: Drawn[]): LatLngTuple[] => boxPoints(areas, [1, 2, 3])

// ---- Words ----

// Long lists are cut so a Watch warning that names a dozen divisions can't fill the panel. The rest are
// on the map ("Show on map") and in the PDF.
export const MAX_NAMES = 8

export function listNames(names: string[]): string {
  if (names.length <= MAX_NAMES) return names.join(', ')
  return t('route.landslide.namesMore', { names: names.slice(0, MAX_NAMES).join(', '), count: names.length - MAX_NAMES })
}

const divisionNames = (areas: Drawn[]) => listNames(areas.map((d) => pickName(d.names.division, d.area.name)))
// Names as the warning printed them, with their district, for the ones that can't be checked
const printedNames = (areas: LandslideArea[]) => listNames(areas.map((a) => `${a.name} (${a.district})`))

export type PassLine = { level: Level; text: string; areas: Drawn[] }

export type RouteLandslideLines =
  | { kind: 'none' }
  | { kind: 'unreadable'; text: string; pdfUrl: string | null }
  | {
      kind: 'active'
      // Level 3 first, then Level 2: serious items, counted
      items: PassLine[]
      // The soft Level 1 note, not counted
      watch: PassLine | null
      // Said under the items: "Valid until ...", "Source: NBRO via DMC", and the official PDF
      validUntil: string
      source: string
      pdfUrl: string | null
      // "Some named areas couldn't be checked ..." when the warning has any
      unchecked: string | null
      // Outlines still loading, or they could not be loaded (so nothing could be checked)
      checking: string | null
      failed: string | null
    }

export function routeLandslideLines(r: RouteLandslide): RouteLandslideLines {
  if (r.kind === 'none') return { kind: 'none' }
  if (r.kind === 'unreadable') return { kind: 'unreadable', text: t('route.landslide.unreadable'), pdfUrl: r.pdfUrl }

  const line = (level: Level, areas: Drawn[]): PassLine | null =>
    areas.length === 0 ? null : { level, areas, text: t(`route.landslide.passes${level}`, { count: areas.length, names: divisionNames(areas) }) }
  const items = [line(3, r.level3), line(2, r.level2)].filter((l): l is PassLine => l !== null)
  return {
    kind: 'active',
    items,
    watch: line(1, r.level1),
    validUntil: t('landslide.validUntil', { when: sriLankaDateTime(r.validTo) }),
    source: t('landslide.source'),
    pdfUrl: r.pdfUrl,
    unchecked: r.unchecked.length > 0 ? t('route.landslide.unchecked', { names: printedNames(r.unchecked) }) : null,
    checking: r.status === 'checking' ? t('route.landslide.checking') : null,
    failed: r.status === 'failed' ? t('route.landslide.failed') : null,
  }
}

// Whether the route panel has anything to say about landslides (the section is left out otherwise)
export function hasLandslideLines(lines: RouteLandslideLines): boolean {
  if (lines.kind === 'none') return false
  if (lines.kind === 'unreadable') return true
  return lines.items.length > 0 || lines.watch !== null || lines.unchecked !== null || lines.checking !== null || lines.failed !== null
}
