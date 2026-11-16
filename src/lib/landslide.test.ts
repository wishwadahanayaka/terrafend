import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { PDF_URL_RULE } from '../../supabase/functions/landslide-refresh/logic'
import { setLanguage, t } from '../i18n'
import {
  areaCount,
  areasToDraw,
  areaStyle,
  BOUNDARY_CREDIT,
  cardContent,
  changeOf,
  chipCounts,
  hiddenWatchAreas,
  isDrawnLevel,
  isValidNow,
  landslideView,
  LANDSLIDE_CREDIT,
  LEVEL_COLOR,
  matchedAreas,
  msUntilExpiry,
  namesWithLevel,
  officialPdfUrl,
  parseLandslide,
  unmatchedAreas,
  type ActiveWarning,
  type LandslideAnswer,
} from './landslide'
import { fakeLandslideAnswer } from './fakeLandslide'
import { placeAreas, type ShapeData } from './landslideShapes'
import { MILD_COLOR, RAIN_COLOR } from './rainForecast'
import { sriLankaDateTime } from './time'

// The landslide warning's rules on the phone: reading what landslide_current() answers, whether it is
// still valid, what the chip counts, and what a card says. No network, no browser.

const ROOT = join(__dirname, '..', '..')
const ds = JSON.parse(readFileSync(join(ROOT, 'src', 'data', 'areas', 'ds.json'), 'utf8'))
const districtNames = JSON.parse(readFileSync(join(ROOT, 'src', 'data', 'areas', 'district-names.json'), 'utf8'))
const data = { ds, districtNames } as ShapeData

const MIN = 60_000
const HOUR = 60 * MIN
// 3:30 pm in Sri Lanka, Sunday 15 Nov 2026
const NOW = Date.parse('2026-11-15T10:00:00Z')
const PDF = 'https://www.dmc.gov.lk/images/dmcreports/LEWM_14-11-2026_16_00__1794660156.pdf'

const row = (over: Record<string, unknown> = {}) => ({
  level: 2,
  district: 'Kegalle',
  name: 'Mawanella',
  code: 'LK9206',
  district_code: 'LK92',
  shift: 0,
  added: false,
  note: null,
  ...over,
})

// What landslide_current() answers for a warning issued at 4:00 pm on 14 Nov, valid to 4:00 pm on 15 Nov
const raw = (over: Record<string, unknown> = {}) => ({
  found: true,
  id: 7,
  message_id: 'LEWM-14-11-2026-1600-09',
  update: 9,
  issued_at: '2026-11-14T10:30:00Z',
  valid_from: '2026-11-14T10:30:00Z',
  valid_to: '2026-11-15T10:30:00Z',
  listed_at: '2026-11-14T10:35:00Z',
  pdf_url: PDF,
  parse_ok: true,
  valid: true,
  areas: [row(), row({ level: 1, name: 'Ella', district: 'Badulla', code: 'LK8136', district_code: 'LK81' })],
  ...over,
})

const active = (over: Record<string, unknown> = {}): Extract<LandslideAnswer, { parseOk: true }> => {
  const answer = parseLandslide(raw(over))
  if (!answer || !answer.found || !answer.parseOk) throw new Error('not an active answer')
  return answer
}

