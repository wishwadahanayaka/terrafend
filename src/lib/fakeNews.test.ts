import { describe, expect, it } from 'vitest'
import { FAKE_NEWS_MODES, fakeNews, fakeNewsModes, type FakeNewsMode } from './fakeNews'
import { groupNews, newsChip, NEWS_CHIP_WINDOW_MS, NEWS_WINDOW_MS } from './news'

const NOW = Date.parse('2026-11-15T10:30:00Z')
const HOUR = 3_600_000

const ALL: FakeNewsMode[] = ['official', 'advisory', 'media', 'alllang', 'dupes']
const grouped = (modes: FakeNewsMode[], language: 'all' | 'en' | 'si' | 'ta' = 'all') => groupNews(fakeNews(modes, NOW), { now: NOW, language })

describe('the switch in the address', () => {
  const modes = (search: string) => fakeNewsModes(search)

  it('is off without ?fakeNews=', () => {
    expect(modes('')).toBeNull()
    expect(modes('?fakeRiver=x:alert')).toBeNull()
  })

  it('reads one or several modes, in a fixed order, ignoring case and spaces', () => {
    expect(modes('?fakeNews=media')).toEqual(['media'])
    expect(modes('?fakeNews=dupes,official')).toEqual(['official', 'dupes'])
    expect(modes('?fakeNews=%20Media%20,FAIL')).toEqual(['media', 'fail'])
  })

  it('means everything useful for "all", nothing, "1" or only names it does not know', () => {
    for (const search of ['?fakeNews=all', '?fakeNews', '?fakeNews=', '?fakeNews=1', '?fakeNews=nonsense']) {
      expect(modes(search), search).toEqual(ALL)
    }
  })

  it('has every value the plan names', () => {
    expect([...FAKE_NEWS_MODES].sort()).toEqual(['advisory', 'alllang', 'dupes', 'empty', 'ended', 'fail', 'long', 'media', 'official', 'old'])
  })
})

describe('the sample headlines', () => {
  it.each(FAKE_NEWS_MODES.filter((m) => m !== 'empty' && m !== 'fail'))('%s: are real headlines, made up, with their own ids', (mode) => {
    const items = fakeNews([mode], NOW)
    expect(items.length).toBeGreaterThan(0)
    expect(new Set(items.map((i) => i.id)).size).toBe(items.length)
    expect(new Set(items.map((i) => i.url)).size).toBe(items.length)
    for (const i of items) {
      expect(i.title.startsWith('TEST ·'), i.title).toBe(true)
      expect(i.publishedAt).toBeLessThanOrEqual(NOW)
      expect(i.fetchedAt).toBeLessThanOrEqual(NOW)
    }
  })

  it('empty gives no headlines', () => {
    expect(fakeNews(['empty'], NOW)).toEqual([])
  })

  it('fail throws, the way a failed load does', () => {
    expect(() => fakeNews(['fail'], NOW)).toThrow('fakeNews=fail')
    expect(() => fakeNews(['media', 'fail'], NOW)).toThrow()
  })

  it('official: DMC’s warning first, then its three reports', () => {
    const { official } = grouped(['official'])
    expect(official.map((i) => i.channel ?? i.source)).toEqual(['dmc_warnings', 'dmc_flood', 'dmc_situation', 'dmc_landslide'].sort((a, b) => order(a) - order(b)))
    expect(official.every((i) => i.kind === 'official')).toBe(true)
    function order(name: string) {
      return ['dmc_warnings', 'dmc_landslide', 'dmc_flood', 'dmc_situation'].indexOf(name)
    }
  })

  it('advisory: the sea and land advisories show, the withdrawn lightning one does not', () => {
    const items = fakeNews(['advisory'], NOW)
    expect(items).toHaveLength(3)
    expect(items.find((i) => i.channel === 'meteo_lightning')?.endedAt).not.toBeNull()
    expect(grouped(['advisory']).official.map((i) => i.channel)).toEqual(['meteo_land', 'meteo_sea'])
  })

  it('media: English reports across several kinds of disaster, newest first inside each', () => {
    const g = grouped(['media'])
    expect(g.official).toEqual([])
    expect(g.storyCount).toBe(6)
    expect(g.groups.map((x) => x.hazard)).toEqual(['landslide', 'flood', 'wind_sea', 'rain', 'elephant', 'road'])
  })

  it('alllang: Sinhala and Tamil reports, which the language filter then separates', () => {
    expect(grouped(['alllang'], 'si').storyCount).toBe(3)
    expect(grouped(['alllang'], 'ta').storyCount).toBe(2)
    expect(grouped(['alllang'], 'en').storyCount).toBe(0)
  })

  it('dupes: two English headlines and three Sinhala ones become one story each', () => {
    const g = grouped(['dupes'])
    expect(g.storyCount).toBe(2)
    const stories = g.groups.flatMap((x) => x.visible)
    const english = stories.find((s) => s.main.language === 'en')!
    const sinhala = stories.find((s) => s.main.language === 'si')!
    expect(english.members).toHaveLength(2)
    expect(english.also).toEqual(['dailymirror'])
    expect(sinhala.members).toHaveLength(3)
    expect(sinhala.also).toEqual(['lankadeepa', 'divaina'])
  })

  it('long: a Tamil headline cut to 300 letters', () => {
    const [long] = fakeNews(['long'], NOW)
    expect(Array.from(long.title)).toHaveLength(300)
    expect(long.title.endsWith('…')).toBe(true)
  })

  it('ended: withdrawn notices exist but are not shown', () => {
    expect(fakeNews(['ended'], NOW)).toHaveLength(2)
    expect(grouped(['ended']).official).toEqual([])
    expect(newsChip(fakeNews(['ended'], NOW), NOW)).toEqual({ count: 0, officialRecent: false })
  })

  it('old: a report 47 hours old is shown and the ones past 48 hours are not', () => {
    const items = fakeNews(['old'], NOW)
    expect(items).toHaveLength(3)
    expect(Math.max(...items.map((i) => NOW - i.publishedAt))).toBeGreaterThan(NEWS_WINDOW_MS)
    const g = grouped(['old'])
    expect(g.storyCount).toBe(1)
    expect(g.official).toEqual([])
    expect(g.groups[0].visible[0].main.publishedAt).toBe(NOW - 47 * HOUR)
  })

  it('all: gives the same stories as the separate sets added up, so none of them wrongly merge', () => {
    const together = grouped(ALL)
    const apart = ALL.reduce((sum, m) => sum + grouped([m]).storyCount, 0)
    expect(together.storyCount).toBe(apart)
    expect(together.official.length).toBe(grouped(['official']).official.length + grouped(['advisory']).official.length)
  })

  it('feeds the chip: a count of the last 24 hours (fewer than the sheet shows) and a recent official notice', () => {
    const items = fakeNews(ALL, NOW)
    const day = groupNews(items, { now: NOW, maxAgeMs: NEWS_CHIP_WINDOW_MS })
    const sheet = groupNews(items, { now: NOW })
    expect(newsChip(items, NOW)).toEqual({ count: day.storyCount + day.official.length, officialRecent: true })
    // the 26-hour-old report about a fallen tree is on the sheet but not in the chip
    expect(newsChip(items, NOW).count).toBeLessThan(sheet.storyCount + sheet.official.length)
    expect(newsChip(fakeNews(['media'], NOW), NOW).officialRecent).toBe(false)
  })

  it('stays the same for the same time, so reloads while testing look the same', () => {
    expect(fakeNews(ALL, NOW)).toEqual(fakeNews(ALL, NOW))
  })
})
