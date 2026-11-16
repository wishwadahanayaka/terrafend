import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { FAKE_LANDSLIDE_MODES, fakeLandslideAnswer, fakeLandslideMode, resetFakeLandslide, type FakeLandslideMode } from './fakeLandslide'
import { chipCounts, isValidNow, landslideView, matchedAreas, unmatchedAreas, type LandslideAnswer } from './landslide'
import { loadLandslide } from './landslideFetch'

// ?fakeLandslide= (dev only): made-up warnings built from real area codes.

const ROOT = join(__dirname, '..', '..')
const ds = JSON.parse(readFileSync(join(ROOT, 'src', 'data', 'areas', 'ds.json'), 'utf8')) as {
  features: { properties: { code: string; district: string; en: string } }[]
}
const districts = JSON.parse(readFileSync(join(ROOT, 'src', 'data', 'areas', 'districts.json'), 'utf8')) as {
  features: { properties: { code: string; en: string } }[]
}
const NOW = Date.parse('2026-11-15T10:00:00Z')
const MIN = 60_000

const answerOf = (mode: FakeLandslideMode, now = NOW) => fakeLandslideAnswer(mode, now)
const readable = (answer: LandslideAnswer) => {
  if (!answer.found || !answer.parseOk) throw new Error('not a readable warning')
  return answer
}

beforeEach(() => resetFakeLandslide())

describe('the switch', () => {
  it('reads the mode from the address, and is null without it', () => {
    expect(fakeLandslideMode('')).toBeNull()
    expect(fakeLandslideMode('?fakeNews=1')).toBeNull()
    for (const mode of FAKE_LANDSLIDE_MODES) expect(fakeLandslideMode(`?fakeLandslide=${mode}`)).toBe(mode)
    expect(fakeLandslideMode('?fakeLandslide=LEVEL2')).toBe('level2')
    expect(fakeLandslideMode('?x=1&fakeLandslide=none')).toBe('none')
  })

  it('treats a bare switch or an unknown word as "mixed"', () => {
    expect(fakeLandslideMode('?fakeLandslide')).toBe('mixed')
    expect(fakeLandslideMode('?fakeLandslide=')).toBe('mixed')
    expect(fakeLandslideMode('?fakeLandslide=banana')).toBe('mixed')
  })

  it('has every mode the prompt asks for', () => {
    expect([...FAKE_LANDSLIDE_MODES].sort()).toEqual(['expired', 'fail', 'level1', 'level2', 'level3', 'mixed', 'none', 'offline-expiry', 'unmatched', 'unreadable'])
  })

  it('does nothing without the switch: a real read goes ahead', async () => {
    // (no address in these tests, so no fake)
    await expect(loadLandslide(async () => ({ found: false }))).resolves.toEqual({ found: false })
  })
})

describe('the sample warnings are built from real areas', () => {
  it('every matched area is a real DS division of its real district, with the Survey Department’s name', () => {
    const byCode = new Map(ds.features.map((f) => [f.properties.code, f.properties]))
    const districtByCode = new Map(districts.features.map((f) => [f.properties.code, f.properties.en]))
    for (const mode of ['level1', 'level2', 'level3', 'mixed', 'unmatched', 'expired', 'offline-expiry'] as const) {
      const warning = readable(answerOf(mode))
      expect(warning.areas.length, mode).toBeGreaterThan(0)
      for (const area of matchedAreas(warning.areas)) {
        const real = byCode.get(area.code as string)
        expect(real, `${mode}: ${area.code}`).toBeDefined()
        expect(real?.en, area.code as string).toBe(area.name)
        expect(real?.district).toBe(area.districtCode)
        expect(districtByCode.get(area.districtCode as string)).toBe(area.district)
      }
    }
  })

  it('has no division twice in one warning', () => {
    for (const mode of FAKE_LANDSLIDE_MODES) {
      if (mode === 'fail' || mode === 'none' || mode === 'unreadable') continue
      const codes = matchedAreas(readable(answerOf(mode)).areas).map((a) => a.code)
      expect(new Set(codes).size, mode).toBe(codes.length)
    }
  })

  it('level1, level2 and level3 have only that level', () => {
    for (const [mode, level, count] of [['level1', 1, 6], ['level2', 2, 4], ['level3', 3, 3]] as const) {
      const areas = readable(answerOf(mode)).areas
      expect(areas, mode).toHaveLength(count)
      expect(new Set(areas.map((a) => a.level)), mode).toEqual(new Set([level]))
    }
  })

  it('mixed has all three levels and every kind of change since the last warning', () => {
    const areas = readable(answerOf('mixed')).areas
    expect(new Set(areas.map((a) => a.level))).toEqual(new Set([1, 2, 3]))
    expect(areas.some((a) => a.shift === 1)).toBe(true)
    expect(areas.some((a) => a.shift === 2)).toBe(true)
    expect(areas.some((a) => a.shift === -1)).toBe(true)
    expect(areas.some((a) => a.added)).toBe(true)
    expect(areas.some((a) => a.shift === 0 && !a.added)).toBe(true)
    expect(unmatchedAreas(areas)).toHaveLength(0)
    expect(chipCounts({ areas } as never)).toEqual({ level3: 2, level2: 3 })
  })

  it('unmatched has two names with no division, each with its reason', () => {
    const areas = readable(answerOf('unmatched')).areas
    const left = unmatchedAreas(areas)
    expect(left.map((a) => a.name)).toEqual(['Kotmale', 'Nowhereville'])
    for (const a of left) {
      expect(a.code).toBeNull()
      expect(a.note).toBeTruthy()
    }
    expect(matchedAreas(areas)).toHaveLength(11)
  })

  it('goes through the same checks as a real answer, and links a PDF on dmc.gov.lk only', () => {
    for (const mode of FAKE_LANDSLIDE_MODES) {
      if (mode === 'fail') continue
      const answer = answerOf(mode)
      if (answer.found) expect(answer.pdfUrl, mode).toBe('https://www.dmc.gov.lk/images/dmcreports/TEST_fake_landslide_warning.pdf')
    }
  })
})