describe('reading the answer', () => {
  it('reads a warning, with its times as milliseconds and every area', () => {
    const answer = active()
    expect(answer).toMatchObject({
      found: true,
      parseOk: true,
      messageId: 'LEWM-14-11-2026-1600-09',
      update: 9,
      issuedAt: Date.parse('2026-11-14T10:30:00Z'),
      validTo: Date.parse('2026-11-15T10:30:00Z'),
      pdfUrl: PDF,
    })
    expect(answer.areas).toHaveLength(2)
    expect(answer.areas[0]).toEqual({ level: 2, district: 'Kegalle', name: 'Mawanella', code: 'LK9206', districtCode: 'LK92', shift: 0, added: false, note: null })
  })

  it('reads "nothing stored" and "the newest could not be read"', () => {
    expect(parseLandslide({ found: false })).toEqual({ found: false })
    const unreadable = parseLandslide(raw({ parse_ok: false, message_id: null, update: null, issued_at: null, valid_from: null, valid_to: null, areas: [], valid: false }))
    expect(unreadable).toEqual({ found: true, parseOk: false, listedAt: Date.parse('2026-11-14T10:35:00Z'), pdfUrl: PDF })
  })

  it('keeps a name that could not be matched, with its reason: it is never dropped', () => {
    const answer = active({ areas: [row(), row({ name: 'Kotmale', district: 'Nuwara Eliya', code: null, district_code: 'LK23', note: 'Kotmale is East or West' })] })
    expect(answer.areas).toHaveLength(2)
    expect(matchedAreas(answer.areas)).toHaveLength(1)
    expect(unmatchedAreas(answer.areas).map((a) => a.name)).toEqual(['Kotmale'])
    expect(areaCount({ areas: answer.areas } as ActiveWarning)).toBe(2)
  })

  it('refuses an answer that makes no sense, as a failed load and not as "no warning"', () => {
    const bad: unknown[] = [
      null,
      'found',
      [],
      {},
      { found: 'yes' },
      raw({ parse_ok: undefined }),
      raw({ listed_at: 'yesterday' }),
      raw({ message_id: '' }),
      raw({ update: '9' }),
      raw({ issued_at: null }),
      raw({ valid_to: 'soon' }),
      raw({ valid_to: '2026-11-14T10:30:00Z' }),
      raw({ areas: null }),
      raw({ areas: [row({ level: 4 })] }),
      raw({ areas: [row({ level: '2' })] }),
      raw({ areas: [row({ name: '' })] }),
      raw({ areas: [row({ code: 'LK92' })] }),
      raw({ areas: [row({ code: 'lk9206' })] }),
      raw({ areas: [row({ district_code: null })] }),
      raw({ areas: [row({ district_code: 'LK81' })] }),
      raw({ areas: [row({ code: null, note: null })] }),
      raw({ areas: [row({ shift: 3 })] }),
      raw({ areas: [row({ shift: 0.5 })] }),
      raw({ areas: [row({ added: 'no' })] }),
      raw({ areas: [row({ name: 'x'.repeat(81) })] }),
      // one bad row spoils the answer: nothing is quietly left out
      raw({ areas: [row(), row({ level: 9 })] }),
    ]
    for (const item of bad) expect(parseLandslide(item), JSON.stringify(item)?.slice(0, 80)).toBeNull()
  })
})

describe('the official PDF link', () => {
  it('is only a link on dmc.gov.lk, in its PDF folder, over https', () => {
    for (const ok of [PDF, 'https://dmc.gov.lk/images/dmcreports/a.pdf']) expect(officialPdfUrl(ok), ok).toBe(ok)
    for (const bad of [
      'http://www.dmc.gov.lk/images/dmcreports/a.pdf',
      'https://evil.example/images/dmcreports/a.pdf',
      'https://www.dmc.gov.lk.evil.example/images/dmcreports/a.pdf',
      'https://www.dmc.gov.lk:8080/images/dmcreports/a.pdf',
      'https://user:pw@www.dmc.gov.lk/images/dmcreports/a.pdf',
      'https://www.dmc.gov.lk/files/a.pdf',
      'https://www.dmc.gov.lk/IMAGES/dmcreports/a.pdf',
      'javascript:alert(1)',
      '',
      null,
      undefined,
      42,
    ]) {
      expect(officialPdfUrl(bad), String(bad)).toBeNull()
    }
  })

  it('says the same as the rule the function and the tables use', () => {
    for (const url of [PDF, 'https://dmc.gov.lk/images/dmcreports/a.pdf', 'https://www.dmc.gov.lk/images/other/a.pdf', 'https://evil.example/images/dmcreports/a.pdf']) {
      expect(officialPdfUrl(url) !== null, url).toBe(PDF_URL_RULE.test(url))
    }
  })

  it('drops an off-site link and keeps the warning', () => {
    const answer = active({ pdf_url: 'https://evil.example/images/dmcreports/a.pdf' })
    expect(answer.pdfUrl).toBeNull()
    expect(answer.areas).toHaveLength(2)
  })
})

