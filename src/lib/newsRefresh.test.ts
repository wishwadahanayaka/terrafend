import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import {
  BACKOFF_MIN,
  BLOCKED_MIN,
  cleanTitle,
  decodeEntities,
  describeError,
  emptyState,
  isAuthorised,
  isDue,
  FETCH_TIMEOUT_MS,
  isFeed,
  jsonResponse,
  MAX_BYTES,
  MAX_ITEMS_PER_SOURCE,
  MAX_TITLE,
  MIN_REQUEST_MS,
  RUN_DEADLINE_MS,
  timeoutFor,
  normaliseUrl,
  parseDate,
  parseDmcList,
  parseFeed,
  parseMeteo,
  publishedAt,
  readCapped,
  refresh,
  robotsVerdict,
  RUN_BUDGET_MS,
  USER_AGENT,
  type Deps,
  type FetchResult,
  type NewsRow,
  type SourceState,
} from '../../supabase/functions/news-refresh/logic'
import { SOURCES, type Source } from '../../supabase/functions/news-refresh/sources'

// Nothing here reaches a news site, Supabase or the real news-refresh function: every request is
// answered by a stand-in. All headlines are made up.

const MIN = 60_000
const NOW = Date.parse('2026-11-15T09:19:00Z')
const source = (id: string): Source => {
  const found = SOURCES.find((s) => s.id === id)
  if (!found) throw new Error(id)
  return found
}
const ADA = source('adaderana_en')
const DM = source('dailymirror')
const TAMIL = source('tamilmirror')
const DMC_WARN = source('dmc_warnings')
const DMC_NEWS = source('dmc_news')
const DMC_LAND = source('dmc_landslide')
const DMC_SIT = source('dmc_situation')
// Switched on here only: in the real list it is off (it times out from Supabase), but its code and
// tests stay, so it can be turned back on in sources.ts
const METEO: Source = { ...source('meteo_advisory'), enabled: true }

// ---- Stand-in answers ----

const headers = (h: Partial<FetchResult['headers']> = {}): FetchResult['headers'] => ({ etag: null, lastModified: null, location: null, ...h })
const ok = (body: string, h: Partial<FetchResult['headers']> = {}): FetchResult => ({ status: 200, headers: headers(h), body, tooBig: false })
const code = (status: number, h: Partial<FetchResult['headers']> = {}): FetchResult => ({ status, headers: headers(h), body: null, tooBig: false })

type Item = { title: string; link: string; date?: string }
const rss = (items: Item[]) =>
  `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>Test feed</title>` +
  items
    .map(
      (i) =>
        `<item><title>${i.title}</title><link>${i.link}</link>${i.date ? `<pubDate>${i.date}</pubDate>` : ''}` +
        `<description>FULL ARTICLE TEXT THAT IS NEVER STORED</description></item>`,
    )
    .join('') +
  `</channel></rss>`

const dmcPage = (rows: { title: string; date: string; time: string; href: string }[]) =>
  `<table><tr><td><input type="text" id="fromdate"/></td><td><button>x</button></td></tr></table>` +
  `<table class="table"><tr class="mhead "><td>Title</td><td class="sandplus">Date</td><td class="sandplus">Time (24h)</td><td class="sandplus down"></td></tr>` +
  rows
    .map(
      (r) =>
        `<tr class="rowdate_0">\n<td>${r.title}</td>\n<td>${r.date}</td>\n<td>${r.time}</td>\n` +
        `<td class="sandplustd"><a onclick="window.open(this.href,'_blank');return false;" href="${r.href}">Download</a></td>\n</tr>`,
    )
    .join('') +
  `</table>`

const meteo = (advisory: Record<string, string>) =>
  JSON.stringify({
    severe_weather_advisory: { lighting_pdf: '', tsunami_pdf: '', land_pdf: '', sea_pdf: '', heat_pdf: '', ...advisory },
    public_weather_forecast: 'A forecast text that is not read',
  })

type Reply = FetchResult | Error | ((init: { method: string; headers: Record<string, string> }) => FetchResult)

function setup(routes: Record<string, Reply>, sources: Source[], states: SourceState[] = [], over: Partial<Deps> = {}) {
  const calls: { url: string; method: string; headers: Record<string, string>; timeoutMs: number }[] = []
  const fetch = vi.fn<Deps['fetch']>(async (url, init) => {
    calls.push({ url, ...init })
    // A site with no robots.txt allows everything
    const reply = routes[url] ?? (url.endsWith('/robots.txt') ? code(404) : undefined)
    if (reply === undefined) throw new Error(`no stand-in for ${url}`)
    if (reply instanceof Error) throw reply
    return typeof reply === 'function' ? reply(init) : reply
  })
  const writeItems = vi.fn<Deps['writeItems']>(async (rows) => rows.length)
  const markEnded = vi.fn<Deps['markEnded']>(async () => {})
  const writeStates = vi.fn<Deps['writeStates']>(async () => {})
  const deps: Deps = {
    now: () => NOW,
    sources,
    fetch,
    readStates: async () => states,
    writeItems,
    markEnded,
    writeStates,
    log: vi.fn(),
    ...over,
  }
  const stored = (): NewsRow[] => writeItems.mock.calls.flatMap((c) => c[0])
  const savedState = (id: string): SourceState | undefined => writeStates.mock.calls.at(-1)?.[0].find((s) => s.source === id)
  return { deps, calls, fetch, writeItems, markEnded, writeStates, stored, savedState }
}

const state = (id: string, over: Partial<SourceState> = {}): SourceState => ({ ...emptyState(id), ...over })
const ago = (minutes: number) => new Date(NOW - minutes * MIN).toISOString()

const ADA_FEED = rss([
  { title: 'Heavy rain lashes Galle district overnight', link: 'https://adaderana.lk/news/1001', date: 'Sun, 15 Nov 2026 08:30:00 GMT' },
  { title: 'Minister opens a new library', link: 'https://adaderana.lk/news/1002', date: 'Sun, 15 Nov 2026 08:10:00 GMT' },
  { title: 'Landslide blocks a road near Kegalle', link: 'https://adaderana.lk/news/1003', date: 'Sun, 15 Nov 2026 07:00:00 GMT' },
])

// ---- Tests ----

describe('who may call the function', () => {
  it('lets in the right secret only, and nobody when none is set', async () => {
    expect(await isAuthorised('s3cret', 's3cret')).toBe(true)
    expect(await isAuthorised('s3cret!', 's3cret')).toBe(false)
    expect(await isAuthorised(null, 's3cret')).toBe(false)
    expect(await isAuthorised('anything', undefined)).toBe(false)
    expect(await isAuthorised('', '')).toBe(false)
  })
})

describe('headlines as stored', () => {
  it('unwraps CDATA, decodes entities (even twice-escaped ones) and drops tags', () => {
    expect(cleanTitle('<![CDATA[Rain &amp; wind <b>warning</b>]]>')).toBe('Rain & wind warning')
    expect(cleanTitle('Officials&amp;#8217; warning')).toBe('Officials’ warning')
    expect(decodeEntities('&#x26;&#38;&lt;&gt;&quot;&apos;')).toBe('&&<>"\'')
  })

  it('removes control and text-direction characters but keeps the Sinhala joiner', () => {
    expect(cleanTitle('Flood\u0007 alert‮')).toBe('Flood alert')
    expect(cleanTitle('ශ්‍රී ලංකාව')).toContain('‍')
  })

  it(`cuts at ${MAX_TITLE} characters, counting Sinhala and Tamil letters properly`, () => {
    const long = 'வெள்ளம் '.repeat(80)
    const out = cleanTitle(long)
    expect(Array.from(out)).toHaveLength(MAX_TITLE)
    expect(out.endsWith('…')).toBe(true)
  })

  it('gives an empty string for an empty or tag-only headline', () => {
    expect(cleanTitle('  ')).toBe('')
    expect(cleanTitle('<br/>')).toBe('')
  })
})

