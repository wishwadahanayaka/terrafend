// The parts of the landslide-refresh function that need no network or database, so tests can run them
// with stand-ins: reading DMC's list of landslide warning PDFs, deciding which PDFs are new, reading
// each one (lewm.ts), matching its names (names.ts) and handing the result over to be stored. index.ts
// only wires this to fetch(), unpdf and the database.
//
// It reads DMC the same polite way news-refresh does and reuses its pieces (the User-Agent, the
// robots.txt reading, the redirect rules, the timeouts and the run deadline, the backoff).
// No Deno calls, so it loads in Deno and in the tests.

import {
  baseHeaders,
  describeError,
  emptyState,
  FETCH_TIMEOUT_MS,
  isAuthorised,
  isDue,
  jsonResponse,
  MAX_REDIRECTS,
  MIN_REQUEST_MS,
  normaliseUrl,
  parseDate,
  parseDmcList,
  request,
  robotsVerdict,
  ROBOTS_MAX_AGE_MS,
  RUN_BUDGET_MS,
  RUN_DEADLINE_MS,
  USER_AGENT,
  type Deps as NewsDeps,
  type Memo,
  type SourceState,
} from '../news-refresh/logic.ts'
import { SOURCES, type Source } from '../news-refresh/sources.ts'
import { readLewm, type Level, type PdfPage } from './lewm.ts'
import { indexOf, matchNames, type Gazetteer, type Matched } from './names.ts'

export { isAuthorised, jsonResponse, USER_AGENT }
export type { SourceState }

const MINUTE = 60_000
const DAY = 24 * 60 * MINUTE

// DMC's list of landslide warnings (Itemid 276) is the one news-refresh already reads as dmc_landslide:
// the same address, with this function's own row in news_source_state and its own interval
const dmcLandslide = SOURCES.find((s) => s.id === 'dmc_landslide')
if (!dmcLandslide) throw new Error('news-refresh/sources.ts has no dmc_landslide source')

export const STATE_ID = 'landslide_list'
// The cron job calls every 30 minutes, so 25 (less the usual minute of slack) makes every call due
export const LIST: Source = { ...dmcLandslide, id: STATE_ID, everyMin: 25, channel: undefined, filter: 'none', enabled: true }

// How many of the list's newest entries are looked at in a run. A warning comes out about once a day
// (more in a storm), so this covers a long gap in the runs.
export const NEWEST_ENTRIES = 5
export const MAX_NEWEST_ENTRIES = 10
// Entries listed longer ago than this are ignored. The cleanup job removes warnings after 14 days, so
// this stays under that, or a warning could be stored again the day after it was removed.
export const MAX_LIST_AGE_MS = 13 * DAY
// Where DMC keeps these PDFs. A link anywhere else is not downloaded.
export const PDF_DIR = '/images/dmcreports/'
// The only links stored: https, DMC's own site (dmc.gov.lk or www.dmc.gov.lk, the same own-domain
// rule as news-refresh; every real sample was on www.dmc.gov.lk), in that folder. Migration 0011 has
// the same rule on pdf_url in landslide_warnings and landslide_seen_pdfs.
export const PDF_URL_RULE = /^https:\/\/(www\.)?dmc\.gov\.lk\/images\/dmcreports\//
export const MAX_PDF_URL = 2048
export const PDF_MAX_BYTES = 3_000_000
export const PDF_TIMEOUT_MS = 20_000
// A pause before each request, and more if robots.txt asks for it (up to MAX_PAUSE_MS)
export const PDF_PAUSE_MS = 1_000
export const MAX_PAUSE_MS = 20_000
// A PDF that can't be downloaded is tried again on the next runs, and after this many tries it is
// stored as a warning that could not be read, so the app can say so
export const DOWNLOAD_ATTEMPTS = 3
// Limits the database's checks allow (see 0011), so a bad name can't make every run fail
export const MAX_DISTRICT_NAME = 60
export const MAX_DS_NAME = 80
export const MAX_AREAS = 600
export const MAX_PARSE_ERROR = 300
export const MAX_MATCH_NOTE = 200
// The patterns of 0011's checks, word for word
export const MESSAGE_ID_RULE = /^LEWM-[0-9]{2}-[0-9]{2}-[0-9]{4}-[0-9]{4}-[0-9]{1,3}$/
export const AREA_CODE_RULE = /^LK[0-9]{4}$/
export const DISTRICT_CODE_RULE = /^LK[0-9]{2}$/

