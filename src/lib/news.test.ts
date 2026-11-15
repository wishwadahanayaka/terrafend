import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { setLanguage } from '../i18n'
import en from '../i18n/locales/en'
import { HAZARDS } from '../../supabase/functions/news-refresh/hazards'
import { METEO_FIELDS } from '../../supabase/functions/news-refresh/logic'
import { isOwnLink, tidyTitle } from '../../supabase/functions/news-refresh/shared'
import { SOURCES } from '../../supabase/functions/news-refresh/sources'
import {
  channelName,
  DUPLICATE_WINDOW_MS,
  groupNews,
  isPdfLink,
  newsAriaLabel,
  newsChip,
  newsEntryState,
  newsHazardName,
  newsPillText,
  NEWS_CHIP_WINDOW_MS,
  NEWS_WINDOW_MS,
  parseNewsRow,
  parseNewsRows,
  siteOf,
  sourceName,
  titleWords,
  VISIBLE_PER_HAZARD,
  type NewsItem,
} from './news'

// Every headline here is made up.

const MIN = 60_000
const HOUR = 3_600_000
const NOW = Date.parse('2026-11-15T10:30:00Z')
const iso = (ms: number) => new Date(ms).toISOString()

let nextId = 1
function item(over: Partial<NewsItem> = {}): NewsItem {
  const id = over.id ?? nextId++
  return {
    id,
    url: `https://adaderana.lk/news/${id}`,
    // four words that belong to this id only, so two default headlines are never the same story
    title: `w${id}a w${id}b w${id}c w${id}d`,
    source: 'adaderana_en',
    kind: 'media',
    channel: null,
    language: 'en',
    hazard: 'rain',
    publishedAt: NOW - HOUR,
    fetchedAt: NOW - HOUR + 2 * MIN,
    endedAt: null,
    ...over,
  }
}
const official = (channel: string | null, over: Partial<NewsItem> = {}) =>
  item({ kind: 'official', channel, source: channel?.startsWith('meteo') ? 'meteo_advisory' : 'dmc_situation', language: 'en', hazard: 'other', url: `https://www.dmc.gov.lk/x/${nextId}.pdf`, ...over })

// A database row, as the app asks for it
const row = (over: Record<string, unknown> = {}) => ({
  id: 42,
  url: 'https://adaderana.lk/news/42',
  title: 'Heavy rain lashes Galle district overnight',
  source: 'adaderana_en',
  kind: 'media',
  channel: null,
  language: 'en',
  hazard: 'rain',
  published_at: iso(NOW - HOUR),
  fetched_at: iso(NOW - HOUR + 2 * MIN),
  ended_at: null,
  ...over,
})