describe('still valid, worked out on the phone', () => {
  it('is valid until valid_to and not at it or after, by the phone’s clock', () => {
    const answer = active()
    expect(isValidNow(answer, NOW)).toBe(true)
    expect(isValidNow(answer, answer.validTo - 1)).toBe(true)
    expect(isValidNow(answer, answer.validTo)).toBe(false)
    expect(isValidNow(answer, answer.validTo + HOUR)).toBe(false)
  })

  it('never goes by the server’s own "valid" flag', () => {
    // the server said valid, but the time has passed
    const late = active({ valid: true })
    expect(landslideView(late, late.validTo + MIN).kind).toBe('none')
    // the server said not valid, but the time says it is
    const early = active({ valid: false })
    expect(landslideView(early, NOW).kind).toBe('active')
  })

  it('an answer saved earlier expires on time when it is read again later, with no new answer', () => {
    const saved = active()
    const readAt = (ms: number) => landslideView(saved, ms).kind
    expect(readAt(NOW)).toBe('active')
    // a few hours on, offline: the same saved answer, a later clock
    expect(readAt(saved.validTo - 30_000)).toBe('active')
    expect(readAt(saved.validTo + 30_000)).toBe('none')
    expect(readAt(saved.validTo + 20 * HOUR)).toBe('none')
  })

  it('says how long to wait for the end, so the screen changes at that moment', () => {
    const answer = active()
    expect(msUntilExpiry(answer, NOW)).toBe(30 * MIN)
    expect(msUntilExpiry(answer, answer.validTo)).toBeNull()
    expect(msUntilExpiry(answer, answer.validTo + 1)).toBeNull()
    expect(msUntilExpiry(undefined, NOW)).toBeNull()
    expect(msUntilExpiry({ found: false }, NOW)).toBeNull()
    // a warning that could not be read has no end to wait for
    expect(msUntilExpiry({ found: true, parseOk: false, listedAt: NOW, pdfUrl: null }, NOW)).toBeNull()
    // never more than a timer can wait
    expect(msUntilExpiry(active({ valid_to: '2030-01-01T00:00:00Z' }), NOW)).toBe(2 ** 31 - 1)
  })
})

describe('what the app shows', () => {
  it('nothing stored: no warning', () => {
    expect(landslideView({ found: false }, NOW)).toEqual({ kind: 'none' })
  })

  it('the newest warning could not be read: it says so, with the PDF, and is never valid', () => {
    const view = landslideView({ found: true, parseOk: false, listedAt: NOW, pdfUrl: PDF }, NOW)
    expect(view).toEqual({ kind: 'unreadable', pdfUrl: PDF })
    expect(isValidNow({ found: true, parseOk: false, listedAt: NOW, pdfUrl: PDF }, NOW)).toBe(false)
  })

  it('an active warning carries every area, matched or not', () => {
    const view = landslideView(active(), NOW)
    expect(view.kind).toBe('active')
    if (view.kind !== 'active') return
    expect(view.warning).toMatchObject({ messageId: 'LEWM-14-11-2026-1600-09', update: 9, pdfUrl: PDF })
    expect(view.warning.areas).toHaveLength(2)
  })
})

describe('the threats chip', () => {
  const warningOf = (mode: Parameters<typeof fakeLandslideAnswer>[0]): ActiveWarning => {
    const view = landslideView(fakeLandslideAnswer(mode, NOW), NOW)
    if (view.kind !== 'active') throw new Error(`${mode} is not active`)
    return view.warning
  }

  it('counts Level 3 and Level 2, and not Level 1', () => {
    expect(chipCounts(warningOf('mixed'))).toEqual({ level3: 2, level2: 3 })
    expect(chipCounts(warningOf('level3'))).toEqual({ level3: 3, level2: 0 })
    expect(chipCounts(warningOf('level2'))).toEqual({ level3: 0, level2: 4 })
    // a Watch-only warning is on the map but not in the chip
    expect(chipCounts(warningOf('level1'))).toEqual({ level3: 0, level2: 0 })
  })

  it('counts every name the warning gives at that level, including one that could not be matched', () => {
    // the unmatched sample adds one Level 1 and one Level 2 name
    expect(chipCounts(warningOf('unmatched'))).toEqual({ level3: 2, level2: 4 })
  })

  it('has its words in the chip wording', () => {
    expect(t('chip.landslide3', { count: 1 })).toBe('landslide evacuation warning in 1 area')
    expect(t('chip.landslide3', { count: 3 })).toBe('landslide evacuation warning in 3 areas')
    expect(t('chip.landslide2', { count: 1 })).toBe('landslide alert in 1 area')
    expect(t('chip.landslide2', { count: 5 })).toBe('landslide alert in 5 areas')
  })
})