// ---- What goes to the database (the columns of landslide_warnings and landslide_areas) ----

export type WarningRow = {
  pdf_url: string
  message_id: string | null
  update_number: number | null
  listed_at: string
  issued_at: string | null
  valid_from: string | null
  valid_to: string | null
  parse_ok: boolean
  parse_error: string | null
}

export type AreaRow = {
  level: Level
  district_name: string
  ds_name: string
  area_code: string | null
  district_code: string | null
  shift: number
  added: boolean
  match_note: string | null
}

export type SeenRow = { pdf_url: string; outcome: 'not_lewm' | 'duplicate'; note: string }

// ---- Dependencies ----

export type BytesResult = {
  status: number
  location: string | null
  // The body of a 200 that fit under PDF_MAX_BYTES. null otherwise.
  bytes: Uint8Array | null
  tooBig: boolean
}

export type Deps = {
  now: () => number
  sleep: (ms: number) => Promise<void>
  // For robots.txt and the list: text, at most 1 MB, no redirects followed, throws on a timeout
  fetch: NewsDeps['fetch']
  // For a PDF: the same, but bytes and up to PDF_MAX_BYTES
  fetchPdf: (url: string, init: { headers: Record<string, string>; timeoutMs: number }) => Promise<BytesResult>
  // The text of the PDF with positions. Throws if it can't be read.
  readPdf: (bytes: Uint8Array) => Promise<PdfPage[]>
  // The one row of news_source_state for this function, or null
  readState: () => Promise<SourceState | null>
  writeState: (state: SourceState) => Promise<void>
  // Which of these links are already stored as a warning, or were looked at and skipped
  readSeen: (urls: string[]) => Promise<Set<string>>
  // One transaction: the warning and all its areas, or nothing. Gives the new id, or null if the
  // warning was already stored (this address, or the same message from another one).
  store: (warning: WarningRow, areas: AreaRow[]) => Promise<number | null>
  markSeen: (rows: SeenRow[]) => Promise<void>
  gazetteer: Gazetteer
  log: (entry: Record<string, unknown>) => void
}

export type Options = {
  force?: boolean
  dryRun?: boolean
  // How many of the newest list entries to look at (default NEWEST_ENTRIES, at most MAX_NEWEST_ENTRIES)
  pdfs?: number
}

// ---- What a run reports ----

export type Summary = {
  messageId: string
  update: number
  issuedAt: string
  validFrom: string
  validTo: string
  // Names matched to a boundary, and names that were not (with why): the two add up to the table's entries
  matched: number
  unmatched: number
  areas: { level: Level; district: string; name: string; code: string | null; shift: number; added: boolean; note: string | null }[]
}

export type PdfReport = {
  url: string
  listedAt: string
  // read: a readable warning (stored unless this is a dry run). unreadable: stored as a warning that
  // could not be read. duplicate: the same message was already stored. not_lewm: looked at and
  // skipped. download_failed: not stored yet, tried again next run. store_failed: the database could not
  // be reached or failed (not a refusal of the data), nothing stored, tried again next run.
  // robots_disallow: not downloaded.
  outcome: 'read' | 'unreadable' | 'duplicate' | 'not_lewm' | 'download_failed' | 'store_failed' | 'robots_disallow'
  stored: boolean
  reason?: string
  tries?: number
  summary?: Summary
}

export type Outcome = {
  result: 'ok' | 'dry_run' | 'failed'
  startedAt: string
  list: {
    status: 'ok' | 'not_modified' | 'not_due' | 'failed' | 'robots_disallow' | 'robots_unknown'
    // Rows in DMC's list, and how many of the newest were looked at that are new to us
    found: number
    looked: number
    error?: string
  }
  pdfs: PdfReport[]
  // Entries left for the next run because this one ran out of time
  leftForLater: number
  stored: number
  errors: string[]
}

// tries: failed downloads per link. storeFailures: links read fine whose storing failed for a reason that
// is not the data's (how many times in a row), kept so the list is read in full until they are stored.
type LandslideMemo = Memo & { pdfAllowed?: boolean; tries?: Record<string, number>; storeFailures?: Record<string, number> }

// ---- PDFs ----

// The text of a PDF as one string, to look for the title
export function pagesText(pages: PdfPage[]): string {
  return pages.map((p) => p.items.map((i) => i.str).join(' ')).join('\n')
}

