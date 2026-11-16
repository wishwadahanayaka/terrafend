import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import LandslideRouteSection from '../components/LandslideRouteSection'
import { setLanguage } from '../i18n'
import { fakeLandslideAnswer, resetFakeLandslide, type FakeLandslideMode } from './fakeLandslide'
import { COLOMBO_GALLE, COLOMBO_KANDY, COLOMBO_MAWANELLA, COLOMBO_RATNAPURA, fakeRoute, fakeSearch, KANDY_BADULLA } from './fakeRouting'
import { landslideView, parseLandslide, type LandslideArea, type LandslideView } from './landslide'
import {
  areasOnRoute,
  hasLandslideLines,
  landslideOnRoute,
  listNames,
  MAX_NAMES,
  pointsFor,
  routeLandslideLines,
  routePassesThrough,
  seriousAreas,
  wantsOutlines,
  worstLevel,
  type RouteLandslide,
} from './landslideRoute'
import { placeAreas, type Drawn, type Feature, type ShapeData } from './landslideShapes'

// A checked route against NBRO's landslide warning: which areas it passes through, the level rules, the
// lines the route panel shows, the names that can't be checked, and when the outlines are downloaded.
// Real outlines (ds.json) and the dev sample routes, no network.

const ROOT = join(__dirname, '..', '..')
const read = (...parts: string[]) => readFileSync(join(ROOT, ...parts), 'utf8')
const ds = JSON.parse(read('src', 'data', 'areas', 'ds.json'))
const districtNames = JSON.parse(read('src', 'data', 'areas', 'district-names.json'))
const data = { ds, districtNames } as ShapeData
const NOW = Date.parse('2026-11-15T10:00:00Z')
type Outlines = { data: ShapeData | undefined; failed: boolean }
const GOT: Outlines = { data, failed: false }

type Line = [number, number][]

function viewOf(mode: FakeLandslideMode, now = NOW): LandslideView {
  resetFakeLandslide()
  return landslideView(fakeLandslideAnswer(mode, now), now)
}
const onRoute = (mode: FakeLandslideMode, line: Line | null, outlines: Outlines = GOT): RouteLandslide => landslideOnRoute(viewOf(mode), line, outlines)
const names = (areas: Drawn[]) => areas.map((d) => d.area.name)
const active = (r: RouteLandslide) => {
  if (r.kind !== 'active') throw new Error(`expected an active warning, got ${r.kind}`)
  return r
}

// A square division with a made-up code, for the exact edges
function square(code: string, level: 1 | 2 | 3, [south, west, north, east]: [number, number, number, number]): Drawn {
  const ring = [[west, south], [east, south], [east, north], [west, north], [west, south]]
  const area: LandslideArea = { level, district: 'Test', name: code, code, districtCode: code.slice(0, 4), shift: 0, added: false, note: null }
  return {
    area,
    names: { division: { en: code, si: code, ta: code }, district: undefined },
    positions: [[ring.map(([lng, lat]) => [lat, lng] as [number, number])]],
    box: [[south, west], [north, east]],
    geometry: { type: 'Polygon', coordinates: [ring] },
  }
}

