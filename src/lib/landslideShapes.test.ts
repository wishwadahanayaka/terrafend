import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { gzipSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { districtNamesOf } from '../../scripts/district-names.mjs'
import { SHAPES_CACHE_NAME, SHAPES_CHUNK_GLOB, SHAPES_CHUNK_PREFIX } from './tileCache'
import { fakeLandslideAnswer } from './fakeLandslide'
import { areaStyle, type LandslideArea } from './landslide'
import { boxPoints, loadShapes, placeAreas, type ShapeData } from './landslideShapes'

// Putting the areas on the map, and loading the outlines only when they are needed.

const ROOT = join(__dirname, '..', '..')
const read = (...parts: string[]) => readFileSync(join(ROOT, ...parts), 'utf8')
const ds = JSON.parse(read('src', 'data', 'areas', 'ds.json'))
const districts = JSON.parse(read('src', 'data', 'areas', 'districts.json'))
const districtNames = JSON.parse(read('src', 'data', 'areas', 'district-names.json'))
const data = { ds, districtNames } as ShapeData
const NOW = Date.parse('2026-11-15T10:00:00Z')

const areasOf = (mode: Parameters<typeof fakeLandslideAnswer>[0]): LandslideArea[] => {
  const answer = fakeLandslideAnswer(mode, NOW)
  if (!answer.found || !answer.parseOk) throw new Error('not readable')
  return answer.areas
}

describe('placing the areas', () => {
  it('draws every matched area from its real outline, in Leaflet’s order (latitude first), inside Sri Lanka', () => {
    const { drawn, notDrawn } = placeAreas(areasOf('mixed'), data)
    expect(drawn).toHaveLength(11)
    expect(notDrawn).toEqual([])
    for (const d of drawn) {
      expect(d.positions.length).toBeGreaterThan(0)
      for (const [lat, lng] of d.positions.flat(2)) {
        expect(lat).toBeGreaterThan(5.5)
        expect(lat).toBeLessThan(10)
        expect(lng).toBeGreaterThan(79)
        expect(lng).toBeLessThan(82.2)
      }
      const [[south, west], [north, east]] = d.box
      expect(south).toBeLessThan(north)
      expect(west).toBeLessThan(east)
    }
  })

  it('draws the lowest level first, so a heavier area is on top', () => {
    const { drawn } = placeAreas(areasOf('mixed'), data)
    const levels = drawn.map((d) => d.area.level)
    expect(levels).toEqual([...levels].sort((a, b) => a - b))
    expect(levels[0]).toBe(1)
    expect(levels[levels.length - 1]).toBe(3)
  })

  it('carries the names in three languages for the card', () => {
    const aranayake = placeAreas(areasOf('level3'), data).drawn.find((d) => d.area.name === 'Aranayake')!
    expect(aranayake.names.division).toMatchObject({ en: 'Aranayake' })
    expect(aranayake.names.division.si).toBeTruthy()
    expect(aranayake.names.division.ta).toBeTruthy()
    expect(aranayake.names.district).toMatchObject({ en: 'Kegalle' })
  })

  it('never draws a name that has no match, and never drops it: it comes back as text', () => {
    const areas = areasOf('unmatched')
    const { drawn, notDrawn } = placeAreas(areas, data)
    expect(notDrawn.map((a) => a.name)).toEqual(['Kotmale', 'Nowhereville'])
    expect(drawn.length + notDrawn.length).toBe(areas.length)
  })

  it('keeps a matched name whose outline the file lacks, as text too', () => {
    const areas = areasOf('level3')
    const withoutOne: ShapeData = { ds: { features: ds.features.filter((f: { properties: { code: string } }) => f.properties.code !== 'LK9209') }, districtNames }
    const { drawn, notDrawn } = placeAreas(areas, withoutOne)
    expect(drawn).toHaveLength(2)
    expect(notDrawn.map((a) => a.name)).toEqual(['Aranayake'])
  })

  it('works out the corners for fitting the map to the chip’s levels', () => {
    const { drawn } = placeAreas(areasOf('mixed'), data)
    const points = boxPoints(drawn, [2, 3])
    // 5 areas at Level 2 or 3, two corners each
    expect(points).toHaveLength(10)
    expect(boxPoints(drawn, [])).toEqual([])
  })

  it('a MultiPolygon division is one area with several parts', () => {
    const multi = ds.features.find((f: { geometry: { type: string } }) => f.geometry.type === 'MultiPolygon')
    const area: LandslideArea = { level: 2, district: 'X', name: multi.properties.en, code: multi.properties.code, districtCode: multi.properties.district, shift: 0, added: false, note: null }
    const { drawn } = placeAreas([area], data)
    expect(drawn).toHaveLength(1)
    expect(drawn[0].positions.length).toBe(multi.geometry.coordinates.length)
    expect(areaStyle(2).weight).toBeGreaterThan(0)
  })
})

describe('the district names file', () => {
  it('is the districts file’s names and nothing else, so the two cannot disagree', () => {
    expect(districtNames).toEqual(districtNamesOf(districts))
    expect(Object.keys(districtNames)).toHaveLength(25)
    // small: it goes with the areas, and the 47 KB of district outlines does not
    expect(read('src', 'data', 'areas', 'district-names.json').length).toBeLessThan(4000)
  })
})

describe('loading the outlines only when they are needed', () => {
  const sourceFiles = (dir: string): string[] =>
    readdirSync(dir).flatMap((name) => {
      const path = join(dir, name)
      if (statSync(path).isDirectory()) return name === 'locales' ? [] : sourceFiles(path)
      return /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : []
    })
  const files = sourceFiles(join(ROOT, 'src')).map((path) => ({ path: path.split('src')[1], code: readFileSync(path, 'utf8') }))

  it('the boundary file is imported by one file only, which nothing imports except through a dynamic import()', () => {
    const importers = files.filter((f) => /from\s+['"][^'"]*ds\.json['"]/.test(f.code)).map((f) => f.path.replace(/\\/g, '/'))
    expect(importers).toEqual(['/data/areas/dsAreas.ts'])
    for (const f of files) expect(f.code, f.path).not.toMatch(/from\s+['"][^'"]*(dsAreas|districts\.json)['"]/)
    const dynamic = files.filter((f) => /import\(\s*['"][^'"]*dsAreas['"]\s*\)/.test(f.code)).map((f) => f.path.replace(/\\/g, '/'))
    expect(dynamic).toEqual(['/lib/landslideShapes.ts'])
  })

  it('asks for the outlines only from the map layer, and only when a valid warning has something to draw', () => {
    const layer = read('src', 'components', 'LandslideLayer.tsx')
    // a valid Level 2 or 3 area, or a valid Level 1 area with the switch on (areasToDraw)
    expect(layer).toContain('const wanted = warning !== null && areasToDraw(warning.areas, enabled).length > 0')
    expect(layer).toContain('useLandslideShapes(wanted)')
    expect(layer).toContain("view?.kind === 'active'")
    // the chip and the status line only read what is there. The route check asks too, but only through
    // useRouteLandslide (`wanted`: a route on screen and a valid warning, see landslideRoute.test.ts).
    // Everything else only reads what is there.
    for (const file of [join('src', 'lib', 'useThreats.ts'), join('src', 'components', 'LandslideStatus.tsx')]) {
      expect(read(file), file).toContain('useLandslideShapes(false)')
    }
    const everyone = files.filter((f) => /useLandslideShapes\((?!false\)|wanted\))/.test(f.code) && !/export function useLandslideShapes/.test(f.code))
    expect(everyone.map((f) => f.path)).toEqual([])
  })

  it('the hook that loads them is a query that waits for `enabled`, and keeps the answer', () => {
    const hook = read('src', 'lib', 'useLandslide.ts')
    expect(hook).toMatch(/useLandslideShapes\(enabled: boolean\)[\s\S]*queryFn: loadShapes,\s*enabled,/)
    expect(hook).toContain('staleTime: Infinity')
  })

  it('is a dynamic import that gives the whole boundary file and the district names', async () => {
    const loaded = await loadShapes()
    expect(loaded.ds.features).toHaveLength(339)
    expect(Object.keys(loaded.districtNames)).toHaveLength(25)
  })

  it('the layer and its legend are lazy parts of the map, and the switch is not in the address', () => {
    const map = read('src', 'components', 'HazardMap.tsx')
    expect(map).toContain("lazy(() => import('./LandslideLayer'))")
    expect(map).toContain("lazy(() => import('./LandslideLegend'))")
    expect(map).not.toMatch(/URLSearchParams|location\.search/)
    expect(map).toContain('enabled={layers.landslides}')
  })

  it('the file is kept by the service worker the first time it is used, and is not part of the install', () => {
    const config = read('vite.config.ts')
    expect(config).toContain('globIgnores: [SHAPES_CHUNK_GLOB]')
    expect(config).toContain('SHAPES_CHUNK_PREFIX')
    expect(config).toMatch(/cacheName: SHAPES_CACHE_NAME,\s*expiration: \{ maxEntries: 2 \},\s*cacheableResponse: \{ statuses: \[200\] \}/)
    expect(SHAPES_CHUNK_PREFIX).toBe('/assets/dsAreas-')
    expect(SHAPES_CHUNK_GLOB).toBe('**/dsAreas-*.js')
    expect(SHAPES_CACHE_NAME).toBe('terrafend-landslide-areas')
    // the built chunk is named after dsAreas.ts, which is the only file with that name
    expect(files.filter((f) => /dsAreas/.test(f.path)).map((f) => f.path.replace(/\\/g, '/'))).toEqual(['/data/areas/dsAreas.ts'])
  })

  it('stays under the size the plan allowed (gzipped)', () => {
    const size = gzipSync(readFileSync(join(ROOT, 'src', 'data', 'areas', 'ds.json')), { level: 9 }).length + gzipSync(read('src', 'data', 'areas', 'district-names.json')).length
    expect(size).toBeLessThan(150 * 1024)
  })
})