describe('what each mode shows at the time it is asked', () => {
  const kind = (mode: FakeLandslideMode, now = NOW) => landslideView(answerOf(mode, now), now).kind

  it('is active for the level, mixed and unmatched samples', () => {
    for (const mode of ['level1', 'level2', 'level3', 'mixed', 'unmatched'] as const) expect(kind(mode), mode).toBe('active')
  })

  it('"expired" ended 2 hours ago, so there is no active warning', () => {
    expect(kind('expired')).toBe('none')
    const ended = readable(answerOf('expired')).validTo
    expect(NOW - ended).toBe(2 * 60 * MIN)
  })

  it('"unreadable" is a newest warning that could not be read, with the PDF', () => {
    const view = landslideView(answerOf('unreadable'), NOW)
    expect(view).toEqual({ kind: 'unreadable', pdfUrl: 'https://www.dmc.gov.lk/images/dmcreports/TEST_fake_landslide_warning.pdf' })
  })

  it('"none" is nothing stored', () => {
    expect(answerOf('none')).toEqual({ found: false })
    expect(kind('none')).toBe('none')
  })

  it('"fail" makes the load fail', () => {
    expect(() => answerOf('fail')).toThrow(/unavailable/)
  })

  it('"offline-expiry" is valid for 2 minutes, then runs out with no new answer, and a refetch can’t extend it', () => {
    const first = readable(answerOf('offline-expiry'))
    expect(first.validTo - NOW).toBe(2 * MIN)
    expect(isValidNow(first, NOW + MIN)).toBe(true)
    expect(isValidNow(first, NOW + 2 * MIN - 1)).toBe(true)
    expect(isValidNow(first, NOW + 2 * MIN)).toBe(false)
    // asked again a minute and a half later (a refetch): the end does not move
    const again = readable(answerOf('offline-expiry', NOW + 90_000))
    expect(again.validTo).toBe(first.validTo)
    expect(landslideView(again, NOW + 3 * MIN).kind).toBe('none')
  })
})

describe('where the fake lives', () => {
  const read = (...parts: string[]) => readFileSync(join(ROOT, ...parts), 'utf8')

  it('is only loaded inside the dev check, so the production build leaves it out', () => {
    const fetcher = read('src', 'lib', 'landslideFetch.ts')
    const at = fetcher.indexOf("import('./fakeLandslide')")
    expect(at).toBeGreaterThan(-1)
    expect(fetcher.lastIndexOf('if (import.meta.env.DEV) {', at)).toBeGreaterThan(-1)
    expect(fetcher.lastIndexOf('if (import.meta.env.DEV) {', at)).toBeGreaterThan(fetcher.lastIndexOf('}\n', at))
  })

  it('is imported by nothing else', () => {
    const sources = ['useLandslide.ts', 'useThreats.ts', 'landslide.ts', 'landslideShapes.ts', 'landslideStatus.ts'].map((f) => read('src', 'lib', f))
    for (const source of sources) expect(source).not.toMatch(/fakeLandslide/)
    for (const f of ['LandslideLayer.tsx', 'LandslideStatus.tsx', 'LandslideLegend.tsx', 'LayerControls.tsx', 'HazardMap.tsx']) {
      expect(read('src', 'components', f)).not.toMatch(/fakeLandslide/)
    }
  })

  it('saves nothing to the phone’s saved data while it is on (main.tsx keeps only the forecast with any fake switch)', () => {
    expect(read('src', 'main.tsx')).toContain("k.startsWith('fake')")
  })
})