// A landslide warning says "Landslide Early Warning" and carries a "LEWM-..." message ID
const LEWM_MARK = /LEWM|Landslide\s+Early\s+Warning/i

// Only a PDF with readable text and neither mark in it is "not a warning". One with no text at all (a
// scan), or with the marks but a layout the reader can't handle, is a warning that could not be read:
// skipping a real warning silently would be worse than saying it couldn't be read.
export function isNotLewm(text: string): boolean {
  return text.trim() !== '' && !LEWM_MARK.test(text)
}

// A PDF starts with %PDF- and ends with %%EOF. A download that was cut off, or an error page that came
// back with status 200, fails this and is tried again.
export function pdfShape(bytes: Uint8Array): 'ok' | 'not_pdf' | 'cut_off' {
  const text = (from: number, to: number) => String.fromCharCode(...bytes.subarray(from, to))
  if (bytes.length < 16 || text(0, 5) !== '%PDF-') return 'not_pdf'
  return text(Math.max(0, bytes.length - 1024), bytes.length).includes('%%EOF') ? 'ok' : 'cut_off'
}

// Reads a response body as bytes, giving up once it passes `max`
export async function readCappedBytes(body: ReadableStream<Uint8Array> | null, max: number): Promise<{ bytes: Uint8Array; tooBig: boolean }> {
  if (!body) return { bytes: new Uint8Array(0), tooBig: false }
  const reader = body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > max) {
      await reader.cancel()
      return { bytes: new Uint8Array(0), tooBig: true }
    }
    chunks.push(value)
  }
  const all = new Uint8Array(size)
  let at = 0
  for (const chunk of chunks) {
    all.set(chunk, at)
    at += chunk.byteLength
  }
  return { bytes: all, tooBig: false }
}

const REDIRECTS = new Set([301, 302, 303, 307, 308])

// Like request() in news-refresh, for bytes: at most MAX_REDIRECTS redirects, only within DMC's own site
async function requestBytes(
  deps: Deps,
  url: string,
  headers: Record<string, string>,
  deadline: number,
): Promise<BytesResult & { finalUrl: string }> {
  let current = url
  for (let hop = 0; ; hop++) {
    const left = deadline - deps.now()
    if (left < MIN_REQUEST_MS) throw new Error('out of time for this run')
    const res = await deps.fetchPdf(current, { headers, timeoutMs: Math.min(PDF_TIMEOUT_MS, left) })
    if (!REDIRECTS.has(res.status)) return { ...res, finalUrl: current }
    if (hop >= MAX_REDIRECTS) throw new Error('too many redirects')
    const next = res.location ? normaliseUrl(res.location, current, LIST.ownDomains) : null
    if (!next) throw new Error('redirected to another site')
    current = next
  }
}

// ---- Turning a reading into rows ----

const iso = (ms: number) => new Date(ms).toISOString()

// The rows for landslide_areas: every name, matched or not, as printed
export function areaRows(matched: Matched): AreaRow[] {
  const rows: AreaRow[] = matched.areas.map((a) => ({
    level: a.level,
    district_name: a.districtName,
    ds_name: a.written,
    area_code: a.code,
    district_code: a.district,
    shift: a.shift,
    added: a.added,
    match_note: null,
  }))
  for (const u of matched.unmatched) {
    rows.push({
      level: u.level,
      district_name: u.district,
      ds_name: u.written,
      area_code: null,
      district_code: u.districtCode,
      shift: u.shift,
      added: u.added,
      match_note: u.why.slice(0, 200),
    })
  }
  return rows
}

// ---- The database's rules, checked here first ----
// So a row 0011 would refuse is stored as "could not be read" with a reason, instead of failing and
// being downloaded again on every run.

// Characters, as Postgres counts them (a JS string's length counts some characters twice)
const chars = (s: string) => Array.from(s).length
// Text Postgres can't store: a NUL, or half of a surrogate pair
const NUL = String.fromCharCode(0)
const HALF_PAIR = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/
const textOk = (s: string, min: number, max: number) => !s.includes(NUL) && !HALF_PAIR.test(s) && chars(s) >= min && chars(s) <= max

// Cuts text to `max` characters without splitting one, and drops what Postgres can't store
export function cut(text: string, max: number): string {
  return Array.from(text.split(NUL).join(''))
    .filter((c) => !/^[\uD800-\uDFFF]$/.test(c))
    .slice(0, max)
    .join('')
}