describe('reading a row', () => {
  it('turns a good row into a headline, with the times as numbers', () => {
    expect(parseNewsRow(row())).toEqual({
      id: 42,
      url: 'https://adaderana.lk/news/42',
      title: 'Heavy rain lashes Galle district overnight',
      source: 'adaderana_en',
      kind: 'media',
      channel: null,
      language: 'en',
      hazard: 'rain',
      publishedAt: NOW - HOUR,
      fetchedAt: NOW - HOUR + 2 * MIN,
      endedAt: null,
    })
  })

  it('reads an official notice with a channel, and when it was withdrawn', () => {
    const parsed = parseNewsRow(
      row({ id: 7, kind: 'official', channel: 'meteo_sea', source: 'meteo_advisory', url: 'https://meteo.gov.lk/pdfs/sea_pdf.pdf', ended_at: iso(NOW - MIN) }),
    )
    expect(parsed).toMatchObject({ kind: 'official', channel: 'meteo_sea', endedAt: NOW - MIN })
  })

  it.each([
    ['not an object', 'text'],
    ['null', null],
    ['an id that is text', row({ id: '42' })],
    ['a missing title', row({ title: undefined })],
    ['an empty title', row({ title: '   ' })],
    ['a kind that does not exist', row({ kind: 'blog' })],
    ['a language that does not exist', row({ language: 'fr' })],
    ['a hazard that does not exist', row({ hazard: 'meteor' })],
    ['a source code with capitals or spaces', row({ source: 'Ada Derana' })],
    ['a source this version of the app does not know', row({ source: 'newpaper', url: 'https://adaderana.lk/n/1' })],
    ['a channel on a media headline', row({ channel: 'dmc_flood' })],
    ['a channel that is not a code', row({ kind: 'official', channel: 'Not A Code' })],
    ['a date that is not a date', row({ published_at: 'yesterday-ish' })],
    ['no date', row({ fetched_at: null })],
    ['a withdrawn time that is not a date', row({ ended_at: 'soon' })],
  ])('refuses %s', (_name, value) => {
    expect(parseNewsRow(value)).toBeNull()
  })

  it('never throws, whatever it is given', () => {
    for (const bad of [undefined, 5, [], () => 1, { get id(): number { throw new Error('boom') } }]) {
      expect(() => parseNewsRow(bad)).not.toThrow()
    }
  })

  describe('checks the link again, so a bad row in the table cannot send anyone elsewhere', () => {
    it.each([
      'http://adaderana.lk/news/1',
      'https://adaderana.lk.evil.example/news/1',
      'https://evil.example/adaderana.lk/news/1',
      'https://adaderana.lk@evil.example/news/1',
      'https://user:pw@adaderana.lk/news/1',
      'https://adaderana.lk:8443/news/1',
      'https://news.adaderana.lk/news/1',
      'https://evil-adaderana.lk/news/1',
      'javascript:alert(1)',
      'data:text/html,hi',
      '//adaderana.lk/news/1',
      '/news/1',
      '',
    ])('refuses %s', (url) => {
      expect(parseNewsRow(row({ url }))).toBeNull()
    })

    it('holds each source to its own site: a good link for one source is wrong for another', () => {
      expect(parseNewsRow(row({ url: 'https://www.dailymirror.lk/x/1', source: 'dailymirror' }))).not.toBeNull()
      expect(parseNewsRow(row({ url: 'https://www.dailymirror.lk/x/1', source: 'adaderana_en' }))).toBeNull()
    })

    it('uses the very function the news-refresh function checks its links with', () => {
      const own = ['adaderana.lk']
      expect(isOwnLink('https://adaderana.lk/news/1', own)).toBe(true)
      expect(isOwnLink('https://www.adaderana.lk/news/1', own)).toBe(true)
      expect(isOwnLink('http://adaderana.lk/news/1', own)).toBe(false)
      expect(isOwnLink(`https://adaderana.lk/${'a'.repeat(2100)}`, own)).toBe(false)
      const source = readFileSync(join(__dirname, 'news.ts'), 'utf8')
      expect(source).toContain("from '../../supabase/functions/news-refresh/shared'")
      const logic = readFileSync(join(__dirname, '..', '..', 'supabase', 'functions', 'news-refresh', 'logic.ts'), 'utf8')
      expect(logic).toMatch(/export \{[^}]*isOwnLink[^}]*\} from '\.\/shared\.ts'/)
    })
  })

  it('cleans the headline again: no control or direction characters, single spaces, 300 letters', () => {
    expect(parseNewsRow(row({ title: 'Flood\u0007  alert‮ now' }))?.title).toBe('Flood alert now')
    expect(tidyTitle('a⁦b')).toBe('a b')
    const cut = parseNewsRow(row({ title: 'மண்சரிவு '.repeat(60) }))?.title ?? ''
    expect(Array.from(cut)).toHaveLength(300)
    expect(cut.endsWith('…')).toBe(true)
    // the letters Sinhala needs inside words stay
    expect(parseNewsRow(row({ title: 'ශ්‍රී ලංකා' }))?.title).toContain('‍')
  })

  describe('a whole answer', () => {
    it('is a list of headlines, and a good empty list is still a list', () => {
      expect(parseNewsRows([row({ id: 1 }), row({ id: 2 })])?.map((i) => i.id)).toEqual([1, 2])
      expect(parseNewsRows([])).toEqual([])
    })

    it('is null when it is not a list, or when not one row can be read (the table changed)', () => {
      expect(parseNewsRows({ message: 'error' })).toBeNull()
      expect(parseNewsRows(null)).toBeNull()
      expect(parseNewsRows([{ nope: 1 }, { alsoNope: 2 }])).toBeNull()
    })

    it('drops the rows that cannot be read and any id seen twice, and keeps the rest', () => {
      const parsed = parseNewsRows([row({ id: 1 }), { nope: 1 }, row({ id: 1, title: 'again' }), row({ id: 3, url: 'https://evil.example/x' }), row({ id: 4 })])
      expect(parsed?.map((i) => i.id)).toEqual([1, 4])
    })
  })
})

