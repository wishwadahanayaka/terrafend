import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import {
  areaProblem,
  areaRows,
  cut,
  DOWNLOAD_ATTEMPTS,
  entriesOf,
  isDataRefusal,
  isNotLewm,
  isPdfLink,
  LIST,
  MAX_AREAS,
  MAX_DISTRICT_NAME,
  MAX_DS_NAME,
  MAX_LIST_AGE_MS,
  MAX_PAUSE_MS,
  NEWEST_ENTRIES,
  pagesText,
  PDF_DIR,
  PDF_MAX_BYTES,
  PDF_URL_RULE,
  pdfShape,
  readCappedBytes,
  refresh,
  STATE_ID,
  warningProblem,
  type AreaRow,
  type BytesResult,
  type Deps,
  type Options,
  type SeenRow,
  type WarningRow,
} from '../../supabase/functions/landslide-refresh/logic.ts'
import type { PdfPage } from '../../supabase/functions/landslide-refresh/lewm.ts'
import { USER_AGENT, emptyState, type FetchResult, type SourceState } from '../../supabase/functions/news-refresh/logic.ts'
import { SOURCES } from '../../supabase/functions/news-refresh/sources.ts'
import { MAX_PDF_BYTES } from '../../supabase/functions/landslide-refresh/pdfText.ts'
import { matchNames } from '../../supabase/functions/landslide-refresh/names.ts'
import { readLewm } from '../../supabase/functions/landslide-refresh/lewm.ts'

// The landslide-refresh function's logic against stand-ins for DMC, the PDF reader and the database.
// No network. The warnings' text is from real LEWMs (src/lib/fixtures/lewm), kept as text with positions.

const ROOT = join(__dirname, '..', '..')
const FUNCTION = join(ROOT, 'supabase', 'functions', 'landslide-refresh')
const fixture = (name: string): PdfPage[] => JSON.parse(readFileSync(join(__dirname, 'fixtures', 'lewm', `${name}.json`), 'utf8')).pages
const gazetteer = JSON.parse(readFileSync(join(FUNCTION, 'ds-names.json'), 'utf8'))

const MIN = 60_000
const HOUR = 60 * MIN
const DAY = 24 * HOUR
// 3:30 pm in Sri Lanka, Sunday 15 Nov 2026
const NOW = Date.parse('2026-11-15T10:00:00Z')

// ---- Warnings as the PDF reader would hand them over ----

const A = fixture('LEWM-14-11-2026-1600-09') // 14 Nov, 4:00 pm Sri Lanka time, valid to 15 Nov 4:00 pm: 17 names
const change = (pages: PdfPage[], fn: (text: string) => string): PdfPage[] =>
  pages.map((p) => ({ items: p.items.map((i) => ({ ...i, str: fn(i.str) })) }))

// A newer message: 15 Nov, 9:00 am Sri Lanka time (the same layout with its numbers changed)
const NEWER = change(A, (s) =>
  s
    .replace('LEWM-14-11-2026-1600-09', 'LEWM-15-11-2026-0900-10')
    .replace(/Update:\s*9\b/, 'Update: 10')
    .replace('From 16:00 hrs on 14.11.2026 To 16:00 hrs on 15.11.2026', 'From 09:00 hrs on 15.11.2026 To 09:00 hrs on 16.11.2026')
    .replace(/^14-11-2026, 16:00/, '15-11-2026, 09:00'),
)
// The table lost its Level 2 column header: a layout nobody has seen
const BROKEN = A.map((p) => ({ items: p.items.filter((i) => i.str !== 'Level 2 (Amber)') }))
// One name the Survey Department's list doesn't have
const ODD_NAME = change(A, (s) => s.replace('Passara', 'Nowhereville'))
const NOT_A_WARNING: PdfPage[] = [{ items: [{ str: 'Annual Report 2025 of the Department', x: 40, y: 60, width: 200 }] }]
const SCAN: PdfPage[] = [{ items: [] }]

type Pdf = PdfPage[] | 'throws' | 'html' | 'cut' | 'big' | { status: number } | { redirect: string }

// ---- A stand-in DMC, reader and database ----

const HOST = 'https://www.dmc.gov.lk'
const pdfUrl = (name: string) => `${HOST}${PDF_DIR}${name}`
type Item = { name: string; date: string; time: string; title?: string; href?: string }

const listPage = (items: Item[]) =>
  `<table class="table"><tr class="mhead "><td>Title</td><td>Date</td><td>Time (24h)</td><td></td></tr>` +
  items
    .map((i) => `<tr class="rowdate_0">\n<td>${i.title ?? 'Landslide Warning'}</td>\n<td>${i.date}</td>\n<td>${i.time}</td>\n<td><a href="${i.href ?? `${PDF_DIR}${i.name}`}">Download</a></td>\n</tr>`)
    .join('') +
  `</table>`