describe('does the route line pass through an area?', () => {
  const box = square('LK1101', 3, [7.0, 80.0, 7.2, 80.2])

  it('yes: the line crosses straight through, with both ends outside', () => {
    expect(routePassesThrough([[79.9, 7.1], [80.3, 7.1]], box)).toBe(true)
  })

  it('yes: the whole line is inside (no edge is crossed)', () => {
    expect(routePassesThrough([[80.05, 7.05], [80.15, 7.15]], box)).toBe(true)
  })

  it('yes: it starts or ends inside, and the other end is out', () => {
    expect(routePassesThrough([[80.1, 7.1], [80.5, 7.1]], box)).toBe(true)
    expect(routePassesThrough([[79.5, 7.1], [80.1, 7.1]], box)).toBe(true)
  })

  it('yes: it clips just a corner', () => {
    expect(routePassesThrough([[79.95, 7.1], [80.05, 7.0]], box)).toBe(true)
  })

  it('no: it passes beside the area, and its bounding box overlaps (a diagonal line past a corner)', () => {
    // Inside the area's box on the map, but the line goes round the corner
    expect(routePassesThrough([[79.8, 7.1], [80.1, 7.4]], box)).toBe(false)
  })

  it('no: it is far away (the quick check against the box alone)', () => {
    expect(routePassesThrough([[81.0, 6.0], [81.2, 6.2]], box)).toBe(false)
    expect(routePassesThrough([[79.0, 7.1], [79.9, 7.1]], box)).toBe(false)
  })

  it('no: a single point is not a route', () => {
    expect(routePassesThrough([[80.1, 7.1]], box)).toBe(false)
    expect(routePassesThrough([], box)).toBe(false)
  })

  it('a line that only touches the edge counts: the safe side', () => {
    expect(routePassesThrough([[79.9, 7.2], [80.3, 7.2]], box)).toBe(true)
  })

  it('works on a division with several parts (a MultiPolygon)', () => {
    const multi = ds.features.find((f: Feature) => f.geometry.type === 'MultiPolygon') as Feature
    const area: LandslideArea = { level: 2, district: 'X', name: multi.properties.en, code: multi.properties.code, districtCode: multi.properties.district, shift: 0, added: false, note: null }
    const { drawn } = placeAreas([area], data)
    // a line through the middle of the box of each part
    const parts = multi.geometry.coordinates as number[][][][]
    for (const part of parts) {
      const [lng, lat] = part[0][0]
      expect(routePassesThrough([[lng - 0.001, lat - 0.001], [lng + 0.001, lat + 0.001]], drawn[0])).toBe(true)
    }
  })

  it('sorts the areas it passes through by level', () => {
    const a = square('LK1101', 3, [7.0, 80.0, 7.2, 80.2])
    const b = square('LK1102', 2, [7.0, 80.3, 7.2, 80.5])
    const c = square('LK1103', 1, [7.0, 80.6, 7.2, 80.8])
    const d = square('LK1104', 3, [8.0, 80.0, 8.2, 80.2])
    const passed = areasOnRoute([[79.9, 7.1], [81.0, 7.1]], [a, b, c, d])
    expect(names(passed.level3)).toEqual(['LK1101'])
    expect(names(passed.level2)).toEqual(['LK1102'])
    expect(names(passed.level1)).toEqual(['LK1103'])
  })
})

describe('the dev test routes against the real outlines', () => {
  it('Colombo to Mawanella passes Aranayake and Mawanella in Kegalle district', () => {
    const r = active(onRoute('kegalle', COLOMBO_MAWANELLA))
    expect(names(r.level3)).toEqual(['Aranayake'])
    expect(names(r.level2)).toEqual(['Mawanella'])
    expect(names(r.level1).sort()).toEqual(['Galigamuwa', 'Kegalle', 'Ruwanwella'])
  })

  it('every fake place is found, and the routes between them are the sample ones', async () => {
    const find = async (text: string) => (await fakeSearch(text))[0]
    const [colombo, kandy, mawanella, ratnapura, badulla, galle] = await Promise.all(
      ['Colombo', 'Kandy', 'Mawanella', 'Ratnapura', 'Badulla', 'Galle'].map(find),
    )
    for (const place of [colombo, kandy, mawanella, ratnapura, badulla, galle]) expect(place).toBeDefined()
    const between = async (a: typeof colombo, b: typeof colombo) => (await fakeRoute(a, b)).coordinates
    // Mawanella is only 21 km from Kandy, but it has its own route
    expect(await between(colombo, mawanella)).toEqual(COLOMBO_MAWANELLA)
    expect(await between(colombo, kandy)).toEqual(COLOMBO_KANDY)
    expect(await between(colombo, ratnapura)).toEqual(COLOMBO_RATNAPURA)
    expect(await between(kandy, badulla)).toEqual(KANDY_BADULLA)
    expect(await between(colombo, galle)).toEqual(COLOMBO_GALLE)
    // and either way round
    expect(await between(mawanella, colombo)).toEqual([...COLOMBO_MAWANELLA].reverse())
  })
})