describe('links as stored', () => {
  const own = ['adaderana.lk']

  it('keeps https links on the source’s own site, with or without www.', () => {
    expect(normaliseUrl('https://adaderana.lk/news/1', 'https://adaderana.lk/rss.xml', own)).toBe('https://adaderana.lk/news/1')
    expect(normaliseUrl('https://www.adaderana.lk/news/1', 'https://adaderana.lk/rss.xml', own)).toBe('https://www.adaderana.lk/news/1')
  })

  it('moves http up to https and resolves relative links', () => {
    expect(normaliseUrl('http://adaderana.lk/news/1', 'https://adaderana.lk/', own)).toBe('https://adaderana.lk/news/1')
    expect(normaliseUrl('/images/a.pdf', 'https://www.dmc.gov.lk/index.php?x=1', ['dmc.gov.lk'])).toBe('https://www.dmc.gov.lk/images/a.pdf')
  })

  it.each([
    'https://adaderana.lk.evil.com/news/1',
    'https://evil.com/adaderana.lk/news/1',
    'https://adaderana.lk@evil.com/news/1',
    'https://user:pw@adaderana.lk/news/1',
    'https://adaderana.lk:8443/news/1',
    'https://news.adaderana.lk/news/1',
    'https://evil-adaderana.lk/news/1',
    'javascript:alert(1)',
    'ftp://adaderana.lk/news/1',
    'data:text/html,hi',
  ])('refuses %s', (link) => {
    expect(normaliseUrl(link, 'https://adaderana.lk/rss.xml', own)).toBeNull()
  })

  it('drops tracking parameters and the #part, and keeps the rest', () => {
    expect(normaliseUrl('https://adaderana.lk/news?id=5&utm_source=rss&fbclid=x#top', 'https://adaderana.lk/', own)).toBe(
      'https://adaderana.lk/news?id=5',
    )
  })

  it('percent-encodes Tamil and Sinhala in the path, and refuses links over 2048 characters', () => {
    const url = normaliseUrl('https://www.tamilmirror.lk/செய்திகள்/மழை', 'https://www.tamilmirror.lk/', ['tamilmirror.lk'])
    expect(url).toMatch(/^https:\/\/www\.tamilmirror\.lk\/%E0%AE/)
    expect(normaliseUrl(`https://adaderana.lk/${'a'.repeat(2100)}`, 'https://adaderana.lk/', own)).toBeNull()
  })
})

describe('times', () => {
  it('reads the formats the sources use', () => {
    expect(parseDate('Sun, 15 Nov 2026 09:14:24 GMT')).toBe(Date.parse('2026-11-15T09:14:24Z'))
    expect(parseDate('Sat, 14 Nov 2026 19:35:00 +0000')).toBe(Date.parse('2026-11-14T19:35:00Z'))
    expect(parseDate('2026-11-15T12:08:00+05:30')).toBe(Date.parse('2026-11-15T06:38:00Z'))
    expect(parseDate('<![CDATA[Sun, 15 Nov 2026 09:14:24 GMT]]>')).toBe(Date.parse('2026-11-15T09:14:24Z'))
  })

  it('reads a time with no zone (Daily Mirror, DMC tables) as Sri Lanka time', () => {
    expect(parseDate('2026-11-15 14:06:00')).toBe(Date.parse('2026-11-15T08:36:00Z'))
    expect(parseDate('2026-11-14 16:00')).toBe(Date.parse('2026-11-14T10:30:00Z'))
    expect(parseDate('Sun, 15 Nov 2026 14:06:00')).toBe(Date.parse('2026-11-15T08:36:00Z'))
  })

  it('gives null for nothing or nonsense', () => {
    expect(parseDate(null)).toBeNull()
    expect(parseDate('')).toBeNull()
    expect(parseDate('yesterday')).toBeNull()
    expect(parseDate('Sun, 15 Nov 1890 09:14:24 GMT')).toBeNull()
  })

  it('uses the run time for a missing or future time, and drops anything over 7 days old', () => {
    expect(publishedAt(null, NOW)).toBe(NOW)
    expect(publishedAt(NOW + 3 * 60 * MIN, NOW)).toBe(NOW)
    expect(publishedAt(NOW - 6 * 24 * 60 * MIN, NOW)).toBe(NOW - 6 * 24 * 60 * MIN)
    expect(publishedAt(NOW - 8 * 24 * 60 * MIN, NOW)).toBeNull()
  })
})

describe('reading feeds', () => {
  it('reads the headline, link and time of each RSS item, and nothing else', () => {
    const items = parseFeed(ADA_FEED)
    expect(items).toHaveLength(3)
    expect(items[0]).toEqual({
      title: 'Heavy rain lashes Galle district overnight',
      link: 'https://adaderana.lk/news/1001',
      date: 'Sun, 15 Nov 2026 08:30:00 GMT',
    })
    expect(JSON.stringify(items)).not.toContain('FULL ARTICLE TEXT')
  })

  it('decodes &amp; in links (DMC writes them that way)', () => {
    const [item] = parseFeed(rss([{ title: 'x', link: 'https://www.dmc.gov.lk/index.php?option=a&amp;id=5' }]))
    expect(item.link).toBe('https://www.dmc.gov.lk/index.php?option=a&id=5')
  })

  it('reads Atom entries, taking the alternate link', () => {
    const atom =
      '<feed xmlns="http://www.w3.org/2005/Atom"><entry><title type="html">Flood update</title>' +
      '<link rel="self" href="https://adaderana.lk/self"/><link rel="alternate" href="https://adaderana.lk/news/7"/>' +
      '<updated>2026-11-15T08:00:00Z</updated></entry></feed>'
    expect(isFeed(atom)).toBe(true)
    expect(parseFeed(atom)).toEqual([{ title: 'Flood update', link: 'https://adaderana.lk/news/7', date: '2026-11-15T08:00:00Z' }])
  })

  it('falls back to a guid that is a link', () => {
    const feed = '<rss><channel><item><title>A</title><guid isPermaLink="true">https://adaderana.lk/news/9</guid></item></channel></rss>'
    expect(parseFeed(feed)[0].link).toBe('https://adaderana.lk/news/9')
  })

  it('tells a feed from an HTML page', () => {
    expect(isFeed(ADA_FEED)).toBe(true)
    expect(isFeed('<!DOCTYPE html><html><body>Not here</body></html>')).toBe(false)
  })
})

describe("DMC's report tables", () => {
  it('reads each report row and skips the header and the search form', () => {
    const rows = parseDmcList(
      dmcPage([
        { title: 'Landslide Warning', date: '2026-11-14', time: '16:00', href: '/images/dmcreports/LEWM_14.pdf' },
        { title: 'Landslide Warning', date: '2026-11-13', time: '9:30', href: '/images/dmcreports/LEWM_13.pdf' },
      ]),
    )
    expect(rows).toEqual([
      { title: 'Landslide Warning', date: '2026-11-14', time: '16:00', href: '/images/dmcreports/LEWM_14.pdf' },
      { title: 'Landslide Warning', date: '2026-11-13', time: '09:30', href: '/images/dmcreports/LEWM_13.pdf' },
    ])
  })

  it('finds nothing in a page with another layout', () => {
    expect(parseDmcList('<html><body><p>Reports moved</p></body></html>')).toEqual([])
  })
})

describe("the Met Department's advisories", () => {
  it('lists only the fields that hold a PDF', () => {
    expect(parseMeteo(meteo({})).active).toEqual([])
    expect(parseMeteo(meteo({ sea_pdf: 'pdfs/sea_pdf.pdf' })).active).toEqual([{ field: 'sea_pdf', path: 'pdfs/sea_pdf.pdf' }])
  })

  it('notes fields it does not know, without storing them', () => {
    expect(parseMeteo(meteo({ flood_pdf: 'pdfs/flood.pdf' })).unknown).toEqual(['flood_pdf'])
  })

  it('throws when the advisory block is gone or the file is not JSON', () => {
    expect(() => parseMeteo('{"other": 1}')).toThrow()
    expect(() => parseMeteo('<html>')).toThrow()
  })
})