describe('naming the sources', () => {
  afterAll(async () => {
    await setLanguage('en', false)
  })

  const channels = [...new Set([...SOURCES.flatMap((s) => (s.channel ? [s.channel] : [])), ...Object.values(METEO_FIELDS).map((f) => f.channel)])]

  it('says the names the plan gives', async () => {
    await setLanguage('en', false)
    expect(sourceName('dmc_news')).toBe('Disaster Management Centre')
    expect(sourceName('adaderana_si')).toBe('Ada Derana (Sinhala)')
    expect(sourceName('adaderana_ta')).toBe('Ada Derana (Tamil)')
    expect(sourceName('meteo_advisory')).toBe('Department of Meteorology')
    expect(channelName('dmc_situation')).toBe('Situation report')
  })

  it('has a name for every source, including the ones switched off, and none for a source that is not in the list', () => {
    expect(Object.keys(en.news.source).sort()).toEqual(SOURCES.map((s) => s.id).sort())
  })

  it('has a name for every official channel, from DMC and from the Met Department', () => {
    expect(channels.length).toBeGreaterThanOrEqual(8)
    expect(Object.keys(en.news.channel).sort()).toEqual([...channels].sort())
  })

  it.each(['en', 'si', 'ta'] as const)('has them all in %s, each one a real name and not the code', async (lang) => {
    await setLanguage(lang, false)
    for (const { id } of SOURCES) {
      const name = sourceName(id)
      expect(name, id).not.toBe(id)
      expect(name.trim().length, id).toBeGreaterThan(2)
      expect(name, id).not.toMatch(/news\.source|\{\{/)
    }
    for (const channel of channels) {
      const name = channelName(channel)
      expect(name, channel).not.toBe(channel)
      expect(name, channel).not.toMatch(/news\.channel|\{\{/)
    }
  })

  it('writes the names in the language’s own letters', async () => {
    await setLanguage('si', false)
    for (const { id } of SOURCES) expect(sourceName(id), id).toMatch(/[඀-෿]/)
    await setLanguage('ta', false)
    for (const { id } of SOURCES) expect(sourceName(id), id).toMatch(/[஀-௿]/)
  })

  it('shows the code itself for a source it has no name for', async () => {
    await setLanguage('en', false)
    expect(sourceName('somenewpaper')).toBe('somenewpaper')
    expect(channelName('some_channel')).toBe('some_channel')
  })
})

describe('the words of a headline', () => {
  it('leaves out small words and filler words, and ignores case', () => {
    expect([...titleWords('The Heavy Rain in the South AND a Warning')].sort()).toEqual(['heavy', 'rain', 'south', 'warning'])
  })

  it('cuts Sinhala and Tamil words to their first five letters, so endings do not matter', () => {
    expect(titleWords('கனமழையால்')).toEqual(titleWords('கனமழை'))
    expect(titleWords('ගංවතුරක්')).toEqual(titleWords('ගංවතුර'))
  })

  it('reads a Sinhala word the same with or without the joiner letter', () => {
    const withJoiner = 'ශ්‍රී ලංකාව'
    expect(titleWords(withJoiner)).toEqual(titleWords(withJoiner.replace(/‍/g, '')))
  })

  it('gives nothing for an empty headline', () => {
    expect(titleWords('').size).toBe(0)
    expect(titleWords('a an of').size).toBe(0)
  })
})

describe('the official notices', () => {
  const group = (items: NewsItem[], over = {}) => groupNews(items, { now: NOW, ...over })

  it('shows the newest notice of each fixed channel and no older one', () => {
    const older = official('dmc_flood', { publishedAt: NOW - 5 * HOUR })
    const newest = official('dmc_flood', { publishedAt: NOW - 2 * HOUR })
    const other = official('dmc_situation', { publishedAt: NOW - 3 * HOUR })
    expect(group([older, newest, other]).official.map((i) => i.id)).toEqual([newest.id, other.id])
  })

  it('hides a notice that was withdrawn, and an older one does not take its place', () => {
    const live = official('meteo_sea', { publishedAt: NOW - 9 * HOUR })
    const withdrawn = official('meteo_sea', { publishedAt: NOW - 2 * HOUR, endedAt: NOW - HOUR })
    expect(group([live, withdrawn]).official).toEqual([])
    expect(group([live]).official).toHaveLength(1)
  })

  it('hides anything older than 48 hours, and keeps what is exactly 48', () => {
    const exactly = official('dmc_situation', { publishedAt: NOW - NEWS_WINDOW_MS })
    const over = official('dmc_flood', { publishedAt: NOW - NEWS_WINDOW_MS - MIN })
    expect(group([exactly, over]).official.map((i) => i.id)).toEqual([exactly.id])
  })

  it('shows every official item that has no channel (DMC’s warnings and news), not only the newest', () => {
    const w1 = official(null, { source: 'dmc_warnings', publishedAt: NOW - 3 * HOUR })
    const w2 = official(null, { source: 'dmc_warnings', publishedAt: NOW - HOUR })
    const n1 = official(null, { source: 'dmc_news', publishedAt: NOW - 20 * HOUR })
    const gone = official(null, { source: 'dmc_warnings', endedAt: NOW - MIN })
    expect(group([n1, w1, gone, w2]).official.map((i) => i.id)).toEqual([w2.id, w1.id, n1.id])
  })

  it('lists DMC’s warnings first, then the channels from the most urgent kind, then DMC’s other news', () => {
    const news = official(null, { source: 'dmc_news' })
    const situation = official('dmc_situation')
    const tsunami = official('meteo_tsunami')
    const sea = official('meteo_sea')
    const landslide = official('dmc_landslide')
    const warning = official(null, { source: 'dmc_warnings' })
    const ids = group([news, situation, sea, landslide, tsunami, warning]).official.map((i) => i.channel ?? i.source)
    expect(ids).toEqual(['dmc_warnings', 'meteo_tsunami', 'meteo_sea', 'dmc_landslide', 'dmc_situation', 'dmc_news'])
  })

  it('does not filter them by language, since they are the ones that matter', () => {
    const sit = official('dmc_situation')
    expect(group([sit], { language: 'ta' }).official).toHaveLength(1)
    expect(group([sit], { language: 'si' }).official).toHaveLength(1)
  })

  it('never puts a news report among them', () => {
    expect(group([item()]).official).toEqual([])
  })
})

describe('the same story from several outlets', () => {
  const group = (items: NewsItem[], over = {}) => groupNews(items, { now: NOW, ...over })
  const stories = (items: NewsItem[], over = {}) => group(items, over).groups.flatMap((g) => [...g.visible, ...g.more])

  const heavyRain = (over: Partial<NewsItem>) => item({ title: 'Heavy rain warning issued for seven provinces', ...over })

  it('is one story, led by the newest headline, with the other outlets named', () => {
    const a = heavyRain({ source: 'adaderana_en', publishedAt: NOW - 25 * MIN })
    const b = heavyRain({ source: 'dailymirror', title: 'Warning issued over heavy rain in seven provinces', publishedAt: NOW - 50 * MIN })
    const [story, ...rest] = stories([b, a])
    expect(rest).toEqual([])
    expect(story.main.id).toBe(a.id)
    expect(story.members.map((m) => m.id)).toEqual([a.id, b.id])
    expect(story.also).toEqual(['dailymirror'])
  })

  it('names each other outlet once, newest first, and never the main headline’s own outlet', () => {
    const main = heavyRain({ source: 'adaderana_si', language: 'si', title: 'රත්නපුර දිස්ත්‍රික්කයේ ගංවතුර අවදානම', hazard: 'flood', publishedAt: NOW - 10 * MIN })
    const second = item({ ...main, id: 900, source: 'lankadeepa', title: 'රත්නපුර දිස්ත්‍රික්කයේ ගංවතුර අවදානමක්', publishedAt: NOW - 30 * MIN })
    const third = item({ ...main, id: 901, source: 'divaina', title: 'රත්නපුරයේ ගංවතුර අවදානම ඉහළයි', publishedAt: NOW - 50 * MIN })
    const again = item({ ...main, id: 902, source: 'lankadeepa', title: 'රත්නපුර දිස්ත්‍රික්කයේ ගංවතුර අවදානම', publishedAt: NOW - 60 * MIN })
    const own = item({ ...main, id: 903, source: 'adaderana_si', title: 'රත්නපුර දිස්ත්‍රික්කයේ ගංවතුර අවදානම', publishedAt: NOW - 70 * MIN })
    const all = stories([own, again, third, second, main])
    expect(all).toHaveLength(1)
    expect(all[0].also).toEqual(['lankadeepa', 'divaina'])
    expect(all[0].members).toHaveLength(5)
  })

  it('counts as one story in the totals', () => {
    const a = heavyRain({ publishedAt: NOW - 20 * MIN })
    const b = heavyRain({ source: 'dailymirror', publishedAt: NOW - 40 * MIN })
    expect(group([a, b]).storyCount).toBe(1)
    expect(group([a, b]).groups[0]).toMatchObject({ hazard: 'rain', total: 1 })
  })

  it('does not join headlines in different languages, however alike they look', () => {
    const si = heavyRain({ language: 'si', source: 'adaderana_si' })
    expect(stories([heavyRain({}), si])).toHaveLength(2)
  })

  it('does not join headlines filed under different hazards', () => {
    expect(stories([heavyRain({ hazard: 'rain' }), heavyRain({ hazard: 'flood' })])).toHaveLength(2)
  })

  it('does not join headlines more than 36 hours apart, and does at 36', () => {
    const now = heavyRain({ publishedAt: NOW - HOUR })
    expect(stories([now, heavyRain({ publishedAt: NOW - HOUR - DUPLICATE_WINDOW_MS - MIN })])).toHaveLength(2)
    expect(stories([now, heavyRain({ publishedAt: NOW - HOUR - DUPLICATE_WINDOW_MS })])).toHaveLength(1)
  })

  it('keeps apart headlines that only share a place or a word or two', () => {
    const a = item({ title: 'Heavy rain in Galle' })
    const b = item({ title: 'Heavy rain in Matara' })
    const c = item({ title: 'Rain forecast for the weekend' })
    expect(stories([a, b, c])).toHaveLength(3)
  })

  it('joins a short headline only when it is the same words', () => {
    expect(stories([item({ title: 'Flood alert' }), item({ title: 'Flood alert' })])).toHaveLength(1)
    expect(stories([item({ title: 'Flood alert' }), item({ title: 'Flood damage' })])).toHaveLength(2)
  })

  it('cannot be stretched into a chain: a headline is compared with the story’s main one only', () => {
    // A and B share half their words, B and C share half theirs, A and C share none
    const a = item({ title: 'alpha bravo charlie delta echo foxtrot', publishedAt: NOW - 10 * MIN })
    const b = item({ title: 'delta echo foxtrot golf hotel india', publishedAt: NOW - 20 * MIN })
    const c = item({ title: 'golf hotel india juliet kilo lima', publishedAt: NOW - 30 * MIN })
    const result = stories([a, b, c])
    expect(result.map((s) => s.members.map((m) => m.id))).toEqual([[a.id, b.id], [c.id]])
  })

  it('does not depend on the order the headlines arrive in', () => {
    const a = heavyRain({ publishedAt: NOW - 20 * MIN })
    const b = heavyRain({ source: 'dailymirror', publishedAt: NOW - 40 * MIN })
    const c = item({ title: 'Landslide warning extended', hazard: 'landslide' })
    const one = group([a, b, c])
    const two = group([c, b, a])
    expect(two).toEqual(one)
  })

  it('joins Sinhala headlines whose words end differently', () => {
    const a = item({ language: 'si', source: 'adaderana_si', hazard: 'flood', title: 'කළුතර දිස්ත්‍රික්කයේ ගංවතුර තත්ත්වයක්', publishedAt: NOW - 20 * MIN })
    const b = item({ language: 'si', source: 'lankadeepa', hazard: 'flood', title: 'කළුතර දිස්ත්‍රික්කයේ ගංවතුර තත්ත්වය', publishedAt: NOW - 40 * MIN })
    expect(stories([a, b])).toHaveLength(1)
  })
})

describe('the news reports, by kind of disaster', () => {
  const group = (items: NewsItem[], over = {}) => groupNews(items, { now: NOW, ...over })
  // headlines that share no words, so none of them are the same story
  const distinct = (n: number, over: Partial<NewsItem> = {}) =>
    Array.from({ length: n }, (_, i) => item({ title: `${['quartz', 'amber', 'cobalt', 'ivory', 'jasper', 'onyx', 'topaz'][i]} ${['river', 'bridge', 'harbour', 'valley', 'temple', 'market', 'station'][i]} ${['rises', 'closes', 'floods', 'drains', 'shakes', 'burns', 'sinks'][i]}`, publishedAt: NOW - (i + 1) * 10 * MIN, ...over }))

  it('lists the hazards in the fixed order, and leaves out the empty ones', () => {
    const items = [item({ hazard: 'road' }), item({ hazard: 'rain' }), item({ hazard: 'tsunami' }), item({ hazard: 'flood' })]
    const order = group(items).groups.map((g) => g.hazard)
    expect(order).toEqual(HAZARDS.filter((h) => ['road', 'rain', 'tsunami', 'flood'].includes(h)))
    expect(order[0]).toBe('tsunami')
  })

  it(`shows ${VISIBLE_PER_HAZARD} stories per hazard, newest first, and the rest behind "show more"`, () => {
    const items = distinct(5)
    const [rain] = group(items).groups
    expect(rain.total).toBe(5)
    expect(rain.visible.map((s) => s.main.id)).toEqual(items.slice(0, VISIBLE_PER_HAZARD).map((i) => i.id))
    expect(rain.more.map((s) => s.main.id)).toEqual(items.slice(VISIBLE_PER_HAZARD).map((i) => i.id))
  })

  it('has no "show more" for a hazard with three or fewer', () => {
    const [rain] = group(distinct(3)).groups
    expect(rain.more).toEqual([])
    expect(rain.visible).toHaveLength(3)
  })

  it('hides reports older than 48 hours', () => {
    const fresh = item({ publishedAt: NOW - NEWS_WINDOW_MS })
    const old = item({ publishedAt: NOW - NEWS_WINDOW_MS - MIN })
    expect(group([fresh, old]).storyCount).toBe(1)
  })

  describe('the language filter', () => {
    const items = [item({ language: 'en' }), item({ language: 'si', source: 'adaderana_si' }), item({ language: 'ta', source: 'adaderana_ta' })]

    it('shows one language of news reports, or all', () => {
      expect(group(items, { language: 'all' }).storyCount).toBe(3)
      expect(group(items).storyCount).toBe(3)
      for (const lang of ['en', 'si', 'ta'] as const) {
        const grouped = group(items, { language: lang })
        expect(grouped.storyCount).toBe(1)
        expect(grouped.groups[0].visible[0].main.language).toBe(lang)
      }
    })

    it('gives nothing when there are no reports in that language', () => {
      expect(group([items[0]], { language: 'ta' })).toEqual({ official: [], groups: [], storyCount: 0 })
    })
  })

  it('gives an empty result for nothing', () => {
    expect(group([])).toEqual({ official: [], groups: [], storyCount: 0 })
  })
})

describe('the chip', () => {
  const chip = (items: NewsItem[]) => newsChip(items, NOW)

  it('counts the last 24 hours, with the same story from several outlets counted once', () => {
    const a = item({ title: 'Heavy rain warning issued for seven provinces', publishedAt: NOW - 20 * MIN })
    const b = item({ title: 'Warning issued over heavy rain in seven provinces', source: 'dailymirror', publishedAt: NOW - 40 * MIN })
    const c = item({ title: 'Landslide warning extended to four districts', hazard: 'landslide' })
    expect(chip([a, b, c]).count).toBe(2)
  })

  it('leaves out what is older than 24 hours, though the sheet still shows it', () => {
    const recent = item({ publishedAt: NOW - 23 * HOUR })
    const older = item({ publishedAt: NOW - 25 * HOUR })
    expect(chip([recent, older]).count).toBe(1)
    expect(groupNews([recent, older], { now: NOW }).storyCount).toBe(2)
    expect(NEWS_CHIP_WINDOW_MS).toBe(24 * HOUR)
  })

  it('counts news reports in every language, and official notices too', () => {
    const items = [
      item({ language: 'en' }),
      item({ language: 'si', source: 'adaderana_si' }),
      item({ language: 'ta', source: 'adaderana_ta' }),
      official('dmc_flood'),
    ]
    expect(chip(items).count).toBe(4)
  })

  it('says whether an official notice came out in the last 24 hours', () => {
    expect(chip([official('meteo_sea', { publishedAt: NOW - 2 * HOUR })]).officialRecent).toBe(true)
    expect(chip([official(null, { source: 'dmc_warnings', publishedAt: NOW - 23 * HOUR })]).officialRecent).toBe(true)
    expect(chip([official('dmc_situation', { publishedAt: NOW - 26 * HOUR })]).officialRecent).toBe(false)
    expect(chip([item()]).officialRecent).toBe(false)
  })

  it('does not count a withdrawn notice, nor flag it', () => {
    const withdrawn = official('meteo_tsunami', { publishedAt: NOW - 3 * HOUR, endedAt: NOW - HOUR })
    expect(chip([withdrawn])).toEqual({ count: 0, officialRecent: false })
  })

  it('counts only the newest notice of a channel', () => {
    const items = [official('dmc_flood', { publishedAt: NOW - 3 * HOUR }), official('dmc_flood', { publishedAt: NOW - HOUR })]
    expect(chip(items).count).toBe(1)
  })

  it('is zero and not flagged for nothing', () => {
    expect(chip([])).toEqual({ count: 0, officialRecent: false })
  })
})

describe('what the app downloads', () => {
  const root = join(__dirname, '..', '..')
  const read = (...parts: string[]) => readFileSync(join(root, ...parts), 'utf8')
  const importsOf = (file: string) => [...file.matchAll(/from '([^']+)'/g)].map((m) => m[1])

  it('never pulls the keyword lists or the function’s logic into the phone’s download', () => {
    const files = [
      ['src', 'lib', 'news.ts'],
      ['src', 'lib', 'newsFetch.ts'],
      ['src', 'lib', 'useNews.ts'],
      ['src', 'lib', 'fakeNews.ts'],
      ['supabase', 'functions', 'news-refresh', 'shared.ts'],
      ['supabase', 'functions', 'news-refresh', 'hazards.ts'],
      ['supabase', 'functions', 'news-refresh', 'sources.ts'],
    ]
    for (const parts of files) {
      for (const from of importsOf(read(...parts))) {
        expect(from, parts.join('/')).not.toMatch(/keywords|news-refresh\/logic|\.\/logic/)
      }
    }
  })
})

describe('what the chip and the Layers entry show', () => {
  const items = [item(), official('dmc_flood', { publishedAt: NOW - 2 * HOUR })]

  it('is the count of the last 24 hours once the headlines are there', () => {
    expect(newsEntryState(items, false, NOW)).toEqual({ count: 2, officialRecent: true })
    expect(newsEntryState([], false, NOW)).toEqual({ count: 0, officialRecent: false })
  })

  it('is nothing yet while the first load has not finished', () => {
    expect(newsEntryState(undefined, false, NOW)).toBeNull()
  })

  it('is a bare entry without a number when the load failed and nothing is saved', () => {
    expect(newsEntryState(undefined, true, NOW)).toEqual({ count: null, officialRecent: false })
  })

  it('prefers the headlines on hand to a failure, so a failed refresh does not hide them', () => {
    expect(newsEntryState(items, true, NOW)).toEqual({ count: 2, officialRecent: true })
  })

  it('uses the clock it is given, so saved headlines read right when opened hours later', () => {
    expect(newsEntryState(items, false, NOW + 25 * HOUR)).toEqual({ count: 0, officialRecent: false })
  })

  it('is asked "has it failed", not "is it failing now", so a retry does not make the entry vanish', () => {
    const hook = readFileSync(join(__dirname, 'useNewsChip.ts'), 'utf8')
    expect(hook).toContain('query.errorUpdatedAt > 0')
    expect(hook).not.toMatch(/query.isError|query.isPending/)
  })
})

describe.each(['en', 'si', 'ta'] as const)('the words on the chip and the headings, in %s', (lang) => {
  afterAll(async () => {
    await setLanguage('en', false)
  })

  it('says "News 4" for a count, and just "News" when there is nothing to count', async () => {
    await setLanguage(lang, false)
    expect(newsPillText(4)).toMatch(/4/)
    expect(newsPillText(4)).not.toBe(newsPillText(null))
    expect(newsPillText(0)).toBe(newsPillText(null))
    for (const text of [newsPillText(4), newsPillText(null)]) expect(text).not.toMatch(/news.chip|{{/)
  })

  it('has a screen-reader label with the number, and says so when there is an official notice', async () => {
    await setLanguage(lang, false)
    const plain = newsAriaLabel(3, false)
    const official = newsAriaLabel(3, true)
    expect(plain).toMatch(/3/)
    expect(official).toMatch(/3/)
    expect(official).not.toBe(plain)
    expect(official.length).toBeGreaterThan(plain.length)
    expect(newsAriaLabel(1, false)).toMatch(/1/)
    expect(newsAriaLabel(null, false)).toBe(newsAriaLabel(0, true))
    for (const text of [plain, official, newsAriaLabel(null, false)]) expect(text).not.toMatch(/news.chip|{{/)
  })

  it('has a heading for every kind of hazard', async () => {
    await setLanguage(lang, false)
    for (const hazard of HAZARDS) {
      const name = newsHazardName(hazard)
      expect(name, hazard).not.toBe(hazard)
      expect(name, hazard).not.toMatch(/news.hazard|{{/)
      expect(name.trim().length, hazard).toBeGreaterThan(2)
      if (lang === 'si') expect(name, hazard).toMatch(/[඀-෿]/)
      if (lang === 'ta') expect(name, hazard).toMatch(/[஀-௿]/)
    }
  })
})

describe('headings and links', () => {
  it('has a name for every hazard in the English file and none left over', () => {
    expect(Object.keys(en.news.hazard).sort()).toEqual([...HAZARDS].sort())
  })

  it('shows the code for a hazard it has no name for', () => {
    expect(newsHazardName('meteor')).toBe('meteor')
  })

  it('names the site of a link without www., for "Read on dmc.gov.lk"', () => {
    expect(siteOf('https://www.dmc.gov.lk/index.php?option=x')).toBe('dmc.gov.lk')
    expect(siteOf('https://adaderana.lk/news/1')).toBe('adaderana.lk')
    expect(siteOf('not a link')).toBe('not a link')
  })

  it('tells a PDF notice from a page', () => {
    expect(isPdfLink('https://www.dmc.gov.lk/images/dmcreports/LEWM_14.pdf')).toBe(true)
    expect(isPdfLink('https://meteo.gov.lk/pdfs/sea_pdf.PDF')).toBe(true)
    expect(isPdfLink('https://www.dmc.gov.lk/index.php?option=com_content&view=article&id=1788')).toBe(false)
    expect(isPdfLink('https://example.org/a.pdf.html')).toBe(false)
    expect(isPdfLink('nonsense')).toBe(false)
  })
})