// What the real database function and tables refuse (0011), so a row the function builds that the
// database would reject fails here too
function checkRows(w: WarningRow, areas: AreaRow[]) {
  if (!/^https:\/\/(www\.)?dmc\.gov\.lk\/images\/dmcreports\//.test(w.pdf_url) || w.pdf_url.length > 2048) throw new Error('pdf_url')
  // What the casts in store_landslide_warning() refuse: ::timestamptz and ::smallint
  for (const t of [w.listed_at, w.issued_at, w.valid_from, w.valid_to]) if (t !== null && !Number.isFinite(Date.parse(t))) throw new Error('invalid timestamptz')
  if (w.update_number !== null && !Number.isInteger(w.update_number)) throw new Error('invalid smallint')
  if (w.parse_ok) {
    const ok =
      /^LEWM-\d{2}-\d{2}-\d{4}-\d{4}-\d{1,3}$/.test(w.message_id ?? '') &&
      w.update_number !== null && w.update_number >= 0 && w.update_number <= 999 &&
      w.issued_at && w.valid_from && w.valid_to && Date.parse(w.valid_to) > Date.parse(w.valid_from) && w.parse_error === null
    if (!ok) throw new Error('landslide_warnings_read_or_not (read)')
  } else {
    const ok = w.parse_error && w.parse_error.length >= 1 && w.parse_error.length <= 300 && !w.message_id && w.update_number === null && !w.issued_at && !w.valid_from && !w.valid_to
    if (!ok) throw new Error('landslide_warnings_read_or_not (not read)')
    if (areas.length > 0) throw new Error('a warning that could not be read has no areas')
  }
  const codes = new Set<string>()
  for (const a of areas) {
    if (![1, 2, 3].includes(a.level) || a.shift < -2 || a.shift > 2) throw new Error('level or shift')
    if (a.district_name.length < 1 || a.district_name.length > 60 || a.ds_name.length < 1 || a.ds_name.length > 80) throw new Error('name length')
    if (a.area_code !== null && !/^LK\d{4}$/.test(a.area_code)) throw new Error('area_code')
    if (a.district_code !== null && !/^LK\d{2}$/.test(a.district_code)) throw new Error('district_code')
    if (a.match_note !== null && a.match_note.length > 200) throw new Error('match_note')
    const matched = a.area_code !== null && a.district_code !== null && a.area_code.startsWith(a.district_code) && a.match_note === null
    const explained = a.area_code === null && a.match_note !== null
    if (!matched && !explained) throw new Error('landslide_areas_matched_or_explained')
    if (a.area_code !== null) {
      if (codes.has(a.area_code)) throw new Error('landslide_areas_one_per_division')
      codes.add(a.area_code)
    }
  }
}

type Stored = { id: number; warning: WarningRow; areas: AreaRow[] }

function setup(
  config: {
    list?: Item[]
    pdfs?: Record<string, Pdf>
    robots?: FetchResult | Error
    listReply?: FetchResult | Error
    state?: SourceState | null
    stored?: Stored[]
    seen?: SeenRow[]
    // Every store call fails with this, and this Postgres code (none: a network error, a timeout...)
    storeError?: string
    storeCode?: string
    // Only storing a READ warning fails with this and rejectCode (default 23514, a failed check). A
    // warning that could not be read still goes in.
    rejectRead?: string
    rejectCode?: string
    // Only storing a warning with this link fails (with storeError, storeCode)
    failLink?: string
    // How long each PDF download takes, for the run's time budget
    pdfMs?: number
  } = {},
) {
  let clock = NOW
  const db = {
    warnings: [...(config.stored ?? [])],
    seen: new Map((config.seen ?? []).map((s) => [s.pdf_url, s])),
    state: config.state ?? null,
    stateWrites: 0,
    storeCalls: 0,
  }
  const sleeps: number[] = []
  const calls: { url: string; method: string; headers: Record<string, string> }[] = []
  const pdfCalls: string[] = []
  const logs: Record<string, unknown>[] = []
  let list = config.list ?? []
  const pdfs = { ...(config.pdfs ?? {}) }
  const ok = (body: string, headers: Partial<FetchResult['headers']> = {}): FetchResult => ({
    status: 200,
    headers: { etag: null, lastModified: null, location: null, ...headers },
    body,
    tooBig: false,
  })

  const bytesOf = (name: string) => new TextEncoder().encode(`%PDF-1.4\n%${name}\n${'x'.repeat(40)}\n%%EOF\n`)
  const nameOf = (bytes: Uint8Array) => /%PDF-1\.4\n%(\S+)\n/.exec(new TextDecoder().decode(bytes))?.[1] ?? ''

  const deps: Deps = {
    now: () => clock,
    sleep: async (ms) => {
      sleeps.push(ms)
      clock += ms
    },
    fetch: vi.fn<Deps['fetch']>(async (url, init) => {
      calls.push({ url, method: init.method, headers: init.headers })
      if (url.endsWith('/robots.txt')) {
        const reply = config.robots ?? { status: 404, headers: { etag: null, lastModified: null, location: null }, body: null, tooBig: false }
        if (reply instanceof Error) throw reply
        return reply
      }
      if (url === LIST.url) {
        const reply = config.listReply ?? ok(listPage(list))
        if (reply instanceof Error) throw reply
        return reply
      }
      throw new Error(`unexpected request: ${url}`)
    }),
    fetchPdf: vi.fn(async (url: string, init: { headers: Record<string, string>; timeoutMs: number }): Promise<BytesResult> => {
      pdfCalls.push(url)
      calls.push({ url, method: 'GET', headers: init.headers })
      clock += config.pdfMs ?? 0
      const name = url.split('/').pop() ?? ''
      const pdf = pdfs[name]
      if (pdf === undefined) return { status: 404, location: null, bytes: null, tooBig: false }
      if (typeof pdf === 'object' && !Array.isArray(pdf) && 'status' in pdf) return { status: pdf.status, location: null, bytes: null, tooBig: false }
      if (typeof pdf === 'object' && !Array.isArray(pdf) && 'redirect' in pdf) return { status: 302, location: pdf.redirect, bytes: null, tooBig: false }
      if (pdf === 'html') return { status: 200, location: null, bytes: new TextEncoder().encode('<html>Service unavailable</html>'), tooBig: false }
      if (pdf === 'cut') return { status: 200, location: null, bytes: new TextEncoder().encode('%PDF-1.4\n%x\n' + 'x'.repeat(100)), tooBig: false }
      if (pdf === 'big') return { status: 200, location: null, bytes: null, tooBig: true }
      return { status: 200, location: null, bytes: bytesOf(name), tooBig: false }
    }),
    readPdf: vi.fn(async (bytes: Uint8Array) => {
      const pdf = pdfs[nameOf(bytes)]
      if (pdf === 'throws') throw new Error('Invalid PDF structure')
      if (!Array.isArray(pdf)) throw new Error(`no pages for ${nameOf(bytes)}`)
      return pdf
    }),
    readState: vi.fn(async () => db.state),
    writeState: vi.fn(async (state: SourceState) => {
      db.stateWrites++
      db.state = JSON.parse(JSON.stringify(state))
    }),
    readSeen: vi.fn(async (urls: string[]) => new Set(urls.filter((u) => db.warnings.some((w) => w.warning.pdf_url === u) || db.seen.has(u)))),
    store: vi.fn(async (warning: WarningRow, areas: AreaRow[]) => {
      db.storeCalls++
      const fail = (message: string, code?: string) => Object.assign(new Error(message), code ? { code } : {})
      if (config.storeError && (!config.failLink || warning.pdf_url.endsWith(config.failLink))) throw fail(config.storeError, config.storeCode)
      if (config.rejectRead && warning.parse_ok) throw fail(config.rejectRead, config.rejectCode ?? '23514')
      checkRows(warning, areas)
      // One unique link and one unique message, like the table
      if (db.warnings.some((w) => w.warning.pdf_url === warning.pdf_url || (warning.message_id && w.warning.message_id === warning.message_id))) return null
      const id = db.warnings.length + 1
      db.warnings.push({ id, warning, areas })
      return id
    }),
    markSeen: vi.fn(async (rows: SeenRow[]) => {
      for (const row of rows) if (!db.seen.has(row.pdf_url)) db.seen.set(row.pdf_url, row)
    }),
    gazetteer,
    log: (entry) => logs.push(entry),
  }

  return {
    deps,
    db,
    sleeps,
    calls,
    pdfCalls,
    logs,
    run: (options?: Options) => refresh(deps, options),
    advance: (ms: number) => void (clock += ms),
    setList: (items: Item[]) => void (list = items),
    setPdf: (name: string, pdf: Pdf) => void (pdfs[name] = pdf),
    clock: () => clock,
  }
}

// What landslide_current() answers (0011), in the same words: the newest warning by when DMC listed
// it, and nothing from an older one
function current(db: { warnings: Stored[] }, now: number) {
  const newest = [...db.warnings].sort((a, b) => Date.parse(b.warning.listed_at) - Date.parse(a.warning.listed_at) || b.id - a.id)[0]
  if (!newest) return { found: false as const }
  const w = newest.warning
  return {
    found: true as const,
    message_id: w.message_id,
    parse_ok: w.parse_ok,
    valid: w.parse_ok && Date.parse(w.valid_to!) > now,
    areas: w.parse_ok ? newest.areas : [],
  }
}

const A_ITEM: Item = { name: 'LEWM_14-11-2026_16_00__1794660156.pdf', date: '2026-11-14', time: '16:00' }
const NEWER_ITEM: Item = { name: 'Landslide_Early_Warning___1794745000.pdf', date: '2026-11-15', time: '09:00' }

// ---- Tests ----

describe('reading DMC the polite way', () => {
  it('asks for the same list as news-refresh, as TerraFend, with its own row of state', async () => {
    const s = setup({ list: [A_ITEM], pdfs: { [A_ITEM.name]: A } })
    await s.run()
    const news = SOURCES.find((x) => x.id === 'dmc_landslide')!
    expect(LIST.url).toBe(news.url)
    expect(LIST.ownDomains).toEqual(news.ownDomains)
    expect(STATE_ID).toBe('landslide_list')
    expect(STATE_ID).not.toBe(news.id)
    for (const call of s.calls) expect(call.headers['User-Agent']).toBe(USER_AGENT)
    expect(s.calls[0].url).toBe('https://www.dmc.gov.lk/robots.txt')
    expect(s.calls[1].url).toBe(LIST.url)
    expect(s.db.state?.source).toBe(STATE_ID)
  })

  it('does not ask again within the interval, and asks when it is due (a run every 30 minutes always is)', async () => {
    const s = setup({ list: [A_ITEM], pdfs: { [A_ITEM.name]: A } })
    await s.run()
    s.advance(10 * MIN)
    const early = await s.run()
    expect(early.list.status).toBe('not_due')
    expect(early.result).toBe('ok')
    s.advance(20 * MIN)
    expect((await s.run()).list.status).not.toBe('not_due')
    expect(LIST.everyMin).toBeLessThanOrEqual(30)
  })

  it('force asks now, and a dry run still keeps to the interval unless forced', async () => {
    const s = setup({ list: [A_ITEM], pdfs: { [A_ITEM.name]: A } })
    await s.run()
    s.advance(5 * MIN)
    expect((await s.run({ dryRun: true })).list.status).toBe('not_due')
    expect((await s.run({ dryRun: true, force: true })).list.status).toBe('ok')
  })

  it('sends If-None-Match and If-Modified-Since from the last answer, and a 304 means nothing is done', async () => {
    const s = setup({
      list: [A_ITEM],
      pdfs: { [A_ITEM.name]: A },
      listReply: { status: 200, headers: { etag: '"v1"', lastModified: 'Sat, 14 Nov 2026 10:31:00 GMT', location: null }, body: listPage([A_ITEM]), tooBig: false },
    })
    await s.run()
    expect(s.db.state?.etag).toBe('"v1"')
    s.advance(30 * MIN)
    const answer = { status: 304, headers: { etag: null, lastModified: null, location: null }, body: null, tooBig: false }
    ;(s.deps.fetch as ReturnType<typeof vi.fn>).mockImplementation(async (url: string, init: { method: string; headers: Record<string, string> }) => {
      s.calls.push({ url, method: init.method, headers: init.headers })
      return url.endsWith('/robots.txt') ? { ...answer, status: 404 } : answer
    })
    const second = await s.run()
    const listCall = s.calls.filter((c) => c.url === LIST.url).pop()!
    expect(listCall.headers['If-None-Match']).toBe('"v1"')
    expect(listCall.headers['If-Modified-Since']).toBe('Sat, 14 Nov 2026 10:31:00 GMT')
    expect(second.list.status).toBe('not_modified')
    expect(second.pdfs).toEqual([])
    expect(s.pdfCalls).toHaveLength(1)
    expect(s.db.state?.failures).toBe(0)
  })

  it('a dry run sends no caching headers and writes nothing, not even its state', async () => {
    const s = setup({ list: [A_ITEM], pdfs: { [A_ITEM.name]: A }, state: { ...emptyState(STATE_ID), etag: '"old"', last_modified: 'yesterday' } })
    await s.run({ dryRun: true })
    const listCall = s.calls.find((c) => c.url === LIST.url)!
    expect(listCall.headers['If-None-Match']).toBeUndefined()
    expect(listCall.headers['If-Modified-Since']).toBeUndefined()
    expect(s.deps.writeState).not.toHaveBeenCalled()
    expect(s.deps.store).not.toHaveBeenCalled()
    expect(s.deps.markSeen).not.toHaveBeenCalled()
  })

  it('stops when robots.txt does not allow the list, and does not download anything', async () => {
    const robots = { status: 200, headers: { etag: null, lastModified: null, location: null }, body: 'User-agent: *\nDisallow: /index.php', tooBig: false }
    const s = setup({ list: [A_ITEM], pdfs: { [A_ITEM.name]: A }, robots })
    const out = await s.run()
    expect(out.list.status).toBe('robots_disallow')
    expect(out.result).toBe('failed')
    expect(s.calls.every((c) => c.url.endsWith('/robots.txt'))).toBe(true)
    expect(s.db.state?.last_error).toBe('robots.txt does not allow this address')
    expect(s.db.state?.robots_ok).toBe(false)
  })

  it('does not download PDFs when robots.txt disallows their folder, though the list is fine', async () => {
    const robots = { status: 200, headers: { etag: null, lastModified: null, location: null }, body: `User-agent: *\nDisallow: ${PDF_DIR}`, tooBig: false }
    const s = setup({ list: [A_ITEM], pdfs: { [A_ITEM.name]: A }, robots })
    const out = await s.run()
    expect(out.list.status).toBe('ok')
    expect(s.pdfCalls).toEqual([])
    expect(out.pdfs).toMatchObject([{ outcome: 'robots_disallow', stored: false }])
    expect(out.result).toBe('failed')
    expect(s.db.warnings).toEqual([])
  })

  it('treats a robots.txt that cannot be reached as "not allowed for now", with its reason, and then backs off', async () => {
    const s = setup({ list: [A_ITEM], pdfs: { [A_ITEM.name]: A }, robots: new Error('connection reset') })
    const out = await s.run()
    expect(out.list.status).toBe('robots_unknown')
    expect(s.calls).toHaveLength(1)
    expect(s.db.state).toMatchObject({ last_error: 'robots.txt: connection reset', failures: 1 })
    // after 503s too, and the last answer stands once there is one
    const s2 = setup({ list: [A_ITEM], robots: { status: 503, headers: { etag: null, lastModified: null, location: null }, body: null, tooBig: false } })
    expect((await s2.run()).list.error).toBe('robots.txt: HTTP 503')
  })

  it('keeps a Crawl-delay: it waits at least that long before each PDF, and gives up on PDFs if it is too long', async () => {
    const withDelay = (n: number) => ({ status: 200, headers: { etag: null, lastModified: null, location: null }, body: `User-agent: *\nCrawl-delay: ${n}`, tooBig: false })
    const s = setup({ list: [A_ITEM, NEWER_ITEM], pdfs: { [A_ITEM.name]: A, [NEWER_ITEM.name]: NEWER }, robots: withDelay(10) })
    await s.run()
    expect(s.sleeps).toEqual([10_000, 10_000])
    const slow = setup({ list: [A_ITEM], pdfs: { [A_ITEM.name]: A }, robots: withDelay(3600) })
    const out = await slow.run()
    expect(slow.pdfCalls).toEqual([])
    expect(out.errors.join()).toMatch(/too long to download PDFs/)
    expect(MAX_PAUSE_MS).toBeLessThan(60_000)
  })

  it('pauses before each PDF even with no Crawl-delay', async () => {
    const s = setup({ list: [A_ITEM, NEWER_ITEM], pdfs: { [A_ITEM.name]: A, [NEWER_ITEM.name]: NEWER } })
    await s.run()
    expect(s.sleeps).toEqual([1_000, 1_000])
  })

  it('a list that fails, is empty, or has no usable rows is a failure with its reason, and no PDF is touched', async () => {
    const reply = (status: number, body: string | null): FetchResult => ({ status, headers: { etag: null, lastModified: null, location: null }, body, tooBig: false })
    for (const [listReply, why] of [
      [reply(500, null), 'HTTP 500'],
      [reply(200, '<html>nothing here</html>'), 'no rows found'],
      [reply(200, listPage([{ ...A_ITEM, href: 'https://evil.example/x.pdf' }, { ...A_ITEM, time: 'late' }])), 'no usable rows'],
      [new Error('timed out'), 'timed out'],
    ] as [FetchResult | Error, string][]) {
      const s = setup({ list: [A_ITEM], pdfs: { [A_ITEM.name]: A }, listReply })
      const out = await s.run()
      expect(out.result, why).toBe('failed')
      expect(out.list.status).toBe('failed')
      expect(out.list.error).toContain(why)
      expect(s.pdfCalls).toEqual([])
      expect(s.db.state).toMatchObject({ failures: 1 })
      expect(s.db.state?.last_error).toContain(why)
    }
  })

  it('after 3 failures in a row it asks at most hourly, the same backoff as the news sources', async () => {
    const s = setup({ list: [A_ITEM], state: { ...emptyState(STATE_ID), failures: 3, last_fetch_at: new Date(NOW - 30 * MIN).toISOString(), robots_ok: true, robots_at: new Date(NOW - HOUR).toISOString() } })
    expect((await s.run()).list.status).toBe('not_due')
    s.advance(35 * MIN)
    expect((await s.run()).list.status).not.toBe('not_due')
  })
})

describe('a new PDF', () => {
  it('is read, its names matched and the warning and its areas stored in one call', async () => {
    const s = setup({ list: [A_ITEM], pdfs: { [A_ITEM.name]: A } })
    const out = await s.run()
    expect(out).toMatchObject({ result: 'ok', stored: 1, list: { status: 'ok', looked: 1 } })
    expect(s.deps.store).toHaveBeenCalledTimes(1)
    const [stored] = s.db.warnings
    expect(stored.warning).toEqual({
      pdf_url: pdfUrl(A_ITEM.name),
      message_id: 'LEWM-14-11-2026-1600-09',
      update_number: 9,
      // 4:00 pm in Sri Lanka, from DMC's list
      listed_at: '2026-11-14T10:30:00.000Z',
      issued_at: '2026-11-14T10:30:00.000Z',
      valid_from: '2026-11-14T10:30:00.000Z',
      valid_to: '2026-11-15T10:30:00.000Z',
      parse_ok: true,
      parse_error: null,
    })
    expect(stored.areas).toHaveLength(17)
    expect(stored.areas.every((a) => a.level === 1 && a.area_code && a.match_note === null)).toBe(true)
    expect(stored.areas[1]).toEqual({
      level: 1,
      district_name: 'Badulla',
      ds_name: 'Hali_Ela',
      area_code: 'LK8124',
      district_code: 'LK81',
      shift: -1,
      added: false,
      match_note: null,
    })
    expect(out.pdfs[0]).toMatchObject({ outcome: 'read', stored: true, summary: { messageId: 'LEWM-14-11-2026-1600-09', update: 9, matched: 17, unmatched: 0 } })
  })

  it('is identified by the message inside it, not by its file name', async () => {
    const odd = 'Landslide_EW_Report_at_1600hrs_on_2026__1794567685.pdf'
    const s = setup({ list: [{ name: odd, date: '2026-11-14', time: '16:00' }], pdfs: { [odd]: A } })
    await s.run()
    expect(s.db.warnings[0].warning.message_id).toBe('LEWM-14-11-2026-1600-09')
    expect(s.db.warnings[0].warning.pdf_url).toBe(pdfUrl(odd))
  })

  it('is stored with the time DMC listed it, even if that is in the future', async () => {
    const s = setup({ list: [{ ...A_ITEM, date: '2026-11-20' }], pdfs: { [A_ITEM.name]: A } })
    await s.run()
    expect(s.db.warnings[0].warning.listed_at).toBe(new Date(NOW).toISOString())
  })

  it('keeps a name that matches nothing, as text with the reason, and a null code', async () => {
    const s = setup({ list: [A_ITEM], pdfs: { [A_ITEM.name]: ODD_NAME } })
    const out = await s.run()
    const { areas } = s.db.warnings[0]
    expect(areas).toHaveLength(17)
    expect(areas.filter((a) => a.area_code === null)).toEqual([
      {
        level: 1,
        district_name: 'Badulla',
        ds_name: 'Nowhereville',
        area_code: null,
        district_code: 'LK81',
        shift: -1,
        added: false,
        match_note: 'no DS division of that name in Badulla',
      },
    ])
    expect(out.pdfs[0].summary).toMatchObject({ matched: 16, unmatched: 1 })
  })

  it('stores every name as a row: matched and unmatched add up to the names printed, whatever the warning', () => {
    for (const pages of [A, NEWER, ODD_NAME, fixture('LEWM-18-10-2026-1800-20'), fixture('LEWM-14-05-2026-2200-08')]) {
      const w = readLewm(pages)
      if (!w.parseOk) throw new Error(w.reason)
      const matched = matchNames(w, gazetteer)
      const rows = areaRows(matched)
      expect(rows.length).toBe(matched.areas.length + matched.unmatched.length)
      expect(areaProblem(rows)).toBeNull()
      expect(() => checkRows({ pdf_url: pdfUrl('a.pdf'), message_id: w.messageId, update_number: w.update, listed_at: '2026-11-14T10:30:00Z', issued_at: new Date(w.issuedAt).toISOString(), valid_from: new Date(w.validFrom).toISOString(), valid_to: new Date(w.validTo).toISOString(), parse_ok: true, parse_error: null }, rows)).not.toThrow()
    }
  })

  it('stores nothing half-way: the warning and its areas go in one call', async () => {
    const s = setup({ list: [A_ITEM], pdfs: { [A_ITEM.name]: A } })
    await s.run()
    expect(s.deps.store).toHaveBeenCalledTimes(1)
    expect(s.db.warnings[0].areas).toHaveLength(17)
  })

  it('the same message from another address is stored once, and the second address is remembered as seen', async () => {
    const copy: Item = { name: 'Landslide_Early_Warning_copy.pdf', date: '2026-11-14', time: '16:05' }
    const s = setup({ list: [A_ITEM, copy], pdfs: { [A_ITEM.name]: A, [copy.name]: A } })
    const out = await s.run()
    expect(s.db.warnings).toHaveLength(1)
    expect(out.pdfs.map((p) => p.outcome).sort()).toEqual(['duplicate', 'read'])
    // the newest is read first and stored; the older address then turns out to be the same message
    expect([...s.db.seen.values()]).toEqual([{ pdf_url: pdfUrl(A_ITEM.name), outcome: 'duplicate', note: 'LEWM-14-11-2026-1600-09 was already stored' }])
    expect(out.stored).toBe(1)
  })

  it('a newer message is stored beside the older one, each with its own areas', async () => {
    const s = setup({ list: [NEWER_ITEM, A_ITEM], pdfs: { [A_ITEM.name]: A, [NEWER_ITEM.name]: NEWER } })
    await s.run()
    expect(s.db.warnings.map((w) => w.warning.message_id).sort()).toEqual(['LEWM-14-11-2026-1600-09', 'LEWM-15-11-2026-0900-10'])
    expect(s.db.warnings.every((w) => w.areas.length === 17)).toBe(true)
  })
})

describe('a PDF seen before', () => {
  it('is not downloaded again: stored warnings and skipped PDFs both count as seen', async () => {
    const s = setup({ list: [A_ITEM, NEWER_ITEM], pdfs: { [A_ITEM.name]: A, [NEWER_ITEM.name]: NOT_A_WARNING } })
    await s.run()
    expect(s.pdfCalls).toHaveLength(2)
    s.advance(30 * MIN)
    const again = await s.run()
    expect(s.pdfCalls).toHaveLength(2)
    expect(again).toMatchObject({ result: 'ok', stored: 0, pdfs: [], list: { looked: 0 } })
  })

  it('is only re-read by a forced run', async () => {
    const s = setup({ list: [A_ITEM], pdfs: { [A_ITEM.name]: A } })
    await s.run()
    const forced = await s.run({ force: true })
    expect(s.pdfCalls).toHaveLength(2)
    // the table refuses the repeat (same address), so nothing is stored twice
    expect(s.db.warnings).toHaveLength(1)
    expect(forced.stored).toBe(0)
  })

  it('looks at the newest few entries only, newest first, and nothing older than 13 days', async () => {
    const many: Item[] = Array.from({ length: 8 }, (_, i) => ({ name: `w${i}.pdf`, date: `2026-11-${String(14 - i).padStart(2, '0')}`, time: '16:00' }))
    const old: Item = { name: 'old.pdf', date: '2026-10-20', time: '16:00' }
    const s = setup({ list: [...many.slice().reverse(), old], pdfs: Object.fromEntries([...many, old].map((i) => [i.name, NOT_A_WARNING])) })
    await s.run()
    expect(NEWEST_ENTRIES).toBe(5)
    expect(s.pdfCalls.map((u) => u.split('/').pop())).toEqual(['w0.pdf', 'w1.pdf', 'w2.pdf', 'w3.pdf', 'w4.pdf'])
    expect(MAX_LIST_AGE_MS).toBeLessThan(14 * DAY)
    const onlyOld = setup({ list: [old], pdfs: { 'old.pdf': A } })
    expect((await onlyOld.run()).list.looked).toBe(0)
    // ?pdfs=N changes how many
    const more = setup({ list: many, pdfs: Object.fromEntries(many.map((i) => [i.name, NOT_A_WARNING])) })
    await more.run({ pdfs: 2 })
    expect(more.pdfCalls).toHaveLength(2)
  })
})

describe('a PDF that is not a landslide warning', () => {
  it('is recorded as seen and skipped, and never stored as a warning', async () => {
    const s = setup({ list: [A_ITEM], pdfs: { [A_ITEM.name]: NOT_A_WARNING } })
    const out = await s.run()
    expect(out.pdfs).toMatchObject([{ outcome: 'not_lewm', stored: false }])
    expect(s.db.warnings).toEqual([])
    expect([...s.db.seen.values()]).toEqual([{ pdf_url: pdfUrl(A_ITEM.name), outcome: 'not_lewm', note: expect.stringContaining('no "Landslide Early Warning"') }])
    expect(out.result).toBe('ok')
  })

  it('needs readable text without the title or message: a scan or a layout it cannot read is "could not be read", never skipped', async () => {
    expect(isNotLewm('Annual Report 2025')).toBe(true)
    expect(isNotLewm('')).toBe(false)
    expect(isNotLewm('   ')).toBe(false)
    expect(isNotLewm('Landslide  Early Warning ...')).toBe(false)
    expect(isNotLewm('Message ID: LEWM-14-11-2026-1600-09')).toBe(false)
    const s = setup({ list: [A_ITEM], pdfs: { [A_ITEM.name]: SCAN } })
    await s.run()
    expect(s.db.seen.size).toBe(0)
    expect(s.db.warnings[0].warning).toMatchObject({ parse_ok: false, parse_error: expect.stringContaining('no text') })
  })

  it('pagesText joins the text of every page', () => {
    expect(pagesText([{ items: [{ str: 'a', x: 0, y: 0, width: 1 }, { str: 'b', x: 0, y: 0, width: 1 }] }, { items: [{ str: 'c', x: 0, y: 0, width: 1 }] }])).toBe('a b\nc')
  })
})

describe('a PDF that cannot be read', () => {
  it('is stored as a warning that could not be read, with the reason, no message, no times and no areas', async () => {
    const s = setup({ list: [A_ITEM], pdfs: { [A_ITEM.name]: BROKEN } })
    const out = await s.run()
    expect(s.db.warnings).toHaveLength(1)
    expect(s.db.warnings[0].warning).toEqual({
      pdf_url: pdfUrl(A_ITEM.name),
      message_id: null,
      update_number: null,
      listed_at: '2026-11-14T10:30:00.000Z',
      issued_at: null,
      valid_from: null,
      valid_to: null,
      parse_ok: false,
      parse_error: 'the table header is incomplete',
    })
    expect(s.db.warnings[0].areas).toEqual([])
    expect(out.pdfs[0]).toMatchObject({ outcome: 'unreadable', stored: true, reason: 'the table header is incomplete' })
    expect(out.stored).toBe(0)
  })

  it('is not downloaded again once recorded (to try again after a fix, delete its row: docs/landslide-areas.md)', async () => {
    const s = setup({ list: [A_ITEM], pdfs: { [A_ITEM.name]: BROKEN } })
    await s.run()
    s.advance(30 * MIN)
    await s.run()
    expect(s.pdfCalls).toHaveLength(1)
    s.db.warnings.length = 0
    s.advance(30 * MIN)
    s.setPdf(A_ITEM.name, A)
    await s.run()
    expect(s.db.warnings[0].warning.parse_ok).toBe(true)
  })

  it('PDF library errors, and a name or list longer than the table allows, are also "could not be read"', async () => {
    const s = setup({ list: [A_ITEM], pdfs: { [A_ITEM.name]: 'throws' } })
    await s.run()
    expect(s.db.warnings[0].warning.parse_error).toBe('the PDF could not be read: Invalid PDF structure')
    const long = setup({ list: [A_ITEM], pdfs: { [A_ITEM.name]: change(A, (x) => x.replace('Passara', 'P'.repeat(MAX_DS_NAME + 1))) } })
    await long.run()
    expect(long.db.warnings[0].warning).toMatchObject({ parse_ok: false, parse_error: expect.stringContaining('longer than expected') })
    expect(areaProblem(Array.from({ length: MAX_AREAS + 1 }, () => ({ level: 1, district_name: 'A', ds_name: 'B', area_code: null, district_code: null, shift: 0, added: false, match_note: 'x' }) as AreaRow))).toMatch(/more than 600/)
    expect(MAX_DISTRICT_NAME).toBe(60)
  })

  it('a PDF over the size limit is "could not be read", since a real warning is under 1 MB but silence would be worse', async () => {
    const s = setup({ list: [A_ITEM], pdfs: { [A_ITEM.name]: 'big' } })
    await s.run()
    expect(s.db.warnings[0].warning.parse_error).toBe(`the PDF is over ${PDF_MAX_BYTES} bytes`)
  })
})

describe('a row the database would refuse', () => {
  const READ: WarningRow = {
    pdf_url: pdfUrl('a.pdf'),
    message_id: 'LEWM-14-11-2026-1600-09',
    update_number: 9,
    listed_at: '2026-11-14T10:30:00.000Z',
    issued_at: '2026-11-14T10:30:00.000Z',
    valid_from: '2026-11-14T10:30:00.000Z',
    valid_to: '2026-11-15T10:30:00.000Z',
    parse_ok: true,
    parse_error: null,
  }
  const NOT_READ: WarningRow = { ...READ, message_id: null, update_number: null, issued_at: null, valid_from: null, valid_to: null, parse_ok: false, parse_error: 'the table header is incomplete' }
  const AREA: AreaRow = { level: 1, district_name: 'Badulla', ds_name: 'Passara', area_code: 'LK8118', district_code: 'LK81', shift: 0, added: false, match_note: null }
  const UNMATCHED: AreaRow = { ...AREA, ds_name: 'Nowhereville', area_code: null, match_note: 'no DS division of that name in Badulla' }

  it('finds every warning rule of 0011 before the database does', () => {
    expect(warningProblem(READ)).toBeNull()
    expect(warningProblem(NOT_READ)).toBeNull()
    const bad: [Partial<WarningRow>, RegExp][] = [
      [{ message_id: 'LEWM-14-11-2026-1600-1000' }, /message ID/],
      [{ message_id: 'lewm-14-11-2026-1600-09' }, /message ID/],
      [{ message_id: 'LEWM-14-11-2026-1600-09\n' }, /message ID/],
      [{ message_id: null }, /message ID/],
      [{ update_number: 1000 }, /update number/],
      [{ update_number: -1 }, /update number/],
      [{ update_number: 2.5 }, /update number/],
      [{ valid_to: READ.valid_from }, /ends before it starts/],
      [{ valid_to: '2026-11-13T10:30:00.000Z' }, /ends before it starts/],
      [{ issued_at: 'not a time' }, /time in the message/],
      [{ listed_at: '' }, /listed time/],
      [{ parse_error: 'x' }, /has a reason/],
      [{ pdf_url: 'https://evil.example/images/dmcreports/a.pdf' }, /not on DMC/],
      [{ pdf_url: 'https://www.dmc.gov.lk/files/a.pdf' }, /not on DMC/],
      [{ pdf_url: pdfUrl('a'.repeat(2048)) }, /not on DMC/],
    ]
    for (const [change, why] of bad) {
      expect(warningProblem({ ...READ, ...change }), JSON.stringify(change)).toMatch(why)
      // and the stand-in database (which mirrors 0011) refuses each of them too
      expect(() => checkRows({ ...READ, ...change }, []), JSON.stringify(change)).toThrow()
    }
    expect(warningProblem({ ...NOT_READ, parse_error: '' })).toMatch(/reason/)
    expect(warningProblem({ ...NOT_READ, parse_error: 'x'.repeat(301) })).toMatch(/reason/)
    expect(warningProblem({ ...NOT_READ, parse_error: 'x'.repeat(300) })).toBeNull()
    expect(warningProblem({ ...NOT_READ, message_id: READ.message_id })).toMatch(/has data/)
  })

  it('finds every area rule of 0011, including one division named twice', () => {
    expect(areaProblem([AREA, UNMATCHED])).toBeNull()
    const bad: [Partial<AreaRow>, RegExp][] = [
      [{ area_code: 'LK818' }, /odd code/],
      [{ area_code: 'lk8118' }, /odd code/],
      [{ district_code: 'LK8' }, /odd district code/],
      [{ district_code: 'LK21' }, /not in its district/],
      [{ district_code: null }, /not in its district/],
      [{ match_note: 'why' }, /matched but has a note/],
      [{ area_code: null, match_note: null }, /no reason/],
      [{ level: 4 as AreaRow['level'] }, /level 4/],
      [{ shift: 3 }, /level change/],
      [{ ds_name: '' }, /empty or longer/],
      [{ ds_name: 'P'.repeat(MAX_DS_NAME + 1) }, /empty or longer/],
      [{ district_name: 'D'.repeat(MAX_DISTRICT_NAME + 1) }, /empty or longer/],
      [{ ds_name: `Pass${String.fromCharCode(0)}ara` }, /empty or longer/],
      [{ ds_name: 'Pass\uD800ara' }, /empty or longer/],
      [{ ...UNMATCHED, match_note: 'n'.repeat(201) }, /note that is too long/],
    ]
    for (const [change, why] of bad) expect(areaProblem([{ ...AREA, ...change }]), JSON.stringify(change)).toMatch(why)
    expect(areaProblem([AREA, { ...AREA, level: 2 }])).toMatch(/LK8118 .* named twice/)
    expect(() => checkRows(READ, [AREA, { ...AREA, level: 2 }])).toThrow('landslide_areas_one_per_division')
    // characters, as Postgres counts them: 80 emoji (two JS units each) are fine, 81 are not
    expect(areaProblem([{ ...AREA, ds_name: '😀'.repeat(MAX_DS_NAME) }])).toBeNull()
    expect(areaProblem([{ ...AREA, ds_name: '😀'.repeat(MAX_DS_NAME + 1) }])).toMatch(/longer/)
  })

  // A name longer than landslide_areas allows. The reader itself refuses odd characters in a name, and
  // one division named twice can't get this far either: matchNames() keeps one row per division (and
  // areaProblem() checks again).
  const LONG_NAME = change(A, (x) => x.replace('Passara', 'P'.repeat(MAX_DS_NAME + 1)))

  it('a warning that breaks a rule is stored as "could not be read" with the reason, and is not downloaded again', async () => {
    const s = setup({ list: [A_ITEM], pdfs: { [A_ITEM.name]: LONG_NAME } })
    const out = await s.run()
    expect(s.db.warnings).toHaveLength(1)
    expect(s.db.warnings[0].warning).toMatchObject({ parse_ok: false, message_id: null, parse_error: `a name is empty or longer than expected: "${'P'.repeat(40)}"` })
    expect(s.db.warnings[0].areas).toEqual([])
    expect(out.pdfs[0]).toMatchObject({ outcome: 'unreadable', stored: true })
    // what was read is still in the report, to see what went wrong
    expect(out.pdfs[0].summary?.messageId).toBe('LEWM-14-11-2026-1600-09')
    s.advance(30 * MIN)
    await s.run()
    expect(s.pdfCalls).toHaveLength(1)
  })

  it('a dry run says the same, and stores nothing', async () => {
    const s = setup({ list: [A_ITEM], pdfs: { [A_ITEM.name]: LONG_NAME } })
    const out = await s.run({ dryRun: true })
    expect(out.pdfs[0]).toMatchObject({ outcome: 'unreadable', stored: false, reason: expect.stringMatching(/empty or longer/) })
    expect(s.deps.store).not.toHaveBeenCalled()
  })

  it('if the database still refuses it, it is stored as "could not be read" with "database rejected:", once, and not tried every run', async () => {
    const s = setup({ list: [A_ITEM], pdfs: { [A_ITEM.name]: A }, rejectRead: `23514 new row violates check constraint "x" ${'y'.repeat(400)}` })
    const out = await s.run()
    expect(s.deps.store).toHaveBeenCalledTimes(2)
    expect(s.db.warnings).toHaveLength(1)
    const reason = s.db.warnings[0].warning.parse_error!
    expect(s.db.warnings[0].warning.parse_ok).toBe(false)
    expect(reason.startsWith('database rejected: 23514 new row violates check constraint')).toBe(true)
    expect(reason.length).toBeLessThanOrEqual(300)
    expect(out.pdfs[0]).toMatchObject({ outcome: 'unreadable', stored: true })
    // said in the answer and the log, so the owner notices
    expect(out.result).toBe('failed')
    expect(out.errors.join()).toMatch(/LEWM-14-11-2026-1600-09: the database refused it/)
    expect(s.logs.some((l) => typeof l.reason === 'string' && l.reason.startsWith('database rejected:'))).toBe(true)
    // the next run finds it stored, downloads nothing and is fine again
    s.advance(30 * MIN)
    const next = await s.run()
    expect(s.pdfCalls).toHaveLength(1)
    expect(next.result).toBe('ok')
    expect(s.db.state?.failures).toBe(0)
  })

  it('if even that fails, it is logged and the run moves on: nothing is stored, and the next run tries again', async () => {
    // every store call is refused as data, the "could not be read" row too
    const s = setup({ list: [NEWER_ITEM, A_ITEM], pdfs: { [A_ITEM.name]: A, [NEWER_ITEM.name]: NEWER }, storeError: 'connection lost', storeCode: '22003' })
    const out = await s.run()
    // both PDFs were handled: the first failure did not stop the run
    expect(out.pdfs.map((p) => p.outcome)).toEqual(['unreadable', 'unreadable'])
    expect(s.deps.store).toHaveBeenCalledTimes(4)
    expect(s.db.warnings).toEqual([])
    expect(s.db.seen.size).toBe(0)
    expect(out.result).toBe('failed')
    expect(out.errors.join()).toMatch(/storing it as "could not be read" failed too: connection lost/)
    expect(s.logs.filter((l) => typeof l.message === 'string' && /failed too/.test(l.message))).toHaveLength(2)
    expect(s.db.state?.failures).toBe(1)
    s.advance(60 * MIN)
    await s.run()
    expect(s.pdfCalls).toHaveLength(4)
  })

  it('only a Postgres error of class 22 (data exception) or 23 (integrity constraint) means the data was refused', () => {
    const code = (c: unknown) => isDataRefusal({ code: c })
    for (const yes of ['22001', '22003', '22007', '22P02', '23502', '23503', '23505', '23514']) expect(code(yes), yes).toBe(true)
    for (const no of ['', '08006', '08001', '40001', '40P01', '42501', '42883', '53300', '57014', '57P01', 'P0001', 'PGRST102', 'PGRST301', '2200', '220003', '23', 'x22003', 'ab123', null, undefined, 22003, {}]) {
      expect(code(no), String(no)).toBe(false)
    }
    // no code at all: a network error, a timeout, an HTTP 5xx with a body that isn't PostgREST's
    expect(isDataRefusal(new Error('TypeError: fetch failed'))).toBe(false)
    expect(isDataRefusal(null)).toBe(false)
    expect(isDataRefusal('23514')).toBe(false)
  })

  it('a refusal of the data (class 23, class 22) is stored as "could not be read", whichever of them it is', async () => {
    for (const rejectCode of ['23514', '23505', '22003', '22P02']) {
      const s = setup({ list: [A_ITEM], pdfs: { [A_ITEM.name]: A }, rejectRead: `${rejectCode} refused`, rejectCode })
      const out = await s.run()
      expect(s.db.warnings[0].warning, rejectCode).toMatchObject({ parse_ok: false, parse_error: `database rejected: ${rejectCode} refused` })
      expect(out.pdfs[0].outcome, rejectCode).toBe('unreadable')
    }
  })

  it('anything else is not stored as unreadable: nothing is stored, the run counts as failed, and the next run tries it again', async () => {
    // no code (a network error, a timeout, a dropped connection, an HTTP 5xx), and codes that are not class 22 or 23
    for (const storeCode of [undefined, '', '08006', '40001', '53300', '57014', '57P01', 'P0001', 'PGRST301']) {
      const config: Parameters<typeof setup>[0] = { list: [A_ITEM], pdfs: { [A_ITEM.name]: A }, storeError: 'connection dropped', storeCode }
      const s = setup(config)
      const out = await s.run()
      const label = String(storeCode)
      // one attempt, and no "could not be read" row
      expect(s.deps.store, label).toHaveBeenCalledTimes(1)
      expect(s.db.warnings, label).toEqual([])
      expect(s.db.seen.size, label).toBe(0)
      expect(out.pdfs[0], label).toMatchObject({ outcome: 'store_failed', stored: false, reason: 'connection dropped', tries: 1 })
      expect(out.pdfs[0].summary?.messageId, label).toBe('LEWM-14-11-2026-1600-09')
      expect(out.result, label).toBe('failed')
      expect(out.errors.join(), label).toMatch(/LEWM-14-11-2026-1600-09: storing it failed \(connection dropped\), will try again/)
      expect(out.errors.join(), label).not.toMatch(/database rejected|could not be read/)
      expect(s.db.state?.failures, label).toBe(1)
      expect(s.logs.some((l) => l.storeFailures === 1 && l.reason === 'connection dropped'), label).toBe(true)
      // the next run reads the PDF again and, with the database back, stores it as a readable warning
      delete config.storeError
      s.advance(30 * MIN)
      const next = await s.run()
      expect(s.pdfCalls, label).toHaveLength(2)
      expect(s.db.warnings[0].warning, label).toMatchObject({ parse_ok: true, message_id: 'LEWM-14-11-2026-1600-09' })
      expect(next.result, label).toBe('ok')
      expect(s.db.state?.failures, label).toBe(0)
      expect(s.db.state?.memo).toMatchObject({ storeFailures: {} })
    }
  })

  it('the list is read in full while a PDF waits to be stored, so a 304 can’t hide it', async () => {
    const config: Parameters<typeof setup>[0] = {
      list: [A_ITEM],
      pdfs: { [A_ITEM.name]: A },
      storeError: 'timeout',
      listReply: { status: 200, headers: { etag: '"v1"', lastModified: null, location: null }, body: listPage([A_ITEM]), tooBig: false },
    }
    const s = setup(config)
    await s.run()
    expect(s.db.state?.memo).toMatchObject({ storeFailures: { [pdfUrl(A_ITEM.name)]: 1 } })
    s.advance(30 * MIN)
    await s.run()
    const listCalls = s.calls.filter((c) => c.url === LIST.url)
    expect(listCalls).toHaveLength(2)
    expect(listCalls[1].headers['If-None-Match']).toBeUndefined()
    expect(s.db.state?.memo).toMatchObject({ storeFailures: { [pdfUrl(A_ITEM.name)]: 2 } })
  })

  it('a PDF that keeps failing that way does not block the others in the same run, newer or older', async () => {
    const MIDDLE: Item = { name: 'Landslide_Early_Warning_mid.pdf', date: '2026-11-14', time: '20:00' }
    const pdfs = { [A_ITEM.name]: A, [MIDDLE.name]: A, [NEWER_ITEM.name]: NEWER }
    // the one in the middle can't be stored; the newest and the oldest can
    const s = setup({ list: [NEWER_ITEM, MIDDLE, A_ITEM], pdfs, storeError: 'timeout', failLink: MIDDLE.name })
    const out = await s.run()
    expect(out.pdfs.map((p) => p.outcome)).toEqual(['read', 'store_failed', 'read'])
    expect(s.db.warnings.map((w) => w.warning.message_id).sort()).toEqual(['LEWM-14-11-2026-1600-09', 'LEWM-15-11-2026-0900-10'])
    expect(out.stored).toBe(2)
    expect(out.result).toBe('failed')
    expect(out.leftForLater).toBe(0)
    // and the newest one that failed doesn't hide the older ones either
    const first = setup({ list: [NEWER_ITEM, A_ITEM], pdfs, storeError: 'timeout', failLink: NEWER_ITEM.name })
    const again = await first.run()
    expect(again.pdfs.map((p) => p.outcome)).toEqual(['store_failed', 'read'])
    expect(first.db.warnings.map((w) => w.warning.message_id)).toEqual(['LEWM-14-11-2026-1600-09'])
    // next time round only the failed one is looked at again: the others are stored, so seen
    first.advance(30 * MIN)
    await first.run()
    expect(first.pdfCalls.map((u) => u.split('/').pop())).toEqual([NEWER_ITEM.name, A_ITEM.name, NEWER_ITEM.name])
  })

  it('a database that is down for every PDF: each is tried once per run, none is stored as unreadable, and the run still ends', async () => {
    const s = setup({ list: [NEWER_ITEM, A_ITEM], pdfs: { [A_ITEM.name]: A, [NEWER_ITEM.name]: NEWER }, storeError: 'fetch failed' })
    const out = await s.run()
    expect(out.pdfs.map((p) => p.outcome)).toEqual(['store_failed', 'store_failed'])
    expect(s.deps.store).toHaveBeenCalledTimes(2)
    expect(s.db.warnings).toEqual([])
    expect(out.result).toBe('failed')
  })

  it('a dry run never stores, so it has no storing failure to report', async () => {
    const s = setup({ list: [A_ITEM], pdfs: { [A_ITEM.name]: A }, storeError: 'timeout' })
    const out = await s.run({ dryRun: true })
    expect(out.pdfs[0].outcome).toBe('read')
    expect(s.deps.store).not.toHaveBeenCalled()
  })

  it('cut() keeps to a length in characters, never splits one, and drops what Postgres can’t store', () => {
    expect(cut('abc', 2)).toBe('ab')
    expect(cut('😀😀😀', 2)).toBe('😀😀')
    expect(cut(`a${String.fromCharCode(0)}b\uD800c`, 10)).toBe('abc')
  })
})

describe('PDF links', () => {
  it('only links on DMC’s own site, in its PDF folder, are looked at: the host every real sample used', () => {
    // all ten samples were relative links on the list page at https://www.dmc.gov.lk
    expect(new URL(LIST.url).host).toBe('www.dmc.gov.lk')
    for (const ok of [pdfUrl('LEWM_14-11-2026_16_00__1794660156.pdf'), 'https://dmc.gov.lk/images/dmcreports/a.pdf']) expect(isPdfLink(ok), ok).toBe(true)
    for (const bad of [
      'http://www.dmc.gov.lk/images/dmcreports/a.pdf',
      'https://evil.example/images/dmcreports/a.pdf',
      'https://www.dmc.gov.lk.evil.example/images/dmcreports/a.pdf',
      'https://wwwXdmc.gov.lk/images/dmcreports/a.pdf',
      'https://www.dmc.gov.lk/images/other/a.pdf',
      'https://www.dmc.gov.lk/IMAGES/dmcreports/a.pdf',
    ]) {
      expect(isPdfLink(bad), bad).toBe(false)
    }
    expect(PDF_URL_RULE.source).toContain('dmcreports')
  })
})

describe('a PDF that cannot be downloaded', () => {
  it('is tried again on the next runs, and after 3 tries is stored as "could not be read"', async () => {
    const s = setup({ list: [A_ITEM], pdfs: { [A_ITEM.name]: { status: 500 } } })
    const first = await s.run()
    expect(first.pdfs[0]).toMatchObject({ outcome: 'download_failed', stored: false, reason: 'HTTP 500', tries: 1 })
    expect(first.result).toBe('failed')
    expect(s.db.warnings).toEqual([])
    expect(s.db.state).toMatchObject({ failures: 1 })
    expect(s.db.state?.memo).toMatchObject({ tries: { [pdfUrl(A_ITEM.name)]: 1 } })

    s.advance(30 * MIN)
    expect((await s.run()).pdfs[0]).toMatchObject({ outcome: 'download_failed', tries: 2 })

    s.advance(30 * MIN)
    const third = await s.run()
    expect(DOWNLOAD_ATTEMPTS).toBe(3)
    expect(third.pdfs[0]).toMatchObject({ outcome: 'unreadable', stored: true })
    expect(s.db.warnings[0].warning).toMatchObject({ parse_ok: false, message_id: null, parse_error: 'could not be downloaded after 3 tries: HTTP 500' })
    expect(s.db.state?.memo).toMatchObject({ tries: {} })

    // and then it is left alone
    s.advance(60 * MIN)
    await s.run()
    expect(s.pdfCalls).toHaveLength(3)
  })

  it('a download that works on a later try is stored normally and its tries forgotten', async () => {
    const s = setup({ list: [A_ITEM], pdfs: { [A_ITEM.name]: { status: 503 } } })
    await s.run()
    s.setPdf(A_ITEM.name, A)
    s.advance(30 * MIN)
    const out = await s.run()
    expect(out).toMatchObject({ result: 'ok', stored: 1 })
    expect(s.db.state?.memo).toMatchObject({ tries: {} })
    expect(s.db.state?.failures).toBe(0)
  })

  it('asks the list again, with no caching headers, while a PDF is waiting for another try', async () => {
    const s = setup({
      list: [A_ITEM],
      pdfs: { [A_ITEM.name]: { status: 500 } },
      listReply: { status: 200, headers: { etag: '"v1"', lastModified: null, location: null }, body: listPage([A_ITEM]), tooBig: false },
    })
    await s.run()
    s.advance(30 * MIN)
    await s.run()
    const listCalls = s.calls.filter((c) => c.url === LIST.url)
    expect(listCalls[1].headers['If-None-Match']).toBeUndefined()
  })

  it('an answer that is not a PDF, a PDF that is cut off, or a redirect to another site are download failures', async () => {
    for (const [pdf, why] of [
      ['html', 'the answer is not a PDF'],
      ['cut', 'the PDF is cut off'],
      [{ redirect: 'https://evil.example/x.pdf' }, 'redirected to another site'],
    ] as [Pdf, string][]) {
      const s = setup({ list: [A_ITEM], pdfs: { [A_ITEM.name]: pdf } })
      const out = await s.run()
      expect(out.pdfs[0], why).toMatchObject({ outcome: 'download_failed', reason: why })
      expect(s.db.warnings).toEqual([])
    }
  })

  it('a redirect within DMC is followed', async () => {
    const s = setup({ list: [A_ITEM], pdfs: { [A_ITEM.name]: { redirect: `${PDF_DIR}other.pdf` }, 'other.pdf': A } })
    const out = await s.run()
    expect(out.stored).toBe(1)
    expect(s.pdfCalls.map((u) => u.split('/').pop())).toEqual([A_ITEM.name, 'other.pdf'])
  })

  it('never downloads from anywhere but DMC’s PDF folder, whatever the list says', async () => {
    for (const href of ['https://evil.example/images/dmcreports/a.pdf', '/files/a.pdf', 'http://www.dmc.gov.lk:8080/images/dmcreports/a.pdf']) {
      const s = setup({ list: [{ ...A_ITEM, href }], pdfs: { 'a.pdf': A } })
      const out = await s.run()
      expect(out.list.status, href).toBe('failed')
      expect(s.pdfCalls, href).toEqual([])
    }
  })
})

describe('the newest warning', () => {
  it('when the newest could not be read, the older one that is still valid is NOT reported as current', async () => {
    const s = setup({ list: [A_ITEM], pdfs: { [A_ITEM.name]: A } })
    await s.run()
    expect(current(s.db, NOW)).toMatchObject({ found: true, message_id: 'LEWM-14-11-2026-1600-09', parse_ok: true, valid: true })
    expect(current(s.db, NOW)).toMatchObject({ areas: expect.arrayContaining([]) })

    // 25 minutes later (still inside the older warning's 24 hours) DMC lists a newer one whose layout
    // can't be read
    s.advance(25 * MIN)
    s.setList([NEWER_ITEM, A_ITEM])
    s.setPdf(NEWER_ITEM.name, BROKEN)
    const out = await s.run()
    expect(out.pdfs).toMatchObject([{ outcome: 'unreadable', stored: true }])
    // the older warning is still in the table and still inside its 24 hours...
    expect(s.db.warnings.find((w) => w.warning.message_id === 'LEWM-14-11-2026-1600-09')).toBeDefined()
    expect(Date.parse('2026-11-15T10:30:00Z')).toBeGreaterThan(s.clock())
    // ...but what the app is told is about the newest one
    expect(current(s.db, s.clock())).toEqual({ found: true, message_id: null, parse_ok: false, valid: false, areas: [] })
  })

  it('stores the failed one as listed after the older one, so it is the newest (the order landslide_current uses)', async () => {
    const s = setup({
      list: [NEWER_ITEM, A_ITEM],
      pdfs: { [A_ITEM.name]: A, [NEWER_ITEM.name]: BROKEN },
    })
    await s.run()
    const by = Object.fromEntries(s.db.warnings.map((w) => [w.warning.pdf_url, w.warning.listed_at]))
    expect(by[pdfUrl(NEWER_ITEM.name)] > by[pdfUrl(A_ITEM.name)]).toBe(true)
  })

  it('an older unreadable PDF does not hide a newer readable one', async () => {
    const s = setup({ list: [NEWER_ITEM, A_ITEM], pdfs: { [A_ITEM.name]: BROKEN, [NEWER_ITEM.name]: NEWER } })
    await s.run()
    expect(current(s.db, NOW)).toMatchObject({ message_id: 'LEWM-15-11-2026-0900-10', parse_ok: true, valid: true })
  })

  it('says it is no longer valid once its 24 hours are over, and says nothing when nothing is stored', async () => {
    const s = setup({ list: [A_ITEM], pdfs: { [A_ITEM.name]: A } })
    expect(current(s.db, NOW)).toEqual({ found: false })
    await s.run()
    expect(current(s.db, Date.parse('2026-11-15T10:31:00Z'))).toMatchObject({ parse_ok: true, valid: false })
  })
})

describe('a dry run', () => {
  it('parses everything and returns what it found, with the names matched, and writes nothing', async () => {
    const s = setup({ list: [NEWER_ITEM, A_ITEM], pdfs: { [A_ITEM.name]: ODD_NAME, [NEWER_ITEM.name]: BROKEN } })
    const out = await s.run({ dryRun: true })
    expect(out.result).toBe('dry_run')
    expect(out.stored).toBe(0)
    expect(s.db.warnings).toEqual([])
    expect(s.db.seen.size).toBe(0)
    expect(s.db.stateWrites).toBe(0)
    const read = out.pdfs.find((p) => p.outcome === 'read')!
    expect(read).toMatchObject({ stored: false, summary: { messageId: 'LEWM-14-11-2026-1600-09', matched: 16, unmatched: 1 } })
    expect(read.summary?.areas.find((a) => a.name === 'Nowhereville')).toMatchObject({ code: null, note: 'no DS division of that name in Badulla' })
    expect(out.pdfs.find((p) => p.outcome === 'unreadable')).toMatchObject({ stored: false, reason: 'the table header is incomplete' })
  })

  it('shows PDFs a real run would skip as seen only when forced', async () => {
    const s = setup({ list: [A_ITEM], pdfs: { [A_ITEM.name]: A } })
    await s.run()
    expect((await s.run({ dryRun: true, force: true })).pdfs).toHaveLength(1)
    s.advance(30 * MIN)
    expect((await s.run({ dryRun: true })).pdfs).toEqual([])
  })

  it('does not count a download that fails as a try', async () => {
    const s = setup({ list: [A_ITEM], pdfs: { [A_ITEM.name]: { status: 500 } } })
    for (let i = 0; i < 4; i++) {
      s.advance(30 * MIN)
      expect((await s.run({ dryRun: true })).pdfs[0]).toMatchObject({ outcome: 'download_failed', tries: 1 })
    }
    expect(s.db.warnings).toEqual([])
  })
})

describe('the run’s time', () => {
  it('stops starting PDFs once it is out of time, and leaves the rest for the next run', async () => {
    const items: Item[] = [1, 2, 3, 4].map((i) => ({ name: `w${i}.pdf`, date: '2026-11-14', time: `1${i}:00` }))
    const s = setup({ list: items, pdfs: Object.fromEntries(items.map((i) => [i.name, NOT_A_WARNING])), pdfMs: 25_000 })
    const out = await s.run()
    expect(out.pdfs.length).toBeLessThan(4)
    expect(out.leftForLater).toBe(4 - out.pdfs.length)
    expect(out.leftForLater).toBeGreaterThan(0)
    // the ones left are not recorded, so the next run takes them
    s.advance(30 * MIN)
    const next = await s.run()
    expect(next.pdfs.length).toBeGreaterThan(0)
  })
})

describe('the pieces', () => {
  it('pdfShape: a PDF starts with %PDF- and ends with %%EOF', () => {
    const bytes = (text: string) => new TextEncoder().encode(text)
    expect(pdfShape(bytes('%PDF-1.7\n' + 'x'.repeat(100) + '\n%%EOF\n'))).toBe('ok')
    expect(pdfShape(bytes('%PDF-1.7\n' + 'x'.repeat(5000)))).toBe('cut_off')
    expect(pdfShape(bytes('<html>' + 'x'.repeat(100)))).toBe('not_pdf')
    expect(pdfShape(bytes('%PDF-'))).toBe('not_pdf')
  })

  it('readCappedBytes: gives the bytes, or gives up past the limit', async () => {
    const stream = (parts: number[]) => new ReadableStream<Uint8Array>({ start: (c) => (parts.forEach((n) => c.enqueue(new Uint8Array(n).fill(7))), c.close()) })
    expect((await readCappedBytes(stream([3, 4]), 10)).bytes).toEqual(new Uint8Array(7).fill(7))
    expect(await readCappedBytes(stream([6, 6]), 10)).toMatchObject({ tooBig: true })
    expect(await readCappedBytes(null, 10)).toMatchObject({ tooBig: false })
  })

  it('entriesOf: newest first, one per link, DMC’s own PDF folder only, a future time counts as now', () => {
    const page = listPage([
      { name: 'a.pdf', date: '2026-11-13', time: '10:00' },
      { name: 'b.pdf', date: '2026-11-14', time: '10:00' },
      { name: 'b.pdf', date: '2026-11-14', time: '10:00' },
      { name: 'c.pdf', date: '2026-12-31', time: '10:00' },
      { name: 'x.pdf', date: '2026-11-14', time: '10:00', href: 'https://evil.example/images/dmcreports/x.pdf' },
    ])
    const { entries, rows, ignored } = entriesOf(page, LIST.url, NOW, 10)
    expect(entries.map((e) => e.url.split('/').pop())).toEqual(['c.pdf', 'b.pdf', 'a.pdf'])
    expect(entries[0].listedAt).toBe(NOW)
    expect(rows).toBe(5)
    expect(ignored).toBe(1)
    expect(() => entriesOf('<p>nothing</p>', LIST.url, NOW, 5)).toThrow(/no rows found/)
  })

  it('keeps to the limits the database checks', () => {
    const migration = readFileSync(join(ROOT, 'supabase', 'migrations', '0011_landslide_areas.sql'), 'utf8')
    expect(migration).toContain(`char_length(ds_name) between 1 and ${MAX_DS_NAME}`)
    expect(migration).toContain(`char_length(district_name) between 1 and ${MAX_DISTRICT_NAME}`)
    expect(PDF_MAX_BYTES).toBe(MAX_PDF_BYTES)
  })
})

describe('the function’s wiring (index.ts)', () => {
  const index = readFileSync(join(FUNCTION, 'index.ts'), 'utf8')

  it('checks its own secret header, from the secret named for it, and only answers POST', () => {
    expect(index).toContain("req.headers.get('x-landslide-secret')")
    expect(index).toContain("Deno.env.get('LANDSLIDE_SECRET')")
    expect(index).toContain("req.method !== 'POST'")
    expect(index.indexOf('isAuthorised')).toBeLessThan(index.indexOf("req.method !== 'POST'"))
  })

  it('has the dry run, force and pdfs switches', () => {
    expect(index).toContain("params.get('dry_run') === 'true'")
    expect(index).toContain("params.get('force') === 'true'")
    expect(index).toContain("params.get('pdfs')")
  })

  it('hands the database error on with its Postgres code, which is how logic.ts tells a refused warning from a failed call', () => {
    expect(index).toMatch(/throw Object\.assign\(new Error\([^\n]*\), \{ code: error\.code \}\)/)
  })

  it('writes through the one database function, and only the tables it needs', () => {
    expect(index).toContain("supabase.rpc('store_landslide_warning', { p_warning: warning, p_areas: areas })")
    expect(index).not.toMatch(/from\('landslide_(warnings|areas)'\)\s*\.(insert|upsert|update|delete)/)
    expect(index).toContain("from('landslide_seen_pdfs').upsert")
    expect(index).toContain("from('news_source_state')")
  })

  it('follows no redirect by itself, and logs only short facts, never the secret or the key', () => {
    expect(index.match(/redirect: 'manual'/g)).toHaveLength(2)
    const logging = index.match(/console\.\w+\([^\n]*\)/g) ?? []
    expect(logging).toEqual(['console.log(JSON.stringify(entry))'])
    expect(index).not.toMatch(/console\.\w+\([^)]*(SECRET|SERVICE_ROLE|secret)/)
  })

  it('is set up like the other functions: its own import map with the same unpdf as the tests, and no JWT check', () => {
    const deno = JSON.parse(readFileSync(join(FUNCTION, 'deno.json'), 'utf8'))
    expect(deno.imports['@supabase/supabase-js']).toBe('npm:@supabase/supabase-js@2')
    expect(deno.imports.unpdf).toBe(`npm:unpdf@${JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).devDependencies.unpdf}`)
    expect(readFileSync(join(ROOT, 'supabase', 'config.toml'), 'utf8')).toMatch(/\[functions\.landslide-refresh\]\s+verify_jwt = false/)
  })

  it('reuses news-refresh’s polite fetching and changes none of its behaviour', () => {
    const logic = readFileSync(join(FUNCTION, 'logic.ts'), 'utf8')
    expect(logic).toContain("from '../news-refresh/logic.ts'")
    expect(logic).toMatch(/\brequest\(deps, LIST\.url/)
    const news = readFileSync(join(ROOT, 'supabase', 'functions', 'news-refresh', 'logic.ts'), 'utf8')
    expect(news).toContain('export async function request(')
    expect(news).toContain('export const baseHeaders')
  })
})