describe('robots.txt', () => {
  it('allows everything when there are no rules for us (Ada Derana only blocks one crawler)', () => {
    expect(robotsVerdict('User-agent: Bytespider\nDisallow: /\n\nSitemap: https://x/s.xml', '/rss.xml')).toEqual({ allowed: true, crawlDelaySec: 0 })
  })

  it('allows everything when the "robots.txt" is a web page (DMC answers with its homepage)', () => {
    expect(robotsVerdict('<!DOCTYPE html><html><head><title>DMC</title></head></html>', '/index.php').allowed).toBe(true)
  })

  it('follows Disallow and Allow, longest rule first, Allow on a tie', () => {
    const file = 'User-agent: *\nDisallow: /news/\nAllow: /news/rss\nDisallow: /a$\nAllow: /b\nDisallow: /b'
    expect(robotsVerdict(file, '/news/12').allowed).toBe(false)
    expect(robotsVerdict(file, '/news/rss.xml').allowed).toBe(true)
    expect(robotsVerdict(file, '/a').allowed).toBe(false)
    expect(robotsVerdict(file, '/ab').allowed).toBe(true)
    expect(robotsVerdict(file, '/b').allowed).toBe(true)
  })

  it('understands * in rules, and an empty Disallow', () => {
    expect(robotsVerdict('User-agent: *\nDisallow: /*.pdf$', '/x/report.pdf').allowed).toBe(false)
    expect(robotsVerdict('User-agent: *\nDisallow: /*.pdf$', '/x/report.pdf?v=1').allowed).toBe(true)
    expect(robotsVerdict('User-agent: *\nDisallow:', '/anything').allowed).toBe(true)
  })

  it('uses a group for TerraFend over the * group', () => {
    const file = 'User-agent: *\nDisallow: /\n\nUser-agent: TerraFend\nAllow: /rss'
    expect(robotsVerdict(file, '/rss').allowed).toBe(true)
    expect(robotsVerdict('User-agent: *\nAllow: /\n\nUser-agent: terrafend\nDisallow: /', '/rss').allowed).toBe(false)
  })

  it('reads Crawl-delay, including one written after the Sitemap line (Daily Mirror)', () => {
    const dm = 'User-agent: *\nAllow: /\nUser-agent: Googlebot\nAllow: /\nUser-Agent: msnbot\nAllow: /\n\nSitemap: https://x/sitemaps\nCrawl-delay: 3600'
    expect(robotsVerdict(dm, '/rss/breaking_news/108')).toEqual({ allowed: true, crawlDelaySec: 3600 })
    expect(robotsVerdict('User-agent: *\nCrawl-delay: 20\nDisallow: /search', '/rss').crawlDelaySec).toBe(20)
  })

  it('ignores comments and content-signal lines', () => {
    const file = '# As a condition of access...\nUser-agent: *\nContent-Signal: search=yes,ai-train=no\nAllow: /'
    expect(robotsVerdict(file, '/rss/news/175').allowed).toBe(true)
  })
})

describe('when a source is due', () => {
  it('is due the first time', () => {
    expect(isDue(ADA, state(ADA.id), NOW)).toBe(true)
  })

  it('allows a minute of slack on its own interval, so a 15-minute source is read every run', () => {
    expect(isDue(ADA, state(ADA.id, { last_fetch_at: ago(14) }), NOW)).toBe(true)
    expect(isDue(ADA, state(ADA.id, { last_fetch_at: ago(13) }), NOW)).toBe(false)
  })

  it('never takes the slack off a robots.txt Crawl-delay', () => {
    expect(DM.crawlDelayMin).toBe(60)
    expect(isDue(DM, state(DM.id, { last_fetch_at: ago(59) }), NOW)).toBe(false)
    expect(isDue(DM, state(DM.id, { last_fetch_at: ago(60) }), NOW)).toBe(true)
  })

  it('goes by a longer Crawl-delay read from robots.txt since', () => {
    const s = state(ADA.id, { last_fetch_at: ago(30), memo: { robotsDelaySec: 3600 } })
    expect(isDue(ADA, s, NOW)).toBe(false)
  })

  it(`backs off to ${BACKOFF_MIN} minutes after three failures, and to a day after a 403`, () => {
    expect(isDue(ADA, state(ADA.id, { last_fetch_at: ago(30), failures: 3 }), NOW)).toBe(false)
    expect(isDue(ADA, state(ADA.id, { last_fetch_at: ago(60), failures: 3 }), NOW)).toBe(true)
    expect(isDue(ADA, state(ADA.id, { last_fetch_at: ago(120), failures: 1, last_status: 403 }), NOW)).toBe(false)
    expect(isDue(ADA, state(ADA.id, { last_fetch_at: ago(BLOCKED_MIN), failures: 1, last_status: 403 }), NOW)).toBe(true)
  })
})