describe('the level rules', () => {
  it('Level 3 on the route: a serious item, counted, the worst level 3', () => {
    const r = active(onRoute('level3', COLOMBO_RATNAPURA))
    expect(names(r.level3)).toEqual(['Eheliyagoda'])
    expect(r.level2).toEqual([])
    expect(r.level1).toEqual([])
    expect(seriousAreas(r)).toHaveLength(1)
    expect(worstLevel(r)).toBe(3)
  })

  it('Level 2 on the route: a serious item, counted, the worst level 2', () => {
    const r = active(onRoute('level2', COLOMBO_KANDY))
    expect(names(r.level2)).toEqual(['Mawanella'])
    expect(seriousAreas(r)).toHaveLength(1)
    expect(worstLevel(r)).toBe(2)
  })

  it('Level 2 and Level 3 together: both counted, the worst is 3', () => {
    const r = active(onRoute('mixed', COLOMBO_MAWANELLA))
    expect(names(r.level3)).toEqual(['Aranayake'])
    expect(names(r.level2)).toEqual(['Mawanella'])
    expect(seriousAreas(r)).toHaveLength(2)
    expect(worstLevel(r)).toBe(3)
  })

  it('Level 1 only: a soft note, never counted, and no worst level (no header pill)', () => {
    const r = active(onRoute('level1', COLOMBO_KANDY))
    expect(names(r.level1).sort()).toEqual(['Udunuwara', 'Yatinuwara'])
    expect(seriousAreas(r)).toEqual([])
    expect(worstLevel(r)).toBeNull()
  })

  it('a Level 1 area on a route with Level 3 is still left out of the count', () => {
    const r = active(onRoute('kegalle', COLOMBO_MAWANELLA))
    expect(r.level1).toHaveLength(3)
    expect(seriousAreas(r).map((d) => d.area.level)).toEqual([3, 2])
  })

  it('only the areas on the route count: a coastal route is clear in every mode that has a warning', () => {
    for (const mode of ['level1', 'level2', 'level3', 'mixed', 'unmatched', 'kegalle'] as const) {
      const r = active(onRoute(mode, COLOMBO_GALLE))
      expect(r.level3, mode).toEqual([])
      expect(r.level2, mode).toEqual([])
      expect(r.level1, mode).toEqual([])
      expect(r.status, mode).toBe('done')
    }
  })

  it('a Kandy to Badulla route passes the Badulla area, a Level 1 area in the Watch samples', () => {
    expect(names(active(onRoute('level1', KANDY_BADULLA)).level1)).toEqual(['Badulla'])
    expect(names(active(onRoute('mixed', KANDY_BADULLA)).level1)).toEqual(['Badulla'])
  })

  it('does not mind the Layers switch: the route is judged on every level, and nothing here reads the switch', () => {
    // the function takes no switch at all: a Level 1 area on the route is found whatever the map shows
    expect(landslideOnRoute.length).toBe(3)
    expect(active(onRoute('level1', COLOMBO_KANDY)).level1.length).toBeGreaterThan(0)
  })
})

describe('no warning, an old one, or one that could not be read', () => {
  it('no route: nothing to say', () => {
    expect(onRoute('mixed', null)).toEqual({ kind: 'none' })
  })

  it('a warning that has ended, or nothing stored, or no view yet: nothing to say', () => {
    expect(onRoute('expired', COLOMBO_KANDY)).toEqual({ kind: 'none' })
    expect(onRoute('none', COLOMBO_KANDY)).toEqual({ kind: 'none' })
    expect(landslideOnRoute(null, COLOMBO_KANDY, GOT)).toEqual({ kind: 'none' })
  })

  it('a warning that ran out while a route was on screen stops being said (the view is worked out from valid_to)', () => {
    resetFakeLandslide()
    const answer = fakeLandslideAnswer('level2', NOW)
    if (!answer.found || !answer.parseOk) throw new Error('not readable')
    expect(landslideOnRoute(landslideView(answer, answer.validTo - 1), COLOMBO_KANDY, GOT).kind).toBe('active')
    expect(landslideOnRoute(landslideView(answer, answer.validTo), COLOMBO_KANDY, GOT).kind).toBe('none')
  })

  it('the newest warning could not be read: only that is said, with the official PDF, and no older warning', () => {
    const r = onRoute('unreadable', COLOMBO_KANDY)
    expect(r).toEqual({ kind: 'unreadable', pdfUrl: 'https://www.dmc.gov.lk/images/dmcreports/TEST_fake_landslide_warning.pdf' })
  })

  it('a link that is not on dmc.gov.lk is never passed on', () => {
    const odd = parseLandslide({ found: true, parse_ok: false, listed_at: '2026-11-15T09:00:00Z', pdf_url: 'https://evil.example/images/dmcreports/x.pdf' })
    if (!odd) throw new Error('did not parse')
    expect(landslideOnRoute(landslideView(odd, NOW), COLOMBO_KANDY, GOT)).toEqual({ kind: 'unreadable', pdfUrl: null })
  })
})