// Whether a database error means the DATA itself was refused: a Postgres error code of class 22 (data
// exception: a value out of range, a bad timestamp...) or class 23 (integrity constraint violation:
// a check, a unique key...). Anything else (no code, a network error, a timeout, a dropped connection,
// an HTTP 5xx, PostgREST's own PGRST codes, a lock or a shutdown) says nothing about the warning, so
// it is not stored as unreadable: it is tried again on the next run.
export function isDataRefusal(err: unknown): boolean {
  const code = (err as { code?: unknown } | null)?.code
  return typeof code === 'string' && /^(22|23)[0-9A-Z]{3}$/.test(code)
}

export function isPdfLink(url: string): boolean {
  return url.length <= MAX_PDF_URL && PDF_URL_RULE.test(url)
}

const isTime = (s: string | null): s is string => s !== null && Number.isFinite(Date.parse(s))

// What landslide_warnings would refuse in this row, or null
export function warningProblem(w: WarningRow): string | null {
  if (!isPdfLink(w.pdf_url)) return 'the PDF link is not on DMC’s site'
  if (!isTime(w.listed_at)) return 'the listed time could not be read'
  if (!w.parse_ok) {
    if (w.parse_error === null || !textOk(w.parse_error, 1, MAX_PARSE_ERROR)) return 'the reason is empty or too long'
    if (w.message_id !== null || w.update_number !== null || w.issued_at !== null || w.valid_from !== null || w.valid_to !== null) {
      return 'a warning that could not be read has data'
    }
    return null
  }
  if (w.message_id === null || !MESSAGE_ID_RULE.test(w.message_id)) return `the message ID is not in the usual form: "${cut(w.message_id ?? '', 40)}"`
  if (w.update_number === null || !Number.isInteger(w.update_number) || w.update_number < 0 || w.update_number > 999) {
    return `the update number is out of range: ${w.update_number}`
  }
  if (!isTime(w.issued_at) || !isTime(w.valid_from) || !isTime(w.valid_to)) return 'a time in the message could not be read'
  if (Date.parse(w.valid_to) <= Date.parse(w.valid_from)) return 'the validity period ends before it starts'
  if (w.parse_error !== null) return 'a read warning has a reason'
  return null
}

// What landslide_areas would refuse in these rows, or null. One division twice in a warning is
// refused too (0011's one-per-division index).
export function areaProblem(rows: AreaRow[]): string | null {
  if (rows.length > MAX_AREAS) return `${rows.length} names in one warning (more than ${MAX_AREAS})`
  const codes = new Set<string>()
  for (const r of rows) {
    const name = `"${cut(r.ds_name, 40)}"`
    if (!textOk(r.ds_name, 1, MAX_DS_NAME) || !textOk(r.district_name, 1, MAX_DISTRICT_NAME)) return `a name is empty or longer than expected: ${name}`
    if (![1, 2, 3].includes(r.level)) return `${name} has level ${r.level}`
    if (!Number.isInteger(r.shift) || r.shift < -2 || r.shift > 2) return `${name} has a level change of ${r.shift}`
    if (r.district_code !== null && !DISTRICT_CODE_RULE.test(r.district_code)) return `${name} has an odd district code`
    if (r.match_note !== null && !textOk(r.match_note, 0, MAX_MATCH_NOTE)) return `${name} has a note that is too long`
    if (r.area_code === null) {
      if (r.match_note === null) return `${name} is not matched and has no reason`
      continue
    }
    if (!AREA_CODE_RULE.test(r.area_code)) return `${name} has an odd code`
    if (r.district_code === null || !r.area_code.startsWith(r.district_code)) return `${name} is not in its district`
    if (r.match_note !== null) return `${name} is matched but has a note`
    if (codes.has(r.area_code)) return `${r.area_code} (${name}) is named twice`
    codes.add(r.area_code)
  }
  return null
}

// ---- Choosing which entries to look at ----

export type Entry = { url: string; title: string; listedAt: number }