describe('one run', () => {
  it('stores the disaster headlines with their source, language and hazard, and drops the rest', async () => {
    const { deps, stored, calls } = setup({ [ADA.url]: ok(ADA_FEED) }, [ADA])
    const out = await refresh(deps)
    expect(out.result).toBe('ok')
    expect(stored().map((r) => r.title)).toEqual(['Heavy rain lashes Galle district overnight', 'Landslide blocks a road near Kegalle'])
    expect(stored()[0]).toMatchObject({
      item_key: 'https://adaderana.lk/news/1001',
      url: 'https://adaderana.lk/news/1001',
      source: 'adaderana_en',
      kind: 'media',
      channel: null,
      language: 'en',
      hazard: 'rain',
      published_at: '2026-11-15T08:30:00.000Z',
      fetched_at: new Date(NOW).toISOString(),
    })
    expect(JSON.stringify(stored())).not.toContain('FULL ARTICLE TEXT')
    expect(out.sources).toEqual([{ id: 'adaderana_en', status: 'ok', found: 3, kept: 2 }])
    // Every request says who is asking
    for (const call of calls) expect(call.headers['User-Agent']).toBe(USER_AGENT)
  })

  it('identifies itself with the agreed User-Agent', () => {
    expect(USER_AGENT).toBe(
      'TerraFend/1.0 (+https://terrafend.vercel.app; free Sri Lanka hazard map; contact: https://github.com/wishwadahanayaka/terrafend)',
    )
  })

  it('keeps going when one source fails, and notes the failure on that source', async () => {
    const { deps, stored, savedState } = setup({ [ADA.url]: ok(ADA_FEED), [TAMIL.url]: new Error('timed out') }, [ADA, TAMIL])
    const out = await refresh(deps)
    expect(out.result).toBe('ok')
    expect(stored()).toHaveLength(2)
    expect(out.sources.find((s) => s.id === 'tamilmirror')).toMatchObject({ status: 'failed', error: 'timed out' })
    expect(savedState('tamilmirror')).toMatchObject({ failures: 1, last_error: 'timed out', last_fetch_at: new Date(NOW).toISOString() })
    expect(savedState('adaderana_en')).toMatchObject({ failures: 0, last_error: null })
  })

  it('says failed when every source failed', async () => {
    const { deps } = setup({ [ADA.url]: code(500), [TAMIL.url]: code(503) }, [ADA, TAMIL])
    expect((await refresh(deps)).result).toBe('failed')
  })

  it('sends the caching headers it was given last time, and a 304 changes nothing', async () => {
    const before = state(ADA.id, { etag: '"abc"', last_modified: 'Sun, 15 Nov 2026 08:00:00 GMT', failures: 2 })
    const { deps, calls, writeItems, savedState } = setup({ [ADA.url]: code(304) }, [ADA], [before])
    const out = await refresh(deps)
    const feedCall = calls.find((c) => c.url === ADA.url)!
    expect(feedCall.headers['If-None-Match']).toBe('"abc"')
    expect(feedCall.headers['If-Modified-Since']).toBe('Sun, 15 Nov 2026 08:00:00 GMT')
    expect(out.sources[0].status).toBe('not_modified')
    expect(writeItems).not.toHaveBeenCalled()
    expect(savedState(ADA.id)).toMatchObject({ etag: '"abc"', failures: 0, last_status: 304 })
  })

  it('remembers the new caching headers after a 200', async () => {
    const { deps, savedState } = setup({ [ADA.url]: ok(ADA_FEED, { etag: '"v2"', lastModified: 'Sun, 15 Nov 2026 09:00:00 GMT' }) }, [ADA])
    await refresh(deps)
    expect(savedState(ADA.id)).toMatchObject({ etag: '"v2"', last_modified: 'Sun, 15 Nov 2026 09:00:00 GMT', last_status: 200 })
  })

  describe('a dry run', () => {
    it('stores nothing at all, lists what it would keep and what it dropped, and sends no caching headers', async () => {
      const before = state(ADA.id, { etag: '"abc"' })
      const { deps, calls, writeItems, writeStates, markEnded } = setup({ [ADA.url]: ok(ADA_FEED) }, [ADA], [before])
      const out = await refresh(deps, { dryRun: true, force: true })
      expect(out.result).toBe('dry_run')
      expect(writeItems).not.toHaveBeenCalled()
      expect(writeStates).not.toHaveBeenCalled()
      expect(markEnded).not.toHaveBeenCalled()
      expect(calls.find((c) => c.url === ADA.url)!.headers['If-None-Match']).toBeUndefined()
      expect(out.items?.map((i) => i.title)).toHaveLength(2)
      expect(out.dropped).toEqual([{ source: 'adaderana_en', title: 'Minister opens a new library', score: 0, matched: [] }])
    })
  })

  describe('which sources run', () => {
    it('skips a source that is not due, and force runs it anyway', async () => {
      const recent = state(ADA.id, { last_fetch_at: ago(5) })
      const first = setup({ [ADA.url]: ok(ADA_FEED) }, [ADA], [recent])
      const out = await refresh(first.deps)
      expect(out.skipped).toEqual([{ id: 'adaderana_en', reason: 'not_due' }])
      expect(first.fetch).not.toHaveBeenCalled()

      const forced = setup({ [ADA.url]: ok(ADA_FEED) }, [ADA], [recent])
      expect((await refresh(forced.deps, { force: true })).sources).toHaveLength(1)
    })

    it('runs only the one asked for', async () => {
      const { deps, fetch } = setup({ [TAMIL.url]: ok(rss([])) }, [ADA, TAMIL])
      const out = await refresh(deps, { only: 'tamilmirror' })
      expect(out.sources.map((s) => s.id)).toEqual(['tamilmirror'])
      expect(fetch.mock.calls.some(([url]) => url === ADA.url)).toBe(false)
    })

    it('refuses an unknown source name', async () => {
      const { deps, fetch } = setup({}, [ADA])
      const out = await refresh(deps, { only: 'nosuchsite' })
      expect(out.result).toBe('failed')
      expect(fetch).not.toHaveBeenCalled()
    })

    it('never asks a disabled source, even when named', async () => {
      const off = { ...ADA, enabled: false }
      const { deps, fetch } = setup({ [ADA.url]: ok(ADA_FEED) }, [off])
      const out = await refresh(deps, { only: 'adaderana_en', force: true })
      expect(out.skipped).toEqual([{ id: 'adaderana_en', reason: 'disabled' }])
      expect(fetch).not.toHaveBeenCalled()
    })

    it('asks nothing when the state table cannot be read', async () => {
      const { deps, fetch } = setup({ [ADA.url]: ok(ADA_FEED) }, [ADA], [], {
        readStates: async () => {
          throw new Error('db down')
        },
      })
      expect((await refresh(deps)).result).toBe('failed')
      expect(fetch).not.toHaveBeenCalled()
    })

    it(`leaves sources it has no time for after ${RUN_BUDGET_MS / 1000} s to the next run`, async () => {
      let t = NOW
      const { deps } = setup({ [ADA.url]: ok(ADA_FEED), [TAMIL.url]: ok(rss([])) }, [ADA, TAMIL], [], {
        now: () => {
          const current = t
          t += RUN_BUDGET_MS
          return current
        },
      })
      const out = await refresh(deps)
      expect(out.skipped.some((s) => s.reason === 'out_of_time')).toBe(true)
    })
  })

  describe('robots.txt', () => {
    it('does not read a source its robots.txt disallows, and remembers that', async () => {
      const { deps, fetch, savedState } = setup(
        { 'https://adaderana.lk/robots.txt': ok('User-agent: *\nDisallow: /rss'), [ADA.url]: ok(ADA_FEED) },
        [ADA],
      )
      const out = await refresh(deps)
      expect(out.sources[0].status).toBe('robots_disallow')
      expect(fetch.mock.calls.some(([url]) => url === ADA.url)).toBe(false)
      expect(savedState(ADA.id)).toMatchObject({ robots_ok: false, robots_at: new Date(NOW).toISOString() })
    })

    it('reads robots.txt once per site in a run, and not again within a day', async () => {
      const routes = {
        [DMC_LAND.url]: ok(dmcPage([{ title: 'Landslide Warning', date: '2026-11-15', time: '10:00', href: '/images/a.pdf' }])),
        [DMC_SIT.url]: ok(dmcPage([{ title: 'Situation Report', date: '2026-11-15', time: '10:00', href: '/images/b.pdf' }])),
      }
      const first = setup(routes, [DMC_LAND, DMC_SIT])
      await refresh(first.deps)
      expect(first.calls.filter((c) => c.url.endsWith('/robots.txt'))).toHaveLength(1)

      const fresh = state(DMC_LAND.id, { robots_ok: true, robots_at: ago(60) })
      const later = setup(routes, [DMC_LAND], [fresh])
      await refresh(later.deps)
      expect(later.calls.filter((c) => c.url.endsWith('/robots.txt'))).toHaveLength(0)
    })

    it('skips a source for this run when robots.txt cannot be read and was never read before', async () => {
      const { deps, fetch } = setup({ 'https://adaderana.lk/robots.txt': code(503), [ADA.url]: ok(ADA_FEED) }, [ADA])
      const out = await refresh(deps)
      expect(out.sources[0].status).toBe('robots_unknown')
      expect(fetch.mock.calls.some(([url]) => url === ADA.url)).toBe(false)
    })

    // This used to leave the source's row untouched (last_fetch_at and last_status empty, no error), so
    // a source stuck here looked as if it had never been tried, with nothing to say why.
    describe('when robots.txt cannot be read, the reason is kept', () => {
      const timeout = Object.assign(new Error('The operation timed out.'), { name: 'TimeoutError' })

      it.each([
        ['an HTTP 503', code(503), 'robots.txt: HTTP 503', 503],
        ['an HTTP 429', code(429), 'robots.txt: HTTP 429', 429],
        ['a refused connection', new Error('connection refused'), 'robots.txt: connection refused', null],
        ['a timeout', timeout, 'robots.txt: TimeoutError: The operation timed out.', null],
      ] as const)('%s', async (_name, reply, message, status) => {
        const { deps, savedState } = setup({ 'https://adaderana.lk/robots.txt': reply }, [ADA])
        const out = await refresh(deps)
        expect(out.sources[0]).toEqual({ id: 'adaderana_en', status: 'robots_unknown', found: 0, kept: 0, error: message })
        expect(savedState(ADA.id)).toMatchObject({
          last_error: message,
          last_status: status,
          last_fetch_at: new Date(NOW).toISOString(),
          failures: 1,
          robots_ok: null,
        })
      })

      it('shows it in a dry run too, which is where it was first noticed', async () => {
        const { deps } = setup({ 'https://adaderana.lk/robots.txt': new Error('connection reset') }, [ADA])
        const out = await refresh(deps, { dryRun: true, force: true })
        expect(out.sources[0]).toMatchObject({ status: 'robots_unknown', error: 'robots.txt: connection reset' })
      })

      it('counts as a failure, so a source that stays unreachable is asked hourly after three', async () => {
        const stuck = state(ADA.id, { failures: 2, last_fetch_at: ago(15) })
        const { deps, savedState } = setup({ 'https://adaderana.lk/robots.txt': code(503) }, [ADA], [stuck])
        await refresh(deps)
        const saved = savedState(ADA.id)!
        expect(saved.failures).toBe(3)
        expect(isDue(ADA, { ...saved, last_fetch_at: ago(30) }, NOW)).toBe(false)
        expect(isDue(ADA, { ...saved, last_fetch_at: ago(BACKOFF_MIN) }, NOW)).toBe(true)
      })

      it('clears the note once the source works again', async () => {
        const stuck = state(ADA.id, { failures: 4, last_error: 'robots.txt: HTTP 503', last_fetch_at: ago(120) })
        const { deps, savedState } = setup({ [ADA.url]: ok(ADA_FEED) }, [ADA], [stuck])
        await refresh(deps)
        expect(savedState(ADA.id)).toMatchObject({ last_error: null, failures: 0, last_status: 200 })
      })

      it('puts a timeout and a network error into words', () => {
        expect(describeError(timeout)).toBe('TimeoutError: The operation timed out.')
        expect(describeError(new Error('boom'))).toBe('boom')
        expect(describeError('plain text')).toBe('plain text')
        expect(describeError(new Error('a\n   b'))).toBe('a b')
        expect(describeError(new Error('x'.repeat(500)))).toHaveLength(160)
      })
    })

    it('keeps the last answer when robots.txt cannot be read now', async () => {
      const known = state(ADA.id, { robots_ok: true, robots_at: ago(2 * 24 * 60) })
      const { deps, stored } = setup({ 'https://adaderana.lk/robots.txt': new Error('offline'), [ADA.url]: ok(ADA_FEED) }, [ADA], [known])
      await refresh(deps)
      expect(stored()).toHaveLength(2)
    })
  })

  describe('answers it refuses', () => {
    it('follows a redirect on the same site, but not to another site or more than three times', async () => {
      const moved = setup(
        { [ADA.url]: code(301, { location: '/rss2.xml' }), 'https://adaderana.lk/rss2.xml': ok(ADA_FEED) },
        [ADA],
      )
      expect((await refresh(moved.deps)).sources[0].status).toBe('ok')

      const away = setup({ [ADA.url]: code(302, { location: 'https://evil.example/rss' }) }, [ADA])
      expect((await refresh(away.deps)).sources[0]).toMatchObject({ status: 'failed', error: 'redirected to another site' })

      const loop = setup({ [ADA.url]: code(302, { location: ADA.url }) }, [ADA])
      expect((await refresh(loop.deps)).sources[0]).toMatchObject({ status: 'failed', error: 'too many redirects' })
    })

    it('refuses an answer over the size cap', async () => {
      const big: FetchResult = { status: 200, headers: headers(), body: null, tooBig: true }
      const { deps } = setup({ [ADA.url]: big }, [ADA])
      expect((await refresh(deps)).sources[0].error).toBe(`answer over ${MAX_BYTES} bytes`)
    })

    it('refuses a web page where a feed should be, and keeps the old caching headers', async () => {
      const before = state(ADA.id, { etag: '"old"' })
      const { deps, savedState } = setup({ [ADA.url]: ok('<html><body>Maintenance</body></html>', { etag: '"new"' }) }, [ADA], [before])
      const out = await refresh(deps)
      expect(out.sources[0]).toMatchObject({ status: 'failed', error: 'not an RSS or Atom feed' })
      expect(savedState(ADA.id)?.etag).toBe('"old"')
    })

    it('records a 403, so the source is then asked once a day', async () => {
      const { deps, savedState } = setup({ [ADA.url]: code(403) }, [ADA])
      await refresh(deps)
      const saved = savedState(ADA.id)!
      expect(saved).toMatchObject({ last_status: 403, failures: 1, last_error: 'HTTP 403' })
      expect(isDue(ADA, saved, NOW + 60 * MIN)).toBe(false)
    })
  })

  describe('items it leaves out or merges', () => {
    it('skips links to other sites, items over 7 days old and items with no headline', async () => {
      const feed = rss([
        { title: 'Flooding reported in Galle', link: 'https://elsewhere.example/flood', date: 'Sun, 15 Nov 2026 08:00:00 GMT' },
        { title: 'Flooding reported in Matara', link: 'https://adaderana.lk/news/2', date: 'Sun, 01 Nov 2026 08:00:00 GMT' },
        { title: '   ', link: 'https://adaderana.lk/news/3' },
        { title: 'Flooding reported in Kalutara', link: 'https://adaderana.lk/news/4', date: 'Mon, 16 Nov 2026 08:00:00 GMT' },
      ])
      const { deps, stored } = setup({ [ADA.url]: ok(feed) }, [ADA])
      await refresh(deps)
      expect(stored().map((r) => r.title)).toEqual(['Flooding reported in Kalutara'])
      // A time in the future becomes the run's time
      expect(stored()[0].published_at).toBe(new Date(NOW).toISOString())
    })

    it('stores an item that appears twice in one feed once (Tamil Mirror does this)', async () => {
      const item = { title: 'மண்சரிவு அபாய எச்சரிக்கை', link: 'https://www.tamilmirror.lk/செய்திகள்/மண்சரிவு', date: '2026-11-15T12:18:00+05:30' }
      const { deps, stored } = setup({ [TAMIL.url]: ok(rss([item, item])) }, [TAMIL])
      await refresh(deps)
      expect(stored()).toHaveLength(1)
      expect(stored()[0]).toMatchObject({ language: 'ta', hazard: 'landslide' })
    })

    it(`reads at most ${MAX_ITEMS_PER_SOURCE} items from one feed`, async () => {
      const many = Array.from({ length: 70 }, (_, i) => ({ title: `Flood update number ${i}`, link: `https://adaderana.lk/news/${i}` }))
      const { deps, stored } = setup({ [ADA.url]: ok(rss(many)) }, [ADA])
      const out = await refresh(deps)
      expect(out.sources[0].found).toBe(MAX_ITEMS_PER_SOURCE)
      expect(stored()).toHaveLength(MAX_ITEMS_PER_SOURCE)
    })

    it('keeps every item of an official warning channel, and works out each item’s language', async () => {
      const feed = rss([
        { title: 'Public notice about the Kelani river', link: 'https://www.dmc.gov.lk/index.php?id=1' },
        { title: 'කැලණි ගඟ පිළිබඳ නිවේදනයක්', link: 'https://www.dmc.gov.lk/index.php?id=2' },
      ])
      const { deps, stored } = setup({ [DMC_WARN.url]: ok(feed) }, [DMC_WARN])
      await refresh(deps)
      expect(stored().map((r) => [r.kind, r.language])).toEqual([
        ['official', 'en'],
        ['official', 'si'],
      ])
    })

    it('still filters DMC News, which carries workshops as well as warnings', async () => {
      const feed = rss([
        { title: 'Workshop on recovery policy held in Colombo', link: 'https://www.dmc.gov.lk/index.php?id=3' },
        { title: 'Heavy rain expected in several provinces', link: 'https://www.dmc.gov.lk/index.php?id=4' },
      ])
      const { deps, stored } = setup({ [DMC_NEWS.url]: ok(feed) }, [DMC_NEWS])
      await refresh(deps)
      expect(stored().map((r) => r.title)).toEqual(['Heavy rain expected in several provinces'])
    })

    it('lets the first source win when two have the same link', async () => {
      const shared = rss([{ title: 'Flood warning for the Kelani river', link: 'https://adaderana.lk/news/77' }])
      const copy = { ...ADA, id: 'adaderana_copy' }
      const { deps, writeItems } = setup({ [ADA.url]: ok(shared) }, [ADA, copy])
      await refresh(deps)
      const rows = writeItems.mock.calls[0][0]
      expect(rows).toHaveLength(1)
      expect(rows[0].source).toBe('adaderana_en')
    })
  })

  describe("DMC's report tables", () => {
    it('stores only the newest report, as an official channel item with its PDF link', async () => {
      const page = dmcPage([
        { title: 'Landslide Warning', date: '2026-11-14', time: '16:00', href: '/images/dmcreports/LEWM_14.pdf' },
        { title: 'Landslide Warning', date: '2026-11-15', time: '10:00', href: '/images/dmcreports/LEWM_15.pdf' },
      ])
      const { deps, stored } = setup({ [DMC_LAND.url]: ok(page) }, [DMC_LAND])
      await refresh(deps)
      expect(stored()).toEqual([
        expect.objectContaining({
          url: 'https://www.dmc.gov.lk/images/dmcreports/LEWM_15.pdf',
          title: 'Landslide Warning',
          kind: 'official',
          channel: 'dmc_landslide',
          hazard: 'landslide',
          published_at: '2026-11-15T04:30:00.000Z',
        }),
      ])
    })

    it('says the layout may have changed when it finds no rows', async () => {
      const { deps } = setup({ [DMC_LAND.url]: ok('<html><body>New design</body></html>') }, [DMC_LAND])
      expect((await refresh(deps)).sources[0]).toMatchObject({ status: 'failed', error: 'no rows found: the page layout may have changed' })
    })
  })

  describe("the Met Department's advisories", () => {
    const SEA = 'https://meteo.gov.lk/pdfs/sea_pdf.pdf'
    const pdf = (etag: string): FetchResult => code(200, { etag, lastModified: 'Sun, 15 Nov 2026 08:35:11 GMT' })

    it('stores an advisory that is out, keyed by the PDF’s version', async () => {
      const { deps, stored, calls, savedState } = setup({ [METEO.url]: ok(meteo({ sea_pdf: 'pdfs/sea_pdf.pdf' })), [SEA]: pdf('"6af96ebf-25e09d"') }, [METEO])
      await refresh(deps)
      expect(calls.find((c) => c.url === SEA)?.method).toBe('HEAD')
      expect(stored()).toEqual([
        expect.objectContaining({
          item_key: 'meteo:sea:6af96ebf-25e09d',
          url: SEA,
          kind: 'official',
          channel: 'meteo_sea',
          hazard: 'wind_sea',
          published_at: '2026-11-15T08:35:11.000Z',
        }),
      ])
      expect(savedState(METEO.id)?.memo.meteoActive).toEqual({ sea_pdf: 'meteo:sea:6af96ebf-25e09d' })
    })

    it('ends the advisory once its field is empty again', async () => {
      const before = state(METEO.id, { memo: { meteoActive: { sea_pdf: 'meteo:sea:v1' } } })
      const { deps, markEnded, stored } = setup({ [METEO.url]: ok(meteo({})) }, [METEO], [before])
      const out = await refresh(deps)
      expect(markEnded).toHaveBeenCalledWith(['meteo:sea:v1'], new Date(NOW).toISOString())
      expect(out.ended).toBe(1)
      expect(stored()).toEqual([])
    })

    it('treats a new issue under the same file name as a new notice, and ends the old one', async () => {
      const before = state(METEO.id, { memo: { meteoActive: { sea_pdf: 'meteo:sea:v1' } } })
      const { deps, markEnded, stored } = setup({ [METEO.url]: ok(meteo({ sea_pdf: 'pdfs/sea_pdf.pdf' })), [SEA]: pdf('"v2"') }, [METEO], [before])
      await refresh(deps)
      expect(stored()[0].item_key).toBe('meteo:sea:v2')
      expect(markEnded).toHaveBeenCalledWith(['meteo:sea:v1'], expect.any(String))
    })

    it('falls back to the version of content.json when the PDF cannot be checked', async () => {
      const { deps, stored } = setup(
        { [METEO.url]: ok(meteo({ land_pdf: 'pdfs/land_pdf.pdf' }), { etag: '"json-7"' }), 'https://meteo.gov.lk/pdfs/land_pdf.pdf': new Error('timed out') },
        [METEO],
      )
      await refresh(deps)
      expect(stored()[0]).toMatchObject({ item_key: 'meteo:land:json-7', channel: 'meteo_land' })
    })

    it('ends nothing when content.json has not changed (304)', async () => {
      const before = state(METEO.id, { etag: '"x"', memo: { meteoActive: { sea_pdf: 'meteo:sea:v1' } } })
      const { deps, markEnded, savedState } = setup({ [METEO.url]: code(304) }, [METEO], [before])
      await refresh(deps)
      expect(markEnded).not.toHaveBeenCalled()
      expect(savedState(METEO.id)?.memo.meteoActive).toEqual({ sea_pdf: 'meteo:sea:v1' })
    })
  })

  describe('a site whose robots.txt is its home page (the Met Department)', () => {
    // meteo.gov.lk answers /robots.txt with its whole home page. Made-up page, same shape: HTML, CSS
    // and script lines with colons in them, none of them robots rules.
    const homePage =
      '<!DOCTYPE html><html><head><title>A department</title><style>\nbody {\n  font-family: Arial;\n  display: flex;\n}\n' +
      '.allow: x\n</style></head><body>\n<h1>Welcome</h1>\n<script>\nconst sitemap = "x";\nlet user = 1;\n</script>\n' +
      '<p>' + 'text '.repeat(4000) + '</p></body></html>'
    const SEA = 'https://meteo.gov.lk/pdfs/sea_pdf.pdf'

    it('reads it as "no rules", fetches content.json and stores the advisory', async () => {
      const { deps, stored, savedState, calls } = setup(
        {
          'https://meteo.gov.lk/robots.txt': ok(homePage),
          [METEO.url]: ok(meteo({ sea_pdf: 'pdfs/sea_pdf.pdf' }), { etag: 'W/"6af98216-9511"' }),
          [SEA]: code(200, { etag: '"6af96ebf-25e09d"', lastModified: 'Sun, 15 Nov 2026 08:35:11 GMT' }),
        },
        [METEO],
      )
      const out = await refresh(deps, { only: 'meteo_advisory', force: true })
      expect(out.sources).toEqual([{ id: 'meteo_advisory', status: 'ok', found: 1, kept: 1 }])
      expect(stored()).toHaveLength(1)
      expect(calls.map((c) => c.url)).toEqual(['https://meteo.gov.lk/robots.txt', METEO.url, SEA])
      expect(savedState(METEO.id)).toMatchObject({ last_status: 200, last_error: null, robots_ok: true, failures: 0 })
      expect(savedState(METEO.id)?.last_fetch_at).toBe(new Date(NOW).toISOString())
    })

    it('asks only for www-less meteo.gov.lk, as the site redirects www there', () => {
      expect(new URL(METEO.url).host).toBe('meteo.gov.lk')
      expect(METEO.ownDomains).toEqual(['meteo.gov.lk'])
    })
  })

  describe('a source that answers 403 (thinakaran)', () => {
    // Switched on here only: in the real list it is off (403 from Supabase), but its code and tests stay
    const THINA: Source = { ...source('thinakaran'), enabled: true }
    const HOUR = 60 * MIN

    // Runs at a different time and keeps the stored state between runs, like the real cron job does
    async function runAt(minutesFromNow: number, replies: Record<string, Reply>, states: SourceState[]) {
      const t = NOW + minutesFromNow * MIN
      const s = setup(replies, [THINA], states, { now: () => t })
      const out = await refresh(s.deps)
      return { ...s, out, next: s.writeStates.mock.calls.at(-1)?.[0] ?? states }
    }

    it('is asked once a day after that, and never with different headers', async () => {
      const replies = { [THINA.url]: code(403) }
      const first = await runAt(0, replies, [])
      expect(first.out.sources[0]).toMatchObject({ status: 'failed', error: 'HTTP 403' })
      expect(first.next[0]).toMatchObject({ last_status: 403, failures: 1 })

      // every 15 minutes for the next 23 hours: nothing is sent at all
      let states = first.next
      for (let minutes = 15; minutes < 24 * 60; minutes += 15) {
        const run = await runAt(minutes, replies, states)
        expect(run.fetch, `at +${minutes} min`).not.toHaveBeenCalled()
        expect(run.out.skipped).toEqual([{ id: 'thinakaran', reason: 'not_due' }])
      }

      // after a day it asks once more, with the same User-Agent and nothing added
      const again = await runAt(24 * 60, replies, states)
      const feedCall = again.calls.find((c) => c.url === THINA.url)!
      expect(feedCall.headers['User-Agent']).toBe(USER_AGENT)
      expect(Object.keys(feedCall.headers).sort()).toEqual(['Accept', 'User-Agent'])
      expect(again.next[0]).toMatchObject({ last_status: 403, failures: 2 })

      // and then not again for another day
      states = again.next
      const soon = await runAt(24 * 60 + HOUR / MIN, replies, states)
      expect(soon.fetch).not.toHaveBeenCalled()
    })

    it('goes back to the normal interval once it answers again', async () => {
      const blocked = await runAt(0, { [THINA.url]: code(403) }, [])
      const open = await runAt(24 * 60, { [THINA.url]: ok(rss([])) }, blocked.next)
      expect(open.next[0]).toMatchObject({ last_status: 200, failures: 0, last_error: null })
      const later = await runAt(24 * 60 + THINA.everyMin, { [THINA.url]: ok(rss([])) }, open.next)
      expect(later.fetch).toHaveBeenCalled()
    })
  })

  describe('how long each request may take', () => {
    const MET_ROBOTS = 'https://meteo.gov.lk/robots.txt'
    const SEA = 'https://meteo.gov.lk/pdfs/sea_pdf.pdf'
    const metReplies = {
      [MET_ROBOTS]: code(404),
      [METEO.url]: ok(meteo({ sea_pdf: 'pdfs/sea_pdf.pdf' })),
      [SEA]: code(200, { etag: '"v1"' }),
    }

    it('gives only the Met Department source a longer wait, 25 s, and every other source the normal 10 s', () => {
      expect(FETCH_TIMEOUT_MS).toBe(10_000)
      expect(METEO.timeoutMs).toBe(25_000)
      expect(timeoutFor(METEO)).toBe(25_000)
      expect(SOURCES.filter((s) => s.timeoutMs !== undefined).map((s) => s.id)).toEqual(['meteo_advisory'])
      for (const s of SOURCES.filter((s) => s.id !== 'meteo_advisory')) expect(timeoutFor(s), s.id).toBe(10_000)
    })

    it('waits 25 s for the Met source’s robots.txt and content.json, and 10 s for the side check on the PDF', async () => {
      const { deps, calls } = setup(metReplies, [METEO])
      await refresh(deps, { force: true })
      expect(calls.map((c) => [c.url, c.method, c.timeoutMs])).toEqual([
        [MET_ROBOTS, 'GET', 25_000],
        [METEO.url, 'GET', 25_000],
        [SEA, 'HEAD', 10_000],
      ])
    })

    it('waits 10 s for everything else, robots.txt included', async () => {
      const { deps, calls } = setup({ [ADA.url]: ok(ADA_FEED) }, [ADA])
      await refresh(deps, { force: true })
      expect(calls.map((c) => [c.url, c.timeoutMs])).toEqual([
        ['https://adaderana.lk/robots.txt', 10_000],
        [ADA.url, 10_000],
      ])
    })

    it('keeps the longer wait through a redirect', async () => {
      const { deps, calls } = setup({ ...metReplies, [METEO.url]: code(301, { location: '/content2.json' }), 'https://meteo.gov.lk/content2.json': ok(meteo({})) }, [METEO])
      await refresh(deps, { force: true })
      expect(calls.filter((c) => c.url.includes('content')).map((c) => c.timeoutMs)).toEqual([25_000, 25_000])
    })

    describe('the whole run has a deadline', () => {
      // The cron job gives the call 60 s, and a run that is cut off saves nothing for any source
      it(`never goes past ${RUN_DEADLINE_MS / 1000} s: a long wait is cut to what is left`, async () => {
        let calls = 0
        const { deps, calls: sent } = setup(metReplies, [METEO], [], { now: () => (calls++ === 0 ? NOW : NOW + 40_000) })
        await refresh(deps, { force: true })
        // 52 s minus the 40 s already gone leaves 12 s, less than the 25 s asked for
        expect(sent[0]).toMatchObject({ url: MET_ROBOTS, timeoutMs: 12_000 })
        expect(sent.every((c) => c.timeoutMs <= 12_000)).toBe(true)
      })

      it(`starts no request with under ${MIN_REQUEST_MS / 1000} s left, and says why`, async () => {
        // The robots.txt answer takes 51 s, so 1 s of the run is left for content.json
        let elapsed = 0
        const { deps, calls } = setup({ ...metReplies, [MET_ROBOTS]: () => ((elapsed = 51_000), code(404)) }, [METEO], [], {
          now: () => NOW + elapsed,
        })
        const out = await refresh(deps, { force: true })
        expect(calls.map((c) => c.url)).toEqual([MET_ROBOTS])
        expect(out.sources[0]).toMatchObject({ status: 'failed', error: 'out of time for this run' })
      })

      it('says so too when robots.txt itself gets no time', async () => {
        // Only reachable when another source used the time first: the clock is past the deadline at the first request
        let calls = 0
        const { deps, fetch } = setup(metReplies, [METEO], [], { now: () => (calls++ < 2 ? NOW : NOW + 51_000) })
        const out = await refresh(deps, { force: true })
        expect(fetch).not.toHaveBeenCalled()
        expect(out.sources[0]).toMatchObject({ status: 'robots_unknown', error: 'robots.txt: out of time for this run' })
      })

      it('leaves room for the writes inside the 60 s the cron job allows', () => {
        expect(RUN_DEADLINE_MS).toBeLessThan(60_000)
        expect(60_000 - RUN_DEADLINE_MS).toBeGreaterThanOrEqual(5_000)
        const sql = readFileSync(join(__dirname, '..', '..', 'supabase', 'migrations', '0010_news_feed.sql'), 'utf8')
        expect(sql).toContain('timeout_milliseconds := 60000')
      })
    })
  })

  describe('the Met source keeps timing out', () => {
    const timeout = Object.assign(new Error('Signal timed out.'), { name: 'TimeoutError' })
    const hosts = new Set<string>()
    const replies = { 'https://meteo.gov.lk/robots.txt': timeout }

    async function runAt(minutes: number, states: SourceState[]) {
      const t = NOW + minutes * MIN
      const s = setup(replies, [METEO], states, { now: () => t })
      await refresh(s.deps)
      for (const c of s.calls) hosts.add(new URL(c.url).host)
      return { ...s, next: s.writeStates.mock.calls.at(-1)?.[0] ?? states }
    }

    it('records the timeout, then stays in the normal backoff: every 15 min for three tries, then hourly', async () => {
      let states: SourceState[] = []
      const tried: number[] = []
      for (let minutes = 0; minutes <= 180; minutes += 15) {
        const run = await runAt(minutes, states)
        if (run.fetch.mock.calls.length > 0) tried.push(minutes)
        states = run.next
      }
      // 0, 15 and 30 fail (three in a row), then one try an hour after the last
      expect(tried.slice(0, 3)).toEqual([0, 15, 30])
      expect(tried.slice(3)).toEqual([90, 150])
      expect(states[0]).toMatchObject({
        last_error: 'robots.txt: TimeoutError: Signal timed out.',
        last_fetch_at: new Date(NOW + 150 * MIN).toISOString(),
        last_status: null,
      })
      expect(states[0].failures).toBe(5)
    })

    it('never changes who it asks or how: same site, same User-Agent, same headers, every time', async () => {
      const calls: { url: string; headers: Record<string, string> }[] = []
      let states: SourceState[] = []
      for (const minutes of [0, 15, 30, 90]) {
        const s = setup(replies, [METEO], states, { now: () => NOW + minutes * MIN })
        await refresh(s.deps)
        calls.push(...s.calls)
        states = s.writeStates.mock.calls.at(-1)?.[0] ?? states
      }
      expect(calls.length).toBeGreaterThan(0)
      expect(new Set(calls.map((c) => new URL(c.url).host))).toEqual(new Set(['meteo.gov.lk']))
      for (const c of calls) {
        expect(c.headers['User-Agent']).toBe(USER_AGENT)
        expect(Object.keys(c.headers).sort()).toEqual(['Accept', 'User-Agent'])
      }
      expect([...hosts].every((h) => h === 'meteo.gov.lk')).toBe(true)
    })

    it('goes back to every 15 minutes the first time it answers', async () => {
      const failing = state(METEO.id, { failures: 5, last_fetch_at: ago(60), last_error: 'robots.txt: TimeoutError: Signal timed out.' })
      const { deps, savedState } = setup(
        { 'https://meteo.gov.lk/robots.txt': code(404), [METEO.url]: ok(meteo({})) },
        [METEO],
        [failing],
      )
      await refresh(deps)
      expect(savedState(METEO.id)).toMatchObject({ failures: 0, last_error: null, last_status: 200 })
      expect(isDue(METEO, savedState(METEO.id)!, NOW + 15 * MIN)).toBe(true)
    })
  })

  describe('database trouble', () => {
    it('reports a failed write, but still saves the state of each source', async () => {
      const { deps, writeStates } = setup({ [ADA.url]: ok(ADA_FEED) }, [ADA], [], {
        writeItems: vi.fn(async () => {
          throw new Error('disk full')
        }),
      })
      const out = await refresh(deps)
      expect(out.result).toBe('failed')
      expect(out.errors).toEqual(['writing items failed: disk full'])
      expect(writeStates).toHaveBeenCalledOnce()
    })

    it('counts only the new rows as stored', async () => {
      const { deps } = setup({ [ADA.url]: ok(ADA_FEED) }, [ADA], [], { writeItems: vi.fn(async () => 1) })
      expect((await refresh(deps)).stored).toBe(1)
    })
  })
})