describe('which areas are drawn', () => {
  const areasOf = (mode: Parameters<typeof fakeLandslideAnswer>[0]) => {
    const answer = fakeLandslideAnswer(mode, NOW)
    if (!answer.found || !answer.parseOk) throw new Error('not readable')
    return answer.areas
  }
  const levels = (areas: { level: number }[]) => [...new Set(areas.map((a) => a.level))].sort()

  it('Level 3 and Level 2 always show, whatever the switch says, and the switch only adds Level 1', () => {
    expect(isDrawnLevel(3, false)).toBe(true)
    expect(isDrawnLevel(2, false)).toBe(true)
    expect(isDrawnLevel(1, false)).toBe(false)
    for (const level of [1, 2, 3] as const) expect(isDrawnLevel(level, true)).toBe(true)
  })

  it('with the switch off, a mixed warning draws its Level 2 and 3 areas and holds back its Level 1 ones', () => {
    const areas = areasOf('mixed')
    expect(levels(areasToDraw(areas, false))).toEqual([2, 3])
    expect(areasToDraw(areas, false)).toHaveLength(5)
    expect(areasToDraw(areas, true)).toHaveLength(11)
    expect(hiddenWatchAreas(areas, false)).toHaveLength(6)
    expect(hiddenWatchAreas(areas, true)).toEqual([])
  })

  it('a Watch-only warning has nothing to draw with the switch off, so the outlines are not needed', () => {
    const areas = areasOf('level1')
    expect(areasToDraw(areas, false)).toEqual([])
    expect(areasToDraw(areas, true)).toHaveLength(6)
    // Alert-only and Evacuate-only warnings need them either way
    expect(areasToDraw(areasOf('level2'), false)).toHaveLength(4)
    expect(areasToDraw(areasOf('level3'), false)).toHaveLength(3)
  })

  it('never draws a name that has no division, and says nothing is held back for it', () => {
    const areas = areasOf('unmatched')
    expect(areasToDraw(areas, true)).toHaveLength(11)
    expect(areasToDraw(areas, true).every((a) => a.code !== null)).toBe(true)
    // the unmatched Level 1 name is not a Watch area the switch could show
    expect(hiddenWatchAreas(areas, false)).toHaveLength(6)
  })
})

describe('what the colours and outlines are', () => {
  it('Level 1 yellow, Level 2 amber, Level 3 red, none of them a rain colour', () => {
    expect(LEVEL_COLOR).toEqual({ 1: '#facc15', 2: '#f97316', 3: '#dc2626' })
    const rain = new Set([...Object.values(RAIN_COLOR), ...Object.values(MILD_COLOR)].map((c) => c.toLowerCase()))
    for (const color of Object.values(LEVEL_COLOR)) expect(rain.has(color)).toBe(false)
  })

  it('has a light fill and an outline that gets heavier with the level, and only Level 1 dashed', () => {
    const [a, b, c] = ([1, 2, 3] as const).map(areaStyle)
    expect(a.weight).toBeLessThan(b.weight)
    expect(b.weight).toBeLessThan(c.weight)
    expect(a.fillOpacity).toBeLessThan(b.fillOpacity)
    expect(b.fillOpacity).toBeLessThan(c.fillOpacity)
    for (const style of [a, b, c]) {
      expect(style.fillOpacity).toBeGreaterThan(0.2)
      expect(style.fillOpacity).toBeLessThanOrEqual(0.5)
      // an outline you can see at 320 px
      expect(style.weight).toBeGreaterThanOrEqual(2)
    }
    expect([a.dashArray, b.dashArray, c.dashArray]).toEqual(['6 4', undefined, undefined])
    expect(a.fillColor).toBe(LEVEL_COLOR[1])
  })
})