describe('names that the route can’t be checked against', () => {
  it('lists the names with no match, with their district, and still checks the rest', () => {
    const r = active(onRoute('unmatched', COLOMBO_KANDY))
    expect(r.unchecked.map((a) => a.name)).toEqual(['Kotmale', 'Nowhereville'])
    expect(names(r.level2)).toEqual(['Mawanella'])
    const lines = routeLandslideLines(r)
    if (lines.kind !== 'active') throw new Error('not active')
    expect(lines.unchecked).toBe("Some areas named in the warning couldn't be checked against the route: Kotmale (Nuwara Eliya), Nowhereville (Badulla)")
  })

  it('says it even when the route passes none of the areas (the warning is for the whole island)', () => {
    const r = active(onRoute('unmatched', COLOMBO_GALLE))
    expect(r.unchecked).toHaveLength(2)
    expect(hasLandslideLines(routeLandslideLines(r))).toBe(true)
  })

  it('says nothing when every name was matched and has an outline', () => {
    const lines = routeLandslideLines(onRoute('mixed', COLOMBO_GALLE))
    if (lines.kind !== 'active') throw new Error('not active')
    expect(lines.unchecked).toBeNull()
    expect(hasLandslideLines(lines)).toBe(false)
  })

  it('a matched name whose division the boundary file lacks is listed too, never dropped', () => {
    const view = viewOf('level3')
    if (view.kind !== 'active') throw new Error('not active')
    const fewer: ShapeData = { ...data, ds: { features: ds.features.filter((f: Feature) => f.properties.en !== 'Eheliyagoda') } }
    const r = active(landslideOnRoute(view, COLOMBO_RATNAPURA, { data: fewer, failed: false }))
    expect(r.unchecked.map((a) => a.name)).toEqual(['Eheliyagoda'])
    expect(r.level3).toEqual([])
  })

  it('a warning with only unmatched names has nothing to download and nothing to check', () => {
    const odd = parseLandslide({
      found: true, parse_ok: true, message_id: 'LEWM-15-11-2026-1600-01', update: 1, issued_at: '2026-11-15T08:00:00Z', valid_from: '2026-11-15T08:00:00Z',
      valid_to: '2026-11-16T08:00:00Z', listed_at: '2026-11-15T09:00:00Z', pdf_url: null,
      areas: [{ level: 3, district: 'Badulla', name: 'Nowhereville', code: null, district_code: 'LK81', shift: 0, added: false, note: 'no such division' }],
    })
    if (!odd) throw new Error('did not parse')
    const view = landslideView(odd, NOW)
    expect(wantsOutlines(view, true)).toBe(false)
    const r = active(landslideOnRoute(view, COLOMBO_KANDY, { data: undefined, failed: false }))
    expect(r.status).toBe('done')
    expect(r.unchecked).toHaveLength(1)
    expect(seriousAreas(r)).toEqual([])
  })

  it('cuts a long list after eight names, and says how many more', () => {
    const many = Array.from({ length: 11 }, (_, i) => `Name${i + 1}`)
    expect(listNames(many.slice(0, MAX_NAMES))).toBe(many.slice(0, 8).join(', '))
    expect(listNames(many)).toBe('Name1, Name2, Name3, Name4, Name5, Name6, Name7, Name8 and 3 more')
  })
})