describe('reading a response body', () => {
  const stream = (...parts: string[]) =>
    new ReadableStream<Uint8Array>({
      start(controller) {
        for (const p of parts) controller.enqueue(new TextEncoder().encode(p))
        controller.close()
      },
    })

  it('reads UTF-8 text split across chunks', async () => {
    const bytes = new TextEncoder().encode('තද වැසි')
    const split = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(bytes.slice(0, 4))
        c.enqueue(bytes.slice(4))
        c.close()
      },
    })
    expect(await readCapped(split, 1000)).toEqual({ text: 'තද වැසි', tooBig: false })
  })

  it('stops once the cap is passed', async () => {
    expect(await readCapped(stream('a'.repeat(600), 'b'.repeat(600)), 1000)).toEqual({ text: '', tooBig: true })
  })

  it('gives empty text for no body', async () => {
    expect(await readCapped(null, 1000)).toEqual({ text: '', tooBig: false })
  })
})

describe('the source list', () => {
  it('has unique ids that fit the database check', () => {
    const ids = SOURCES.map((s) => s.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const id of ids) expect(id).toMatch(/^[a-z0-9_]{2,40}$/)
  })

  it('asks only over https, each on its own site', () => {
    for (const s of SOURCES) {
      const url = new URL(s.url)
      expect(url.protocol, s.id).toBe('https:')
      expect(s.ownDomains.some((d) => url.hostname === d || url.hostname === `www.${d}`), s.id).toBe(true)
    }
  })

  it('never asks more often than robots.txt allows, nor more than every 15 minutes', () => {
    for (const s of SOURCES) {
      expect(s.everyMin, s.id).toBeGreaterThanOrEqual(s.crawlDelayMin)
      expect(s.everyMin, s.id).toBeGreaterThanOrEqual(15)
    }
    // Both say Crawl-delay: 3600
    expect(source('dailymirror').everyMin).toBeGreaterThanOrEqual(60)
    expect(source('lankadeepa').everyMin).toBeGreaterThanOrEqual(60)
  })

  it('gives channels and unfiltered reading to official sources only', () => {
    for (const s of SOURCES) {
      if (s.channel) expect(s.kind, s.id).toBe('official')
      if (s.filter === 'none') expect(s.kind, s.id).toBe('official')
      if (s.channel) expect(s.channel).toMatch(/^[a-z0-9_]{2,40}$/)
    }
  })

  describe('the two sources that are switched off', () => {
    const OFF = ['meteo_advisory', 'thinakaran']

    it('are the only ones off, and are still in the list, ready to be switched back on', () => {
      expect(SOURCES.filter((s) => !s.enabled).map((s) => s.id)).toEqual(OFF)
      expect(source('meteo_advisory')).toMatchObject({ parser: 'meteoJson', timeoutMs: 25_000, enabled: false })
      expect(source('thinakaran')).toMatchObject({ parser: 'rss', enabled: false })
    })

    it('say why in a comment beside them', () => {
      const file = readFileSync(join(__dirname, '..', '..', 'supabase', 'functions', 'news-refresh', 'sources.ts'), 'utf8')
      expect(file).toMatch(/Off \(15 Nov 2026\): meteo\.gov\.lk times out from Supabase even at 25 s/)
      expect(file).toMatch(/Off \(15 Nov 2026\): thinakaran\.lk returns 403 to Supabase/)
    })

    it('are never asked by a whole run, which says they are disabled', async () => {
      const routes: Record<string, Reply> = {}
      for (const s of SOURCES) routes[s.url] = ok(s.parser === 'rss' ? rss([]) : '{}')
      const { deps, calls } = setup(routes, SOURCES)
      const out = await refresh(deps, { force: true })
      expect(out.skipped.filter((s) => s.reason === 'disabled').map((s) => s.id)).toEqual(OFF)
      const hosts = new Set(calls.map((c) => new URL(c.url).host))
      expect([...hosts].some((h) => h.includes('meteo.gov.lk') || h.includes('thinakaran.lk'))).toBe(false)
      expect(out.sources.map((s) => s.id)).not.toContain('meteo_advisory')
      expect(out.sources.map((s) => s.id)).not.toContain('thinakaran')
    })

    it('are skipped even when named, so a stray ?only= cannot wake them', async () => {
      const { deps, fetch } = setup({}, SOURCES)
      for (const id of OFF) {
        const out = await refresh(deps, { only: id, force: true })
        expect(out.skipped).toEqual([{ id, reason: 'disabled' }])
      }
      expect(fetch).not.toHaveBeenCalled()
    })
  })

  it('leaves out the sites that block us or are not usable', () => {
    for (const s of SOURCES) expect(s.url).not.toMatch(/lankapuvath|news\.lk|newsfirst|themorning|nbri\.gov|irrigation/)
  })

  it('has the official sources first, so they win a shared link', () => {
    const kinds = SOURCES.map((s) => s.kind)
    expect(kinds.lastIndexOf('official')).toBeLessThan(kinds.indexOf('media'))
  })
})