describe('the card', () => {
  const warning = (): ActiveWarning => {
    const view = landslideView(fakeLandslideAnswer('mixed', NOW), NOW)
    if (view.kind !== 'active') throw new Error('not active')
    return view.warning
  }
  const cardOf = (division: string) => {
    const w = warning()
    const { drawn } = placeAreas(w.areas, data)
    const found = drawn.find((d) => d.area.name === division)
    if (!found) throw new Error(`${division} not drawn`)
    return cardContent(found.area, w, found.names)
  }

  it('says the level as NBRO prints it, the division and district, when it was issued and until when', () => {
    const card = cardOf('Aranayake')
    expect(card.level).toBe(3)
    expect(card.levelText).toBe('Level 3 (Red): Evacuate')
    expect(card.place).toBe('Aranayake DS division, Kegalle district')
    // issued 2 hours before NOW (1:30 pm), valid to 24 hours after that (a day later): both with the date
    expect(card.issued).toBe('Issued 15 Nov, 1:30 pm')
    expect(card.validUntil).toBe('Valid until 16 Nov, 1:30 pm')
    expect(card.source).toBe('Source: NBRO via DMC')
    expect(card.pdfUrl).toBe('https://www.dmc.gov.lk/images/dmcreports/TEST_fake_landslide_warning.pdf')
  })

  it('says whether the level was raised, lowered or is new, and nothing when it did not change', () => {
    expect(cardOf('Aranayake').change).toBe('Raised since the last warning')
    expect(cardOf('Eheliyagoda').change).toBe('Raised by 2 levels since the last warning')
    expect(cardOf('Mawanella').change).toBe('Lowered since the last warning')
    expect(cardOf('Ella').change).toBe('Newly added')
    expect(cardOf('Passara').change).toBeNull()
    expect(changeOf({ shift: -2, added: false })).toBe('loweredTwo')
    expect(changeOf({ shift: 0, added: true })).toBe('added')
    expect(changeOf({ shift: 1, added: true })).toBe('added')
  })

  it('links the PDF only when it is on dmc.gov.lk', () => {
    const w = { ...warning(), pdfUrl: 'https://evil.example/images/dmcreports/a.pdf' }
    const { drawn } = placeAreas(w.areas, data)
    expect(cardContent(drawn[0].area, w, drawn[0].names).pdfUrl).toBeNull()
    expect(cardContent(drawn[0].area, { ...w, pdfUrl: null }, drawn[0].names).pdfUrl).toBeNull()
  })

  it('puts the date on Issued whatever the day: "Issued 16 Nov, 6:52 pm", and on Valid until', () => {
    const w = { ...warning(), issuedAt: Date.parse('2026-11-16T13:22:00Z'), validTo: Date.parse('2026-11-16T14:00:00Z') }
    const { drawn } = placeAreas(w.areas, data)
    // 6:52 pm and 7:30 pm in Sri Lanka, the same day as each other and as "now"
    const card = cardContent(drawn[0].area, w, drawn[0].names)
    expect(card.issued).toBe('Issued 16 Nov, 6:52 pm')
    expect(card.validUntil).toBe('Valid until 16 Nov, 7:30 pm')
    expect(sriLankaDateTime(Date.parse('2026-12-01T18:30:00Z'))).toBe('2 Dec, 12:00 am')
  })

  it('names the division and the district in the person’s language, from the boundary file', async () => {
    const w = warning()
    const { drawn } = placeAreas(w.areas, data)
    const aranayake = drawn.find((d) => d.area.name === 'Aranayake')!
    const feature = ds.features.find((f: { properties: { code: string } }) => f.properties.code === 'LK9209').properties
    try {
      await setLanguage('si', false)
      const si = cardContent(aranayake.area, w, aranayake.names)
      expect(si.place).toContain(feature.si)
      expect(si.place).toContain(districtNames.LK92.si)
      expect(si.levelText).toContain('3')
      await setLanguage('ta', false)
      const ta = cardContent(aranayake.area, w, aranayake.names)
      expect(ta.place).toContain(feature.ta)
      expect(ta.place).toContain(districtNames.LK92.ta)
      expect(ta.levelText).toContain('3')
    } finally {
      await setLanguage('en', false)
    }
  })

  it('names a name that could not be matched with its district and level, for the "also named" line', () => {
    const view = landslideView(fakeLandslideAnswer('unmatched', NOW), NOW)
    if (view.kind !== 'active') throw new Error('not active')
    expect(namesWithLevel(unmatchedAreas(view.warning.areas))).toEqual(['Kotmale (Nuwara Eliya, Level 1)', 'Nowhereville (Badulla, Level 2)'])
  })
})

describe('the credits', () => {
  it('say who made the warnings and the boundaries, in the words of the boundary files', () => {
    expect(LANDSLIDE_CREDIT).toBe('Landslide warnings: NBRO, via DMC')
    expect(BOUNDARY_CREDIT).toBe(ds.meta.attribution)
    const readme = readFileSync(join(ROOT, 'README.md'), 'utf8')
    expect(readme).toContain(LANDSLIDE_CREDIT)
    expect(readme).toContain(BOUNDARY_CREDIT)
  })
})