describe('while the outlines load, or when they can’t', () => {
  it('still loading: says it is checking, finds nothing yet, and still lists names that have no match', () => {
    const r = active(onRoute('unmatched', COLOMBO_KANDY, { data: undefined, failed: false }))
    expect(r.status).toBe('checking')
    expect(seriousAreas(r)).toEqual([])
    expect(r.unchecked).toHaveLength(2)
    const lines = routeLandslideLines(r)
    if (lines.kind !== 'active') throw new Error('not active')
    expect(lines.checking).toBe('Checking the route against the landslide warning areas…')
    expect(lines.failed).toBeNull()
  })

  it('could not be loaded: says so, with the PDF, and never reads as "clear"', () => {
    const r = active(onRoute('mixed', COLOMBO_KANDY, { data: undefined, failed: true }))
    expect(r.status).toBe('failed')
    const lines = routeLandslideLines(r)
    if (lines.kind !== 'active') throw new Error('not active')
    expect(lines.failed).toBe("The route couldn't be checked against the landslide warning areas just now.")
    expect(lines.pdfUrl).toContain('dmc.gov.lk')
    expect(hasLandslideLines(lines)).toBe(true)
  })
})

describe('the lines in the route panel', () => {
  const lines = (mode: FakeLandslideMode, line: Line) => {
    const out = routeLandslideLines(onRoute(mode, line))
    if (out.kind !== 'active') throw new Error('not active')
    return out
  }

  it('Level 3 is a serious item, in NBRO’s words', () => {
    const out = lines('level3', COLOMBO_RATNAPURA)
    expect(out.items.map((i) => i.text)).toEqual(['Passes through a landslide Evacuate (Level 3) area: Eheliyagoda'])
    expect(out.watch).toBeNull()
  })

  it('Level 2 is a serious item', () => {
    const out = lines('level2', COLOMBO_KANDY)
    expect(out.items.map((i) => i.text)).toEqual(['Passes through a landslide Alert (Level 2) area: Mawanella'])
  })

  it('more than one area says "areas", and Level 3 comes before Level 2', () => {
    const out = lines('level2', COLOMBO_MAWANELLA)
    expect(out.items.map((i) => i.text)).toEqual(['Passes through landslide Alert (Level 2) areas: Mawanella, Dehiowita'])
    const both = lines('mixed', COLOMBO_MAWANELLA)
    expect(both.items.map((i) => i.level)).toEqual([3, 2])
    expect(both.items[0].text).toBe('Passes through a landslide Evacuate (Level 3) area: Aranayake')
  })

  it('Level 1 is a note, not an item, and says "areas"', () => {
    const out = lines('level1', COLOMBO_KANDY)
    expect(out.items).toEqual([])
    expect(out.watch?.text).toMatch(/^Passes through Watch \(Level 1\) areas: (Udunuwara, Yatinuwara|Yatinuwara, Udunuwara)$/)
    expect(lines('level1', KANDY_BADULLA).watch?.text).toBe('Passes through a Watch (Level 1) area: Badulla')
  })

  it('all three together, with the areas to show on the map for each line', () => {
    const out = lines('kegalle', COLOMBO_MAWANELLA)
    expect(out.items).toHaveLength(2)
    expect(out.watch?.areas).toHaveLength(3)
    expect(pointsFor(out.items[0].areas)).toHaveLength(2)
    expect(pointsFor(out.watch?.areas ?? [])).toHaveLength(6)
    for (const [lat, lng] of pointsFor(out.items[0].areas)) {
      expect(lat).toBeGreaterThan(5.5)
      expect(lng).toBeGreaterThan(79)
    }
  })

  it('carries "Valid until" with the date, "NBRO via DMC" and the official PDF', () => {
    const out = lines('level2', COLOMBO_KANDY)
    expect(out.validUntil).toMatch(/^Valid until \d{1,2} [A-Z][a-z]{2}, \d{1,2}:\d{2} (am|pm)$/)
    expect(out.source).toBe('Source: NBRO via DMC')
    expect(out.pdfUrl).toBe('https://www.dmc.gov.lk/images/dmcreports/TEST_fake_landslide_warning.pdf')
  })

  it('"Valid until" is the warning’s own valid_to, in Sri Lanka time', () => {
    const answer = fakeLandslideAnswer('level2', NOW)
    if (!answer.found || !answer.parseOk) throw new Error('not readable')
    // valid_to is 22 hours after NOW: 15 Nov 10:00 UTC = 3:30 pm in Sri Lanka, so 16 Nov 1:30 pm
    expect(answer.validTo).toBe(NOW - 2 * 3_600_000 + 24 * 3_600_000)
    expect(lines('level2', COLOMBO_KANDY).validUntil).toBe('Valid until 16 Nov, 1:30 pm')
  })

  it('an unreadable warning is one note and the PDF', () => {
    const out = routeLandslideLines(onRoute('unreadable', COLOMBO_KANDY))
    expect(out).toEqual({
      kind: 'unreadable',
      text: "Latest landslide warning couldn't be read",
      pdfUrl: 'https://www.dmc.gov.lk/images/dmcreports/TEST_fake_landslide_warning.pdf',
    })
    expect(hasLandslideLines(out)).toBe(true)
  })

  it('nothing is said without a warning, or for a clear route', () => {
    expect(hasLandslideLines(routeLandslideLines(onRoute('none', COLOMBO_KANDY)))).toBe(false)
    expect(hasLandslideLines(routeLandslideLines(onRoute('mixed', COLOMBO_GALLE)))).toBe(false)
  })

  it('in Sinhala and Tamil every line is whole words: no key and no {{ left in', async () => {
    try {
      for (const lang of ['si', 'ta'] as const) {
        await setLanguage(lang, false)
        const all = lines('kegalle', COLOMBO_MAWANELLA)
        const unchecked = lines('unmatched', COLOMBO_MAWANELLA)
        const texts = [...all.items.map((i) => i.text), all.watch?.text, unchecked.unchecked, all.validUntil, all.source]
        for (const text of texts) {
          expect(text, lang).toBeTruthy()
          expect(text, lang).not.toMatch(/route\.landslide|\{\{|passes\d/)
        }
        const bad = routeLandslideLines(onRoute('unreadable', COLOMBO_KANDY))
        if (bad.kind !== 'unreadable') throw new Error('not unreadable')
        expect(bad.text, lang).not.toMatch(/route\.landslide/)
        expect(bad.text, lang).not.toBe("Latest landslide warning couldn't be read")
        // the names are the Survey Department's, in the chosen language
        expect(all.items[0].text, lang).toContain(ds.features.find((f: Feature) => f.properties.en === 'Aranayake').properties[lang])
      }
    } finally {
      await setLanguage('en', false)
    }
  })
})

describe('when the outlines are downloaded', () => {
  it('only with a route on screen and a valid warning that has a name that can be matched', () => {
    expect(wantsOutlines(viewOf('mixed'), true)).toBe(true)
    expect(wantsOutlines(viewOf('level1'), true)).toBe(true)
    expect(wantsOutlines(viewOf('level2'), true)).toBe(true)
    expect(wantsOutlines(viewOf('unmatched'), true)).toBe(true)
  })

  it('never without a route', () => {
    for (const mode of ['mixed', 'level1', 'level3'] as const) expect(wantsOutlines(viewOf(mode), false), mode).toBe(false)
  })

  it('never without a valid warning: ended, none, unreadable, not loaded yet', () => {
    for (const mode of ['expired', 'none', 'unreadable'] as const) expect(wantsOutlines(viewOf(mode), true), mode).toBe(false)
    expect(wantsOutlines(null, true)).toBe(false)
  })

  it('a Watch-only warning is checked too, whatever the Layers switch says (the note is about the route)', () => {
    expect(wantsOutlines(viewOf('level1'), true)).toBe(true)
  })

  it('goes through the same query as the map layer, asked for only when wanted, and kept', () => {
    const hook = read('src', 'lib', 'useRouteLandslide.ts')
    expect(hook).toContain('const wanted = wantsOutlines(view, route !== null)')
    expect(hook).toContain('useLandslideShapes(wanted)')
    expect(hook).toContain('useLandslide()')
    // no second copy of the outlines, and no direct import of the boundary file
    expect(hook).not.toMatch(/ds\.json|dsAreas|loadShapes/)
    const layer = read('src', 'lib', 'useLandslide.ts')
    expect(layer).toMatch(/useLandslideShapes\(enabled: boolean\)[\s\S]*enabled,[\s\S]*staleTime: Infinity/)
  })

  it('the route panel loads nothing itself: no route check means no outlines', () => {
    const planner = read('src', 'components', 'RoutePlanner.tsx')
    expect(planner).toContain('useRouteLandslide(route)')
    expect(planner).not.toMatch(/ds\.json|dsAreas|loadShapes|useLandslideShapes/)
  })

  it('the route code shares the map’s placing and the same warning, and does not copy the outline lookup', () => {
    const lib = read('src', 'lib', 'landslideRoute.ts')
    expect(lib).toContain('placeAreas(areas, outlines.data)')
    expect(lib).not.toMatch(/byCode|features\.find|ds\.json/)
  })
})

describe('the route panel counts like the other warnings', () => {
  const planner = read('src', 'components', 'RoutePlanner.tsx')
  const section = read('src', 'components', 'LandslideRouteSection.tsx')

  it('has a header pill for Level 3 and 2 areas only, in the level’s colour, before the other pills', () => {
    expect(planner).toContain('const landslideCount = seriousAreas(landslide).length')
    expect(planner).toContain('const landslideWorst = worstLevel(landslide)')
    expect(planner).toContain("t('route.landslideCount', { count: landslideCount })")
    expect(planner).toContain('LEVEL_COLOR[landslideWorst]')
    expect(planner.indexOf('{landslideWorst && (')).toBeLessThan(planner.indexOf('{alertWorst && ('))
  })

  it('is not part of the report hazard count, like the river and rain warnings', () => {
    expect(planner).toContain("t('route.hazardCount', { count: list.length })")
  })

  it('the summary line does not read "no hazards" beside a landslide item', () => {
    expect(planner).toContain('hazardSummary(list, riversNear.length > 0 || globalAlerts.length > 0 || landslideCount > 0)')
  })

  it('the landslide section comes first, before the global alerts, the rivers and the rain', () => {
    const at = (text: string) => planner.indexOf(text)
    expect(at('<LandslideRouteSection')).toBeGreaterThan(0)
    expect(at('<LandslideRouteSection')).toBeLessThan(at('globalAlerts.length > 0 && ('))
    expect(at('<LandslideRouteSection')).toBeLessThan(at('riversNear.length > 0 && ('))
    expect(at('<LandslideRouteSection')).toBeLessThan(at('<RainSection'))
  })

  it('sits inside the part that fades when the results are out of date', () => {
    expect(planner.indexOf("outOfDate ? 'opacity-60'")).toBeLessThan(planner.indexOf('<LandslideRouteSection'))
    expect(planner.indexOf('<LandslideRouteSection')).toBeLessThan(planner.indexOf("{t('route.openGoogle')}"))
  })

  it('the section never hides a line because of the Layers switch, and only ever links to the checked PDF', () => {
    // the switch only changes the label on the Watch line's button (it turns Watch areas on)
    expect(section).not.toMatch(/switchOn\s*&&/)
    expect(section).toContain('href={url}')
    expect(section).toContain('rel="noopener noreferrer"')
    expect(section).toContain('target="_blank"')
    expect(section).not.toMatch(/href=\{[^}]*(landslide\.|warning\.)/)
  })

  it('"Show on map" folds the panel away and fits the areas, and Watch areas turn the switch on for it', () => {
    const map = read('src', 'components', 'HazardMap.tsx')
    expect(map).toContain('onSelectLandslide={showLandslide}')
    expect(map).toContain('landslideSwitchOn={layers.landslides}')
    expect(map).toMatch(/function showLandslide[\s\S]*saveLayerSetting\('landslides', true\)[\s\S]*setPanel\('collapsed'\)[\s\S]*fitBounds/)
  })
})

describe('the section as drawn', () => {
  const draw = (mode: FakeLandslideMode, line: Line | null, switchOn = true, outlines: Outlines = GOT) =>
    renderToStaticMarkup(createElement(LandslideRouteSection, { landslide: onRoute(mode, line, outlines), switchOn, onShow: () => {} }))
  const PDF = 'https://www.dmc.gov.lk/images/dmcreports/TEST_fake_landslide_warning.pdf'

  it('draws nothing when there is nothing to say', () => {
    expect(draw('none', COLOMBO_KANDY)).toBe('')
    expect(draw('expired', COLOMBO_KANDY)).toBe('')
    expect(draw('mixed', COLOMBO_GALLE)).toBe('')
    expect(draw('mixed', null)).toBe('')
  })

  it('a Level 3 and a Level 2 item, then the Watch note, each with its own details, PDF and map button', () => {
    const html = draw('kegalle', COLOMBO_MAWANELLA)
    expect(html).toContain('Landslide warnings')
    expect(html).toContain('Passes through a landslide Evacuate (Level 3) area: Aranayake')
    expect(html).toContain('Passes through a landslide Alert (Level 2) area: Mawanella')
    expect(html).toMatch(/Passes through Watch \(Level 1\) areas: [A-Za-z, ]+/)
    expect(html.indexOf('Level 3')).toBeLessThan(html.indexOf('Level 2'))
    expect(html.indexOf('Level 2')).toBeLessThan(html.indexOf('Level 1'))
    // three lines, each with the validity, the source, the official PDF and a way to see the areas
    expect(html.match(/Valid until/g)).toHaveLength(3)
    expect(html.match(/Source: NBRO via DMC/g)).toHaveLength(3)
    expect(html.match(/Open the official warning \(PDF\)/g)).toHaveLength(3)
    expect(html.match(/Show on map/g)).toHaveLength(3)
    expect(html.match(new RegExp(`href="${PDF}" target="_blank" rel="noopener noreferrer"`, 'g'))).toHaveLength(3)
    // only the two serious lines are bordered items, the Watch note is plain
    expect(html.match(/border-2 border-slate-200/g)).toHaveLength(2)
  })

  it('Level 1 only is a plain note, whatever the switch says; with the switch off its button says it turns Watch on', () => {
    for (const on of [true, false]) {
      const html = draw('level1', COLOMBO_KANDY, on)
      expect(html).toContain('Passes through Watch (Level 1) areas')
      expect(html).not.toContain('border-2')
    }
    expect(draw('level1', COLOMBO_KANDY, true)).toContain('>Show on map<')
    expect(draw('level1', COLOMBO_KANDY, false)).toContain('Show on map (switches Watch areas on)')
    // the serious levels are always on the map, so their button never says that
    expect(draw('level2', COLOMBO_KANDY, false)).toContain('>Show on map<')
    expect(draw('level2', COLOMBO_KANDY, false)).not.toContain('switches Watch')
  })

  it('an unreadable warning: one note and the PDF', () => {
    const html = draw('unreadable', COLOMBO_KANDY)
    expect(html).toContain("Latest landslide warning couldn&#x27;t be read")
    expect(html).toContain(`href="${PDF}"`)
    expect(html).not.toContain('Valid until')
  })

  it('the unchecked names: one short line, listing them', () => {
    const html = draw('unmatched', COLOMBO_GALLE)
    expect(html).toContain('Kotmale (Nuwara Eliya), Nowhereville (Badulla)')
    expect(html).not.toContain('Valid until')
  })

  it('while checking, and when the outlines failed', () => {
    expect(draw('mixed', COLOMBO_KANDY, true, { data: undefined, failed: false })).toContain('Checking the route against the landslide warning areas')
    const failed = draw('mixed', COLOMBO_KANDY, true, { data: undefined, failed: true })
    expect(failed).toContain('The route couldn&#x27;t be checked')
    expect(failed).toContain(`href="${PDF}"`)
  })
})