describe('what the function sends back', () => {
  it('says the body is UTF-8, so Windows PowerShell 5.1 does not scramble Sinhala and Tamil', async () => {
    const res = jsonResponse({ title: 'තද වැසි', note: 'கனமழை' })
    expect(res.headers.get('content-type')).toBe('application/json; charset=utf-8')
    expect(res.status).toBe(200)
  })

  it('sends the letters as UTF-8 bytes and they read back unchanged', async () => {
    const body = { title: 'තද වැසි', note: 'கனமழை', n: 3 }
    const res = jsonResponse(body, 502)
    expect(res.status).toBe(502)
    const bytes = new Uint8Array(await res.arrayBuffer())
    expect(JSON.parse(new TextDecoder('utf-8').decode(bytes))).toEqual(body)
    // the letters themselves are in the body, not \u escapes
    expect(new TextDecoder('utf-8').decode(bytes)).toContain('තද වැසි')
  })

  it('is what every answer in index.ts goes through', () => {
    const index = readFileSync(join(__dirname, '..', '..', 'supabase', 'functions', 'news-refresh', 'index.ts'), 'utf8')
    expect(index).toContain('jsonResponse')
    expect(index).not.toMatch(/new Response\(/)
    expect(index).not.toMatch(/'Content-Type': 'application\/json'(?!;)/)
    // 401, 405, 400 and the final answer
    expect(index.match(/return jsonResponse\(/g)).toHaveLength(4)
  })
})

describe('the function file (index.ts)', () => {
  const index = readFileSync(join(__dirname, '..', '..', 'supabase', 'functions', 'news-refresh', 'index.ts'), 'utf8')

  it('checks its own secret header and only accepts POST', () => {
    expect(index).toContain("req.headers.get('x-news-secret')")
    expect(index).toContain("Deno.env.get('NEWS_SECRET')")
    expect(index).toContain("req.method !== 'POST'")
  })

  it('does not follow redirects itself, times out, and caps the body', () => {
    expect(index).toContain("redirect: 'manual'")
    // the wait comes from logic.ts, per source and cut to the run's deadline
    expect(index).toContain('AbortSignal.timeout(timeoutMs)')
    expect(index).toContain('readCapped(res.body, MAX_BYTES)')
  })

  it('never overwrites a stored item', () => {
    expect(index).toMatch(/onConflict: 'item_key', ignoreDuplicates: true/)
  })

  it('is set to check its own token in config.toml', () => {
    const config = readFileSync(join(__dirname, '..', '..', 'supabase', 'config.toml'), 'utf8')
    expect(config).toMatch(/\[functions\.news-refresh\]\s+verify_jwt = false/)
  })
})