// DMC's rows as entries: the newest first, one per link, with a link on DMC's own site in the PDF
// folder. `ignored` counts rows left out because their link or time could not be read.
export function entriesOf(
  html: string,
  finalUrl: string,
  now: number,
  count: number,
): { entries: Entry[]; rows: number; ignored: number } {
  const rows = parseDmcList(html)
  if (rows.length === 0) throw new Error('no rows found: the page layout may have changed')
  const seen = new Set<string>()
  const usable: Entry[] = []
  let ignored = 0
  for (const row of rows) {
    const url = normaliseUrl(row.href, finalUrl, LIST.ownDomains)
    const at = parseDate(`${row.date} ${row.time}`)
    if (!url || at === null || !isPdfLink(url)) {
      ignored++
      continue
    }
    if (seen.has(url)) continue
    seen.add(url)
    // A time in the future (a wrong clock at DMC) counts as now
    usable.push({ url, title: row.title, listedAt: Math.min(at, now) })
  }
  if (usable.length === 0) throw new Error('no usable rows: the page layout may have changed')
  usable.sort((a, b) => b.listedAt - a.listedAt)
  const entries = usable.slice(0, Math.max(1, Math.min(count, MAX_NEWEST_ENTRIES))).filter((e) => now - e.listedAt <= MAX_LIST_AGE_MS)
  return { entries, rows: rows.length, ignored }
}

// ---- robots.txt ----

// What the site's robots.txt says about the list's address and about the PDFs' folder, read at most
// once a day. The PDF verdict is kept in the state's memo, so one read serves both.
type RobotsOutcome =
  | { allowed: boolean; pdfAllowed: boolean; delaySec: number; fresh: boolean }
  | { unreadable: string; status: number | null }

async function readRobots(deps: Deps, state: SourceState, now: number): Promise<RobotsOutcome> {
  const memo = state.memo as LandslideMemo
  const known = state.robots_ok !== null && state.robots_at !== null
  const stored = (): RobotsOutcome => ({
    allowed: state.robots_ok!,
    pdfAllowed: memo.pdfAllowed ?? true,
    delaySec: memo.robotsDelaySec ?? 0,
    fresh: false,
  })
  if (known && now - Date.parse(state.robots_at!) < ROBOTS_MAX_AGE_MS) return stored()

  const target = new URL(LIST.url)
  let file: { status: number; body: string } | { error: string }
  try {
    const { res } = await request(deps, `https://${target.host}/robots.txt`, LIST.ownDomains, baseHeaders(), {
      timeoutMs: FETCH_TIMEOUT_MS,
      deadline: now + RUN_DEADLINE_MS,
    })
    file = { status: res.status, body: res.body ?? '' }
  } catch (err) {
    file = { error: describeError(err) }
  }
  if ('error' in file || file.status >= 500 || file.status === 429) {
    // Keep the last answer. With none, a robots.txt that can't be reached is "not allowed for now"
    // (RFC 9309): nothing is asked, and it is tried again next run.
    if (known) return stored()
    return 'error' in file ? { unreadable: file.error, status: null } : { unreadable: `HTTP ${file.status}`, status: file.status }
  }
  // A missing robots.txt (4xx) allows everything, and so does DMC's homepage when it answers instead
  const body = file.status === 200 ? file.body : ''
  const list = robotsVerdict(body, target.pathname + target.search)
  const pdf = robotsVerdict(body, `${PDF_DIR}LEWM.pdf`)
  return { allowed: list.allowed, pdfAllowed: pdf.allowed, delaySec: Math.max(list.crawlDelaySec, pdf.crawlDelaySec), fresh: true }
}

// ---- One run ----

export async function refresh(deps: Deps, options: Options = {}): Promise<Outcome> {
  const startedAt = deps.now()
  const dry = !!options.dryRun
  const outcome: Outcome = {
    result: dry ? 'dry_run' : 'ok',
    startedAt: iso(startedAt),
    list: { status: 'ok', found: 0, looked: 0 },
    pdfs: [],
    leftForLater: 0,
    stored: 0,
    errors: [],
  }
  const failed = (message: string): Outcome => {
    deps.log({ result: 'failed', message })
    return { ...outcome, result: 'failed', errors: [...outcome.errors, message] }
  }

  let index
  try {
    index = indexOf(deps.gazetteer)
  } catch (err) {
    return failed(`the names list is invalid: ${describeError(err)}`)
  }

  let before: SourceState
  try {
    const row = await deps.readState()
    before = row ? { ...emptyState(STATE_ID), ...row, memo: row.memo ?? {} } : emptyState(STATE_ID)
  } catch (err) {
    // Without the state there is no way to keep to the site's interval, so nothing is asked
    return failed(`database read failed: ${describeError(err)}`)
  }
  const state: SourceState = { ...before, memo: { ...before.memo } }
  const memo = state.memo as LandslideMemo

  if (!options.force && !isDue(LIST, before, startedAt)) {
    outcome.list.status = 'not_due'
    deps.log({ result: outcome.result, list: outcome.list })
    return outcome
  }

  // A dry run changes nothing, not even the state
  const save = async () => {
    if (dry) return
    try {
      await deps.writeState(state)
    } catch (err) {
      outcome.errors.push(`writing the state failed: ${describeError(err)}`)
    }
  }
  const finish = async (): Promise<Outcome> => {
    await save()
    if (outcome.errors.length > 0 || outcome.list.status === 'failed' || outcome.list.status.startsWith('robots')) outcome.result = 'failed'
    deps.log({ result: outcome.result, list: outcome.list, pdfs: outcome.pdfs.map((p) => ({ outcome: p.outcome, stored: p.stored })), errors: outcome.errors })
    return outcome
  }

  // robots.txt
  const robots = await readRobots(deps, state, startedAt)
  if ('unreadable' in robots) {
    state.last_fetch_at = iso(startedAt)
    state.last_status = robots.status
    state.last_error = `robots.txt: ${robots.unreadable}`
    state.failures = before.failures + 1
    outcome.list = { ...outcome.list, status: 'robots_unknown', error: state.last_error }
    outcome.errors.push(state.last_error)
    return finish()
  }
  if (robots.fresh) {
    state.robots_ok = robots.allowed
    state.robots_at = iso(startedAt)
    memo.robotsDelaySec = robots.delaySec
    memo.pdfAllowed = robots.pdfAllowed
  }
  if (!robots.allowed) {
    state.last_fetch_at = iso(startedAt)
    state.last_error = 'robots.txt does not allow this address'
    outcome.list = { ...outcome.list, status: 'robots_disallow', error: state.last_error }
    outcome.errors.push(state.last_error)
    return finish()
  }

  // The list
  state.last_fetch_at = iso(startedAt)
  state.last_status = null
  const tries: Record<string, number> = { ...(memo.tries ?? {}) }
  const storeFailures: Record<string, number> = { ...(memo.storeFailures ?? {}) }
  let entries: Entry[] = []
  try {
    const headers = baseHeaders()
    // Not while a PDF is waiting for another try (a download, or storing it): a 304 would hide the
    // list it is in
    const waiting = Object.keys(tries).length > 0 || Object.keys(storeFailures).length > 0
    if (!dry && !waiting && before.etag) headers['If-None-Match'] = before.etag
    if (!dry && !waiting && before.last_modified) headers['If-Modified-Since'] = before.last_modified
    const { res, finalUrl } = await request(deps, LIST.url, LIST.ownDomains, headers, {
      timeoutMs: FETCH_TIMEOUT_MS,
      deadline: startedAt + RUN_DEADLINE_MS,
    })
    state.last_status = res.status
    if (res.status === 304) {
      outcome.list.status = 'not_modified'
    } else {
      if (res.status !== 200) throw new Error(`HTTP ${res.status}`)
      if (res.tooBig) throw new Error('answer over 1 MB')
      state.etag = res.headers.etag
      state.last_modified = res.headers.lastModified
      const found = entriesOf(res.body ?? '', finalUrl, startedAt, options.pdfs ?? NEWEST_ENTRIES)
      entries = found.entries
      outcome.list.found = found.rows
    }
  } catch (err) {
    // The old caching headers stay, so a page that failed to read is read in full next time
    state.etag = before.etag
    state.last_modified = before.last_modified
    state.failures = before.failures + 1
    state.last_error = describeError(err) || 'failed'
    outcome.list = { ...outcome.list, status: 'failed', error: state.last_error }
    return finish()
  }

  // Which are new. A forced run looks at all of them again.
  let seen = new Set<string>()
  if (!options.force && entries.length > 0) {
    try {
      seen = await deps.readSeen(entries.map((e) => e.url))
    } catch (err) {
      outcome.errors.push(`database read failed: ${describeError(err)}`)
      return finish()
    }
  }
  const todo = entries.filter((e) => !seen.has(e.url))
  outcome.list.looked = todo.length

  const pause = Math.max(PDF_PAUSE_MS, robots.delaySec * 1000)
  // Downloads that failed in this run, and the first reason
  const download: { failures: number; first: string | null } = { failures: 0, first: null }
  const pdfAllowed = robots.pdfAllowed

  // One PDF. Never throws: whatever goes wrong becomes its report.
  const handle = async (entry: Entry): Promise<PdfReport> => {
    const base = { url: entry.url, listedAt: iso(entry.listedAt) }
    const file = entry.url.split('/').pop()
    // Stored as a warning that could not be read. If even that fails it is logged and left: the
    // next run tries it again.
    const unreadable = async (why: string, summary?: Summary): Promise<PdfReport> => {
      delete tries[entry.url]
      delete storeFailures[entry.url]
      const reason = cut(why, MAX_PARSE_ERROR) || 'could not be read'
      const report: PdfReport = { ...base, outcome: 'unreadable', stored: false, reason, ...(summary ? { summary } : {}) }
      const warning: WarningRow = {
        pdf_url: entry.url,
        message_id: null,
        update_number: null,
        listed_at: base.listedAt,
        issued_at: null,
        valid_from: null,
        valid_to: null,
        parse_ok: false,
        parse_error: reason,
      }
      if (dry) return report
      try {
        const id = await deps.store(warning, [])
        return { ...report, stored: id !== null }
      } catch (err) {
        const message = `${file}: storing it as "could not be read" failed too: ${describeError(err)}`
        deps.log({ pdf: file, stored: false, message })
        outcome.errors.push(message)
        return report
      }
    }
    const downloadFailed = async (reason: string): Promise<PdfReport> => {
      const n = (tries[entry.url] ?? 0) + 1
      download.failures++
      download.first ??= `${entry.url.split('/').pop()}: ${reason}`
      if (n >= DOWNLOAD_ATTEMPTS && !dry) return unreadable(`could not be downloaded after ${n} tries: ${reason}`)
      if (!dry) tries[entry.url] = n
      return { ...base, outcome: 'download_failed', stored: false, reason, tries: n }
    }

    let got: BytesResult
    try {
      const headers = { 'User-Agent': USER_AGENT, Accept: 'application/pdf, */*;q=0.5' }
      got = await requestBytes(deps, entry.url, headers, startedAt + RUN_DEADLINE_MS)
    } catch (err) {
      return downloadFailed(describeError(err))
    }
    if (got.status !== 200) return downloadFailed(`HTTP ${got.status}`)
    // Too big to be one of these. Said so, rather than skipped: the app tells people to open the PDF.
    if (got.tooBig || !got.bytes) return unreadable(`the PDF is over ${PDF_MAX_BYTES} bytes`)
    const shape = pdfShape(got.bytes)
    if (shape === 'not_pdf') return downloadFailed('the answer is not a PDF')
    if (shape === 'cut_off') return downloadFailed('the PDF is cut off')

    let pages: PdfPage[]
    try {
      pages = await deps.readPdf(got.bytes)
    } catch (err) {
      return unreadable(`the PDF could not be read: ${describeError(err)}`)
    }

    if (isNotLewm(pagesText(pages))) {
      const note = 'no "Landslide Early Warning" title or LEWM message in its text'
      if (!dry) {
        try {
          await deps.markSeen([{ pdf_url: entry.url, outcome: 'not_lewm', note }])
        } catch (err) {
          outcome.errors.push(`recording a skipped PDF failed: ${describeError(err)}`)
        }
      }
      return { ...base, outcome: 'not_lewm', stored: false, reason: note }
    }

    const result = readLewm(pages)
    if (!result.parseOk) return unreadable(result.reason)

    const matched = matchNames(result, index)
    const rows = areaRows(matched)
    const at = (ms: number) => (Number.isFinite(ms) ? iso(ms) : null)

    const warning: WarningRow = {
      pdf_url: entry.url,
      message_id: result.messageId,
      update_number: result.update,
      listed_at: base.listedAt,
      issued_at: at(result.issuedAt),
      valid_from: at(result.validFrom),
      valid_to: at(result.validTo),
      parse_ok: true,
      parse_error: null,
    }
    const summary: Summary = {
      messageId: result.messageId,
      update: result.update,
      issuedAt: warning.issued_at ?? '',
      validFrom: warning.valid_from ?? '',
      validTo: warning.valid_to ?? '',
      matched: matched.areas.length,
      unmatched: matched.unmatched.length,
      areas: rows.map((r) => ({ level: r.level, district: r.district_name, name: r.ds_name, code: r.area_code, shift: r.shift, added: r.added, note: r.match_note })),
    }
    // Whatever the database would refuse is "could not be read", with the reason
    const problem = warningProblem(warning) ?? areaProblem(rows)
    if (problem) return unreadable(problem, summary)
    if (dry) return { ...base, outcome: 'read', stored: false, summary }

    let id: number | null
    try {
      id = await deps.store(warning, rows)
    } catch (err) {
      if (!isDataRefusal(err)) {
        // The database was not reached, or failed for a reason that says nothing about this warning
        // (no error code, a timeout, a dropped connection, an HTTP 5xx). Nothing is stored, the run
        // counts as failed, and the next run reads this PDF again.
        const n = (storeFailures[entry.url] ?? 0) + 1
        storeFailures[entry.url] = n
        const reason = describeError(err)
        deps.log({ pdf: file, message: result.messageId, stored: false, storeFailures: n, reason })
        outcome.errors.push(`${result.messageId}: storing it failed (${reason}), will try again`)
        return { ...base, outcome: 'store_failed', stored: false, reason, tries: n, summary }
      }
      // The data itself was refused (Postgres error class 22 or 23). Nothing was written (one
      // transaction). Rather than download it and be refused again on every run, it is stored as could
      // not be read, with the database's reason.
      const why = `database rejected: ${describeError(err)}`
      deps.log({ pdf: file, message: result.messageId, stored: false, reason: cut(why, 120) })
      outcome.errors.push(`${result.messageId}: the database refused it, so it is stored as could not be read`)
      return unreadable(why, summary)
    }
    delete storeFailures[entry.url]
    delete tries[entry.url]
    if (id !== null) return { ...base, outcome: 'read', stored: true, summary }
    // The same message was already stored from another address: remember this one as seen
    const note = `${result.messageId} was already stored`
    try {
      await deps.markSeen([{ pdf_url: entry.url, outcome: 'duplicate', note }])
    } catch (err) {
      outcome.errors.push(`recording a repeated PDF failed: ${describeError(err)}`)
    }
    return { ...base, outcome: 'duplicate', stored: false, reason: note }
  }

  const folderOk = isPdfLink
  for (let i = 0; i < todo.length; i++) {
    const entry = todo[i]
    if (deps.now() - startedAt > RUN_BUDGET_MS) {
      outcome.leftForLater = todo.length - i
      break
    }
    if (!pdfAllowed || !folderOk(entry.url)) {
      outcome.pdfs.push({ url: entry.url, listedAt: iso(entry.listedAt), outcome: 'robots_disallow', stored: false, reason: pdfAllowed ? 'not in the usual PDF folder' : 'robots.txt does not allow the PDF folder' })
      outcome.errors.push(`${entry.url.split('/').pop()}: not downloaded (${pdfAllowed ? 'not in the usual PDF folder' : 'robots.txt'})`)
      continue
    }
    if (pause > MAX_PAUSE_MS) {
      // A Crawl-delay this long can't be kept inside one run, so no PDF is asked for in this one
      outcome.errors.push(`robots.txt asks for ${robots.delaySec} s between requests: too long to download PDFs in one run`)
      outcome.leftForLater = todo.length - i
      break
    }
    await deps.sleep(pause)
    const report = await handle(entry)
    outcome.pdfs.push(report)
    if (report.stored && report.outcome === 'read') outcome.stored++
  }
  if (download.failures > 0) outcome.errors.push(`${download.failures} download(s) failed, will try again: ${download.first}`)

  // The state: a run with a failed download counts as a failure, so the usual backoff applies
  if (outcome.list.status !== 'not_modified' || todo.length > 0) {
    const current = new Set(entries.map((e) => e.url))
    memo.tries = Object.fromEntries(Object.entries(tries).filter(([url, n]) => n > 0 && current.has(url)))
    memo.storeFailures = Object.fromEntries(Object.entries(storeFailures).filter(([url, n]) => n > 0 && current.has(url)))
  }
  const trouble = outcome.errors.length > 0
  state.failures = trouble ? before.failures + 1 : 0
  state.last_error = trouble ? (download.first ?? outcome.errors[0] ?? null) : null
  return finish()
}
