// The parts of the news-refresh function that need no network or database, so tests can run them
// with stand-ins: reading feeds and pages, judging headlines, robots.txt, when each source is due,
// and one whole run. index.ts only wires this to fetch() and the two tables.
//
// Imports only the two lists next to it, and nothing Deno-only, so it loads in Deno and in the tests.

import { HAZARDS, KEYWORDS, WORLD_SECTIONS, type Hazard } from './keywords.ts'
import { cleanTitle, decodeEntities, normaliseUrl, unwrapCdata } from './shared.ts'
import type { Lang, Source } from './sources.ts'

export { cleanTitle, decodeEntities, isOwnHost, isOwnLink, MAX_TITLE, MAX_URL, normaliseUrl, tidyTitle } from './shared.ts'

export const USER_AGENT =
  'TerraFend/1.0 (+https://terrafend.vercel.app; free Sri Lanka hazard map; contact: https://github.com/wishwadahanayaka/terrafend)'

const MINUTE = 60_000
const DAY = 24 * 60 * MINUTE

// How long to wait for one request, unless the source sets its own timeoutMs
export const FETCH_TIMEOUT_MS = 10_000
// No request starts, or is allowed to run on, past this long after the run began. The cron job gives
// the whole call 60 s, and a run that is cut off saves nothing for any source, so this leaves the rest
// for the writes. It only bites when sites are very slow.
export const RUN_DEADLINE_MS = 52_000
// With less than this left of the run's time a request is not started
export const MIN_REQUEST_MS = 2_000
export const MAX_BYTES = 1_000_000
export const MAX_REDIRECTS = 3
export const MAX_ITEMS_PER_SOURCE = 50
export const CONCURRENCY = 4
// Sources not started by then wait for the next run, so a run stays well inside the function's limits
export const RUN_BUDGET_MS = 45_000
// Headlines older than this are not stored (the table keeps 7 days)
export const MAX_AGE_MS = 7 * DAY
// The cron job fires every 15 minutes, a few seconds either way, and a source last read at the start
// of the previous run should count as due. Never taken off a robots.txt Crawl-delay.
export const SLACK_MS = MINUTE
// After this many failures in a row a source is asked at most hourly
export const BACKOFF_AFTER = 3
export const BACKOFF_MIN = 60
// After a 403 or 410 (blocked, or gone), once a day. Nothing tries to get round a block.
export const BLOCKED_MIN = 24 * 60
export const ROBOTS_MAX_AGE_MS = DAY
export const KEEP_SCORE = 2

const SRI_LANKA_OFFSET = '+05:30'

// Every answer the function sends. The charset matters: without it Windows PowerShell 5.1 reads the
// body as Latin-1 and Sinhala and Tamil headlines come out as scrambled text.
export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  })
}

// Compares hashes so the check takes the same time wherever the strings differ
async function sameSecret(a: string, b: string): Promise<boolean> {
  const enc = new TextEncoder()
  const [x, y] = await Promise.all([crypto.subtle.digest('SHA-256', enc.encode(a)), crypto.subtle.digest('SHA-256', enc.encode(b))])
  const xa = new Uint8Array(x)
  const ya = new Uint8Array(y)
  let diff = 0
  for (let i = 0; i < xa.length; i++) diff |= xa[i] ^ ya[i]
  return diff === 0
}

// No secret set means nobody gets in, rather than everybody
export async function isAuthorised(sent: string | null, expected: string | undefined): Promise<boolean> {
  if (!expected || !sent) return false
  return sameSecret(sent, expected)
}

// ---- Text ----

// Counts the letters of each script: Sinhala, then Tamil, else English
export function detectLanguage(text: string): Lang {
  const si = text.match(/[඀-෿]/g)?.length ?? 0
  const ta = text.match(/[஀-௿]/g)?.length ?? 0
  if (si === 0 && ta === 0) return 'en'
  return si >= ta ? 'si' : 'ta'
}

// ---- Times ----

const HAS_ZONE = /(?:z|gmt|utc|ut|[+-]\d{2}:?\d{2}|\b[ecmp][sd]t)\s*$/i

// A time from a feed, in ms. A time with no zone (Daily Mirror's "2026-11-15 14:06:00") is Sri Lanka time.
export function parseDate(text: string | null | undefined): number | null {
  if (!text) return null
  const t = unwrapCdata(text).trim()
  if (!t) return null
  const local = /^(\d{4}-\d{2}-\d{2})(?:[ T](\d{2}:\d{2})(:\d{2})?)?$/.exec(t)
  if (local) return Date.parse(`${local[1]}T${local[2] ?? '00:00'}${local[3] ?? ':00'}${SRI_LANKA_OFFSET}`)
  // Date.parse makes a date out of almost anything ("yesterday" became the year 530), so a time must
  // at least have a four-digit year and come out between 2000 and 2100
  if (!/\b\d{4}\b/.test(t)) return null
  const ms = Date.parse(HAS_ZONE.test(t) ? t : `${t} ${SRI_LANKA_OFFSET.replace(':', '')}`)
  return Number.isFinite(ms) && ms > Date.UTC(2000, 0) && ms < Date.UTC(2100, 0) ? ms : null
}

// When an item counts as published: its own time, or the run's time if it has none or claims a time
// in the future. null for anything older than 7 days, which is not stored.
export function publishedAt(parsed: number | null, fetchedAt: number): number | null {
  if (parsed === null || parsed > fetchedAt) return fetchedAt
  return fetchedAt - parsed > MAX_AGE_MS ? null : parsed
}

// ---- Feeds and pages ----

export type FeedItem = { title: string; link: string; date: string | null }

export function isFeed(text: string): boolean {
  return /<(rss|feed|rdf:RDF)[\s>]/i.test(text)
}

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

function tagText(body: string, name: string): string | null {
  const m = new RegExp(`<${escapeRegex(name)}(?:\\s[^>]*)?>([\\s\\S]*?)</${escapeRegex(name)}>`, 'i').exec(body)
  return m ? m[1] : null
}

// The items of an RSS 2.0 feed or the entries of an Atom feed. Only the headline, link and time are
// read: the description and any article text are never looked at.
export function parseFeed(xml: string): FeedItem[] {
  const found: FeedItem[] = []
  for (const m of xml.matchAll(/<(item|entry)(?:\s[^>]*)?>([\s\S]*?)<\/\1>/gi)) {
    const body = m[2]
    const title = tagText(body, 'title') ?? ''
    let link = tagText(body, 'link')
    if (!link || !link.trim()) {
      // Atom: <link href="..."/>, the alternate one if there is a choice
      const links = [...body.matchAll(/<link\b([^>]*)\/?>/gi)].map((l) => l[1])
      const pick = links.find((a) => /rel=["']alternate["']/i.test(a)) ?? links.find((a) => !/rel=/i.test(a))
      link = pick ? (/href=["']([^"']+)["']/i.exec(pick)?.[1] ?? null) : null
    }
    if (!link || !link.trim()) {
      const guid = tagText(body, 'guid')
      if (guid && /^\s*(<!\[CDATA\[)?\s*https?:/i.test(guid)) link = guid
    }
    const date = tagText(body, 'pubDate') ?? tagText(body, 'published') ?? tagText(body, 'updated') ?? tagText(body, 'dc:date')
    found.push({ title, link: decodeEntities(unwrapCdata(link ?? '')).trim(), date })
  }
  return found
}

export type ListRow = { title: string; date: string; time: string; href: string }

// One of DMC's report tables: a row per report, with Title, Date, Time (24h) and a PDF link
export function parseDmcList(html: string): ListRow[] {
  const rows: ListRow[] = []
  for (const tr of html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells = [...tr[1].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map((c) => c[1])
    if (cells.length < 4) continue
    const href = /href=["']([^"']+\.pdf)["']/i.exec(cells[3])?.[1]
    const date = cleanTitle(cells[1])
    const time = cleanTitle(cells[2])
    if (!href || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{1,2}:\d{2}$/.test(time)) continue
    rows.push({ title: cleanTitle(cells[0]), date, time: time.padStart(5, '0'), href: decodeEntities(href) })
  }
  return rows
}

// The Met Department's advisory fields. Each holds a PDF path while that advisory is out, and an
// empty string otherwise. ("lighting" is the site's own spelling.)
export const METEO_FIELDS: Record<string, { channel: string; hazard: Hazard; title: string }> = {
  land_pdf: { channel: 'meteo_land', hazard: 'rain', title: 'Severe weather advisory: land areas' },
  sea_pdf: { channel: 'meteo_sea', hazard: 'wind_sea', title: 'Severe weather advisory: sea areas' },
  lighting_pdf: { channel: 'meteo_lightning', hazard: 'rain', title: 'Lightning advisory' },
  tsunami_pdf: { channel: 'meteo_tsunami', hazard: 'tsunami', title: 'Tsunami warning' },
  heat_pdf: { channel: 'meteo_heat', hazard: 'other', title: 'Heat advisory' },
}

export function parseMeteo(text: string): { active: { field: string; path: string }[]; unknown: string[] } {
  const json = JSON.parse(text) as { severe_weather_advisory?: unknown }
  const advisory = json?.severe_weather_advisory
  if (!advisory || typeof advisory !== 'object') throw new Error('content.json has no severe_weather_advisory')
  const active: { field: string; path: string }[] = []
  const unknown: string[] = []
  for (const [field, value] of Object.entries(advisory as Record<string, unknown>)) {
    if (!(field in METEO_FIELDS)) unknown.push(field)
    else if (typeof value === 'string' && value.trim() !== '') active.push({ field, path: value.trim() })
  }
  return { active, unknown }
}

// ---- Judging a headline ----

export type Verdict = { keep: boolean; score: number; matched: string[]; hazard: Hazard }

// Lowercase, one kind of each letter (NFC), and no zero-width joiners, so ශ්‍රී typed either way matches
export function forMatching(text: string): string {
  return text.normalize('NFC').replace(/[‌‍]/g, '').toLowerCase().replace(/\s+/g, ' ')
}

const WORD = '[\\p{L}\\p{M}\\p{N}]'

function compile(term: string, lang: Lang): RegExp {
  const open = term.endsWith('*')
  const closed = term.endsWith('|')
  const core = escapeRegex(forMatching(term.replace(/[*|]$/, ''))).replace(/ /g, '\\s+')
  if (lang === 'en') return new RegExp(`(?<!${WORD})${core}${open ? `${WORD}*` : `(?!${WORD})`}`, 'u')
  return new RegExp(closed ? `${core}(?!${WORD})` : core, 'u')
}

type Compiled = {
  strong: { term: string; hazard: Hazard; re: RegExp }[]
  weak: { term: string; hazard: Hazard; re: RegExp }[]
  elephant: RegExp[]
  incident: RegExp[]
  negative: { term: string; re: RegExp }[]
  foreign: RegExp[]
  home: RegExp[]
}

const compiled = new Map<Lang, Compiled>()

function listsFor(lang: Lang): Compiled {
  const done = compiled.get(lang)
  if (done) return done
  const l = KEYWORDS[lang]
  const terms = (list: readonly (readonly [string, Hazard])[]) =>
    list.map(([term, hazard]) => ({ term: term.replace(/[*|]$/, ''), hazard, re: compile(term, lang) }))
  const made: Compiled = {
    strong: terms(l.strong),
    weak: terms(l.weak),
    elephant: l.elephant.map((t) => compile(t, lang)),
    incident: l.incident.map((t) => compile(t, lang)),
    negative: l.negative.map((t) => ({ term: t.replace(/[*|]$/, ''), re: compile(t, lang) })),
    foreign: l.foreign.map((t) => compile(t, lang)),
    home: l.home.map((t) => compile(t, lang)),
  }
  compiled.set(lang, made)
  return made
}

const firstHazard = (hazards: Hazard[]): Hazard | null => HAZARDS.find((h) => hazards.includes(h)) ?? null

// Whether a headline is about a disaster in Sri Lanka, and which kind. See keywords.ts for the rules.
export function judge(title: string, url: string, lang: Lang): Verdict {
  let path = ''
  try {
    path = decodeURIComponent(new URL(url).pathname).toLowerCase()
  } catch {
    // a link that can't be read has no section
  }
  if (WORLD_SECTIONS.some((s) => path.includes(s))) return { keep: false, score: -5, matched: ['-world section'], hazard: 'other' }

  const text = forMatching(title)
  const lists = listsFor(lang)
  const strong = lists.strong.filter((t) => t.re.test(text))
  const weak = lists.weak.filter((t) => t.re.test(text))
  if (lists.elephant.some((re) => re.test(text))) {
    const entry = { term: 'elephant', hazard: 'elephant' as Hazard, re: /$^/ }
    if (lists.incident.some((re) => re.test(text))) strong.push(entry)
    else weak.push(entry)
  }

  // Two weak words only add up when one of them names a hazard ("warning" + "alert" is not enough)
  const weakScore = weak.every((t) => t.hazard === 'other') ? Math.min(weak.length, 1) : weak.length
  let score = strong.length * 2 + weakScore
  const matched = [...strong.map((t) => `+${t.term}`), ...weak.map((t) => `~${t.term}`)]

  const negative = lists.negative.filter((t) => t.re.test(text))
  if (negative.length > 0) {
    score -= 3
    matched.push(...negative.map((t) => `-${t.term}`))
  }
  const weatherSystem = strong.some((t) => t.hazard === 'cyclone' || t.hazard === 'tsunami')
  if (!weatherSystem && lists.foreign.some((re) => re.test(text)) && !lists.home.some((re) => re.test(text))) {
    score -= 3
    matched.push('-foreign')
  }

  // A named hazard wins over "other" (evacuations, warnings), even when it comes from a weak word
  const named = (list: { hazard: Hazard }[]) => firstHazard(list.map((t) => t.hazard).filter((h) => h !== 'other'))
  const hazard = named(strong) ?? named(weak) ?? 'other'
  return { keep: score >= KEEP_SCORE, score, matched: matched.slice(0, 10), hazard }
}

// ---- robots.txt ----

export type RobotsVerdict = { allowed: boolean; crawlDelaySec: number }

// Reads robots.txt the usual way: the group for our name if there is one, otherwise the * group;
// the longest matching rule wins, Allow on a tie; * and $ in rules work. Anything that isn't robots
// rules at all (DMC answers with its homepage) allows everything.
export function robotsVerdict(text: string, path: string, agent = 'terrafend'): RobotsVerdict {
  type Group = { agents: string[]; rules: { allow: boolean; pattern: string }[]; delay: number | null }
  const groups: Group[] = []
  let current: Group | null = null
  let lastWasAgent = false
  // A Crawl-delay after a Sitemap line belongs to no group. Daily Mirror and Lankadeepa write theirs
  // that way, at the very end, and it is read as meant for everyone.
  let looseDelay: number | null = null
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, '').trim()
    const m = /^([a-z-]+)\s*:\s*(.*)$/i.exec(line)
    if (!m) continue
    const key = m[1].toLowerCase()
    const value = m[2].trim()
    if (key === 'user-agent') {
      if (!current || !lastWasAgent) {
        current = { agents: [], rules: [], delay: null }
        groups.push(current)
      }
      current.agents.push(value.toLowerCase())
      lastWasAgent = true
      continue
    }
    lastWasAgent = false
    if (key === 'sitemap') {
      current = null
      continue
    }
    if (key === 'crawl-delay') {
      const n = Number(value)
      if (!Number.isFinite(n) || n < 0) continue
      if (current) current.delay = Math.max(current.delay ?? 0, n)
      else looseDelay = Math.max(looseDelay ?? 0, n)
      continue
    }
    if (current && (key === 'allow' || key === 'disallow') && value) current.rules.push({ allow: key === 'allow', pattern: value })
  }

  const ours = groups.filter((g) => g.agents.includes(agent))
  const chosen = ours.length > 0 ? ours : groups.filter((g) => g.agents.includes('*'))
  let best: { allow: boolean; length: number } | null = null
  for (const rule of chosen.flatMap((g) => g.rules)) {
    const anchored = rule.pattern.endsWith('$')
    const body = anchored ? rule.pattern.slice(0, -1) : rule.pattern
    const re = new RegExp('^' + body.split('*').map(escapeRegex).join('.*') + (anchored ? '$' : ''))
    if (!re.test(path)) continue
    const length = rule.pattern.length
    if (!best || length > best.length || (length === best.length && rule.allow)) best = { allow: rule.allow, length }
  }
  const delays = [...chosen.map((g) => g.delay), looseDelay].filter((d): d is number => d !== null)
  return { allowed: best ? best.allow : true, crawlDelaySec: delays.length ? Math.max(...delays) : 0 }
}

// ---- When a source is due ----

export type Memo = { robotsDelaySec?: number; meteoActive?: Record<string, string> }

// A row of news_source_state
export type SourceState = {
  source: string
  etag: string | null
  last_modified: string | null
  last_fetch_at: string | null
  last_status: number | null
  last_error: string | null
  failures: number
  robots_ok: boolean | null
  robots_at: string | null
  memo: Memo
}

export const emptyState = (source: string): SourceState => ({
  source,
  etag: null,
  last_modified: null,
  last_fetch_at: null,
  last_status: null,
  last_error: null,
  failures: 0,
  robots_ok: null,
  robots_at: null,
  memo: {},
})

// The shortest time between two requests to a source, in minutes: its own setting, or what its
// robots.txt asks for (as written down in sources.ts, or as last read), whichever is longest
export function crawlDelayMin(source: Source, state: SourceState): number {
  return Math.max(source.crawlDelayMin, Math.ceil((state.memo.robotsDelaySec ?? 0) / 60))
}

export function isDue(source: Source, state: SourceState, now: number): boolean {
  if (!state.last_fetch_at) return true
  const last = Date.parse(state.last_fetch_at)
  if (!Number.isFinite(last)) return true
  let wait = source.everyMin * MINUTE - SLACK_MS
  if (state.last_status === 403 || state.last_status === 410) wait = Math.max(wait, BLOCKED_MIN * MINUTE - SLACK_MS)
  else if (state.failures >= BACKOFF_AFTER) wait = Math.max(wait, BACKOFF_MIN * MINUTE - SLACK_MS)
  wait = Math.max(wait, crawlDelayMin(source, state) * MINUTE)
  return now - last >= wait
}

// ---- One run ----

export type FetchResult = {
  status: number
  headers: { etag: string | null; lastModified: string | null; location: string | null }
  // The body as text, for a GET answered 200 that fit under MAX_BYTES. null otherwise.
  body: string | null
  tooBig: boolean
}

// A row of news_items, as the function writes it
export type NewsRow = {
  item_key: string
  url: string
  title: string
  source: string
  kind: 'official' | 'media'
  channel: string | null
  language: Lang
  hazard: Hazard
  published_at: string
  fetched_at: string
  score: number
  matched: string[]
}

export type Dropped = { source: string; title: string; score: number; matched: string[] }

export type Deps = {
  now: () => number
  sources: Source[]
  // Sends one request with exactly these headers, does not follow redirects, gives up after
  // timeoutMs and stops reading after MAX_BYTES. Throws on a network error or a timeout.
  fetch: (
    url: string,
    init: { method: 'GET' | 'HEAD'; headers: Record<string, string>; timeoutMs: number },
  ) => Promise<FetchResult>
  readStates: () => Promise<SourceState[]>
  // Adds new rows (an item_key already stored is left alone). Gives back how many were new.
  writeItems: (rows: NewsRow[]) => Promise<number>
  // Sets ended_at on these stored items (official notices that were withdrawn)
  markEnded: (keys: string[], at: string) => Promise<void>
  writeStates: (states: SourceState[]) => Promise<void>
  log: (entry: Record<string, unknown>) => void
}

export type Options = { force?: boolean; dryRun?: boolean; only?: string | null }

export type SourceReport = {
  id: string
  status: 'ok' | 'not_modified' | 'failed' | 'robots_disallow' | 'robots_unknown'
  found: number
  kept: number
  error?: string
}

export type Outcome = {
  result: 'ok' | 'dry_run' | 'failed'
  startedAt: string
  sources: SourceReport[]
  skipped: { id: string; reason: 'not_due' | 'disabled' | 'out_of_time' }[]
  stored: number
  ended: number
  errors: string[]
  // Dry runs only: what would be stored, and what the filter dropped (for tuning the keywords)
  items?: Pick<NewsRow, 'source' | 'title' | 'language' | 'hazard' | 'score' | 'matched' | 'published_at' | 'url'>[]
  dropped?: Dropped[]
}

const REDIRECTS = new Set([301, 302, 303, 307, 308])

const baseHeaders = (): Record<string, string> => ({
  'User-Agent': USER_AGENT,
  Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml, application/json, text/html;q=0.8, */*;q=0.5',
})

export const timeoutFor = (source: Source): number => source.timeoutMs ?? FETCH_TIMEOUT_MS

type Limits = {
  // Wait this long for each request, but never past the run's deadline (a time, in ms)
  timeoutMs: number
  deadline: number
}

// Follows up to MAX_REDIRECTS redirects, and only to the source's own sites
async function request(
  deps: Deps,
  url: string,
  domains: string[],
  headers: Record<string, string>,
  limits: Limits,
  method: 'GET' | 'HEAD' = 'GET',
): Promise<{ res: FetchResult; finalUrl: string }> {
  let current = url
  for (let hop = 0; ; hop++) {
    const left = limits.deadline - deps.now()
    if (left < MIN_REQUEST_MS) throw new Error('out of time for this run')
    const res = await deps.fetch(current, { method, headers, timeoutMs: Math.min(limits.timeoutMs, left) })
    if (!REDIRECTS.has(res.status)) return { res, finalUrl: current }
    if (hop >= MAX_REDIRECTS) throw new Error('too many redirects')
    const next = res.headers.location ? normaliseUrl(res.headers.location, current, domains) : null
    if (!next) throw new Error('redirected to another site')
    current = next
  }
}

type RobotsFile = { status: number; body: string } | { error: string }

// The name and message of whatever went wrong, short enough to keep in a table: a timeout, a refused
// connection, a certificate problem. This is what shows up in last_error.
export function describeError(err: unknown): string {
  const e = err as { name?: string; message?: string } | null
  const text = e?.message ? (e.name && e.name !== 'Error' ? `${e.name}: ${e.message}` : e.message) : String(err)
  return text.replace(/\s+/g, ' ').slice(0, 160)
}

type RobotsResult =
  | { allowed: boolean; delaySec: number; fresh: boolean }
  // robots.txt could not be read: why, and the HTTP status if there was one
  | { unreadable: string; status: number | null }

// What a source's robots.txt says, read at most once a day (and once per site per run)
async function robotsCheck(
  deps: Deps,
  source: Source,
  state: SourceState,
  now: number,
  cache: Map<string, Promise<RobotsFile>>,
): Promise<RobotsResult> {
  const known = state.robots_ok !== null && state.robots_at !== null
  if (known && now - Date.parse(state.robots_at!) < ROBOTS_MAX_AGE_MS) {
    return { allowed: state.robots_ok!, delaySec: state.memo.robotsDelaySec ?? 0, fresh: false }
  }
  const target = new URL(source.url)
  if (!cache.has(target.host)) {
    cache.set(
      target.host,
      request(deps, `https://${target.host}/robots.txt`, source.ownDomains, baseHeaders(), {
        timeoutMs: timeoutFor(source),
        deadline: now + RUN_DEADLINE_MS,
      })
        .then(({ res }): RobotsFile => ({ status: res.status, body: res.body ?? '' }))
        .catch((err): RobotsFile => ({ error: describeError(err) })),
    )
  }
  const file = await cache.get(target.host)!
  if ('error' in file || file.status >= 500 || file.status === 429) {
    // Keep the last answer. With none we don't know the rules, and a robots.txt that can't be reached
    // is treated as "not allowed for now" (RFC 9309), so the source waits and is tried again later.
    if (known) return { allowed: state.robots_ok!, delaySec: state.memo.robotsDelaySec ?? 0, fresh: false }
    return 'error' in file
      ? { unreadable: file.error, status: null }
      : { unreadable: `HTTP ${file.status}`, status: file.status }
  }
  // A missing robots.txt (4xx) allows everything
  const verdict = file.status === 200 ? robotsVerdict(file.body, target.pathname + target.search) : { allowed: true, crawlDelaySec: 0 }
  return { allowed: verdict.allowed, delaySec: verdict.crawlDelaySec, fresh: true }
}

type Run = { report: SourceReport; rows: NewsRow[]; dropped: Dropped[]; ended: string[]; state: SourceState }

async function runSource(
  deps: Deps,
  source: Source,
  before: SourceState,
  startedAt: number,
  dryRun: boolean,
  robotsCache: Map<string, Promise<RobotsFile>>,
): Promise<Run> {
  const state: SourceState = { ...before, memo: { ...before.memo } }
  const iso = new Date(startedAt).toISOString()
  const rows: NewsRow[] = []
  const dropped: Dropped[] = []
  const ended: string[] = []
  const report: SourceReport = { id: source.id, status: 'ok', found: 0, kept: 0 }
  const done = () => ({ report: { ...report, kept: rows.length }, rows, dropped, ended, state })

  const robots = await robotsCheck(deps, source, state, startedAt, robotsCache)
  if ('unreadable' in robots) {
    // Counts as a failed attempt with its reason on record. Before, this left the row untouched, so a
    // source stuck here looked like it had never been tried, with nothing to say why.
    state.last_fetch_at = iso
    state.last_status = robots.status
    state.last_error = `robots.txt: ${robots.unreadable}`
    state.failures = before.failures + 1
    report.status = 'robots_unknown'
    report.error = state.last_error
    return done()
  }
  if (robots.fresh) {
    state.robots_ok = robots.allowed
    state.robots_at = iso
    state.memo.robotsDelaySec = robots.delaySec
  }
  if (!robots.allowed) {
    state.last_error = 'robots.txt does not allow this address'
    report.status = 'robots_disallow'
    report.error = state.last_error
    return done()
  }

  state.last_fetch_at = iso
  state.last_status = null
  try {
    const headers = baseHeaders()
    // A dry run reads everything afresh, so it shows what is there and changes nothing
    if (!dryRun && before.etag) headers['If-None-Match'] = before.etag
    if (!dryRun && before.last_modified) headers['If-Modified-Since'] = before.last_modified
    const { res, finalUrl } = await request(deps, source.url, source.ownDomains, headers, {
      timeoutMs: timeoutFor(source),
      deadline: startedAt + RUN_DEADLINE_MS,
    })
    state.last_status = res.status

    if (res.status === 304) {
      report.status = 'not_modified'
    } else {
      if (res.status !== 200) throw new Error(`HTTP ${res.status}`)
      if (res.tooBig) throw new Error(`answer over ${MAX_BYTES} bytes`)
      const body = res.body ?? ''
      state.etag = res.headers.etag
      state.last_modified = res.headers.lastModified

      if (source.parser === 'rss') {
        if (!isFeed(body)) throw new Error('not an RSS or Atom feed')
        const items = parseFeed(body).slice(0, MAX_ITEMS_PER_SOURCE)
        report.found = items.length
        for (const item of items) {
          const title = cleanTitle(item.title)
          const url = normaliseUrl(item.link, finalUrl, source.ownDomains)
          const when = publishedAt(parseDate(item.date), startedAt)
          if (!title || !url || when === null) continue
          const language = source.language === 'detect' ? detectLanguage(title) : source.language
          const verdict = judge(title, url, language)
          if (source.filter === 'keywords' && !verdict.keep) {
            dropped.push({ source: source.id, title, score: verdict.score, matched: verdict.matched })
            continue
          }
          rows.push(row(source, url, url, title, language, verdict.hazard, when, startedAt, verdict.score, verdict.matched))
        }
      } else if (source.parser === 'dmcList') {
        const list = parseDmcList(body)
        report.found = list.length
        if (list.length === 0) throw new Error('no rows found: the page layout may have changed')
        // Only the newest report: these lists are routine (one a day, or three), so older ones add nothing
        const newest = list
          .map((r) => ({ r, at: parseDate(`${r.date} ${r.time}`) ?? 0 }))
          .reduce((a, b) => (b.at > a.at ? b : a))
        const url = normaliseUrl(newest.r.href, finalUrl, source.ownDomains)
        const when = publishedAt(newest.at || null, startedAt)
        if (url && when !== null && newest.r.title) {
          const hazard: Hazard = source.channel === 'dmc_landslide' ? 'landslide' : source.channel === 'dmc_flood' ? 'flood' : 'other'
          rows.push(row(source, url, url, newest.r.title, 'en', hazard, when, startedAt, 0, []))
        }
      } else {
        const { active, unknown } = parseMeteo(body)
        if (unknown.length) deps.log({ source: source.id, note: 'unknown advisory fields', fields: unknown })
        report.found = active.length
        const previous = before.memo.meteoActive ?? {}
        const now: Record<string, string> = {}
        for (const { field, path } of active) {
          const meta = METEO_FIELDS[field]
          const url = normaliseUrl(path, finalUrl, source.ownDomains)
          if (!url) continue
          // The PDF keeps its name for every new issue, so its version tells issues apart
          let version: string | null = null
          let issued: number | null = null
          try {
            // Only a side check with a fallback just below, so it keeps the normal short wait
            const head = await request(
              deps,
              url,
              source.ownDomains,
              baseHeaders(),
              { timeoutMs: FETCH_TIMEOUT_MS, deadline: startedAt + RUN_DEADLINE_MS },
              'HEAD',
            )
            if (head.res.status === 200) {
              version = head.res.headers.etag ?? head.res.headers.lastModified
              issued = parseDate(head.res.headers.lastModified)
            }
          } catch {
            // fall back to the version of content.json below
          }
          version ??= res.headers.etag ?? res.headers.lastModified ?? 'unversioned'
          const key = `meteo:${field.replace(/_pdf$/, '')}:${version.replace(/[^A-Za-z0-9-]/g, '')}`
          const when = publishedAt(issued, startedAt) ?? startedAt
          now[field] = key
          rows.push({ ...row(source, key, url, meta.title, 'en', meta.hazard, when, startedAt, 0, []), channel: meta.channel })
        }
        // A field that emptied, or now points at a new issue, ends the old notice
        for (const [field, key] of Object.entries(previous)) if (now[field] !== key) ended.push(key)
        state.memo.meteoActive = now
      }
    }
    state.failures = 0
    state.last_error = null
  } catch (err) {
    // The old caching headers stay, so a page that failed to parse is read in full next time
    state.etag = before.etag
    state.last_modified = before.last_modified
    state.memo.meteoActive = before.memo.meteoActive
    state.failures = before.failures + 1
    state.last_error = describeError(err) || 'failed'
    report.status = 'failed'
    report.error = state.last_error
    rows.length = 0
    ended.length = 0
    dropped.length = 0
  }

  // The same link twice in one feed (Tamil Mirror does this) is one item
  const seen = new Set<string>()
  const unique = rows.filter((r) => !seen.has(r.item_key) && seen.add(r.item_key))
  rows.splice(0, rows.length, ...unique)
  return done()
}

function row(
  source: Source,
  key: string,
  url: string,
  title: string,
  language: Lang,
  hazard: Hazard,
  when: number,
  fetchedAt: number,
  score: number,
  matched: string[],
): NewsRow {
  return {
    item_key: key,
    url,
    title,
    source: source.id,
    kind: source.kind,
    channel: source.channel ?? null,
    language,
    hazard,
    published_at: new Date(when).toISOString(),
    fetched_at: new Date(fetchedAt).toISOString(),
    score,
    matched,
  }
}

// One run: asks every source that is due (at most CONCURRENCY at a time), keeps the disaster
// headlines and stores them. One source failing never stops the others.
export async function refresh(deps: Deps, options: Options = {}): Promise<Outcome> {
  const startedAt = deps.now()
  const outcome: Outcome = {
    result: options.dryRun ? 'dry_run' : 'ok',
    startedAt: new Date(startedAt).toISOString(),
    sources: [],
    skipped: [],
    stored: 0,
    ended: 0,
    errors: [],
  }
  const failed = (message: string): Outcome => {
    deps.log({ result: 'failed', message })
    return { ...outcome, result: 'failed', errors: [...outcome.errors, message] }
  }

  const sources = options.only ? deps.sources.filter((s) => s.id === options.only) : deps.sources
  if (options.only && sources.length === 0) return failed(`unknown source: ${options.only}`)

  let states: Map<string, SourceState>
  try {
    states = new Map((await deps.readStates()).map((s) => [s.source, { ...emptyState(s.source), ...s, memo: s.memo ?? {} }]))
  } catch (err) {
    // Without the state there is no way to keep to each site's interval, so nothing is asked
    return failed(`database read failed: ${(err as Error).message}`)
  }

  const due: Source[] = []
  for (const source of sources) {
    const state = states.get(source.id) ?? emptyState(source.id)
    if (!source.enabled) outcome.skipped.push({ id: source.id, reason: 'disabled' })
    else if (!options.force && !isDue(source, state, startedAt)) outcome.skipped.push({ id: source.id, reason: 'not_due' })
    else due.push(source)
  }

  const runs: Run[] = []
  const robotsCache = new Map<string, Promise<RobotsFile>>()
  let next = 0
  const worker = async () => {
    while (next < due.length) {
      const source = due[next++]
      if (deps.now() - startedAt > RUN_BUDGET_MS) {
        outcome.skipped.push({ id: source.id, reason: 'out_of_time' })
        continue
      }
      const before = states.get(source.id) ?? emptyState(source.id)
      try {
        runs.push(await runSource(deps, source, before, startedAt, !!options.dryRun, robotsCache))
      } catch (err) {
        // runSource catches its own errors; this is only a last guard
        const message = describeError(err) || 'failed'
        runs.push({
          report: { id: source.id, status: 'failed', found: 0, kept: 0, error: message },
          rows: [],
          dropped: [],
          ended: [],
          state: { ...before, failures: before.failures + 1, last_error: message, last_fetch_at: new Date(startedAt).toISOString() },
        })
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, due.length) }, worker))

  // Keep the order of the source list, so the log and the answer read the same every time
  const order = new Map(deps.sources.map((s, i) => [s.id, i]))
  runs.sort((a, b) => (order.get(a.report.id) ?? 0) - (order.get(b.report.id) ?? 0))
  outcome.sources = runs.map((r) => r.report)

  // Across sources the first one wins (official sources come first in the list)
  const seen = new Set<string>()
  const rows = runs.flatMap((r) => r.rows).filter((r) => !seen.has(r.item_key) && seen.add(r.item_key))
  const ended = runs.flatMap((r) => r.ended)

  if (options.dryRun) {
    outcome.items = rows.map(({ source, title, language, hazard, score, matched, published_at, url }) => ({
      source,
      title,
      language,
      hazard,
      score,
      matched,
      published_at,
      url,
    }))
    outcome.dropped = runs.flatMap((r) => r.dropped)
    outcome.ended = ended.length
    deps.log({ result: 'dry_run', sources: outcome.sources, items: rows.length, dropped: outcome.dropped.length })
    return outcome
  }

  if (rows.length > 0) {
    try {
      outcome.stored = await deps.writeItems(rows)
    } catch (err) {
      outcome.errors.push(`writing items failed: ${(err as Error).message}`)
    }
  }
  if (ended.length > 0) {
    try {
      await deps.markEnded(ended, outcome.startedAt)
      outcome.ended = ended.length
    } catch (err) {
      outcome.errors.push(`marking ended notices failed: ${(err as Error).message}`)
    }
  }
  if (runs.length > 0) {
    try {
      await deps.writeStates(runs.map((r) => r.state))
    } catch (err) {
      outcome.errors.push(`writing source state failed: ${(err as Error).message}`)
    }
  }

  const allFailed = runs.length > 0 && runs.every((r) => r.report.status === 'failed')
  if (outcome.errors.length > 0 || allFailed) outcome.result = 'failed'
  deps.log({ result: outcome.result, sources: outcome.sources, skipped: outcome.skipped, stored: outcome.stored, ended: outcome.ended, errors: outcome.errors })
  return outcome
}

// Reads a response body as UTF-8 text, giving up once it passes `max` bytes
export async function readCapped(body: ReadableStream<Uint8Array> | null, max: number): Promise<{ text: string; tooBig: boolean }> {
  if (!body) return { text: '', tooBig: false }
  const reader = body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > max) {
      await reader.cancel()
      return { text: '', tooBig: true }
    }
    chunks.push(value)
  }
  const all = new Uint8Array(size)
  let at = 0
  for (const chunk of chunks) {
    all.set(chunk, at)
    at += chunk.byteLength
  }
  return { text: new TextDecoder('utf-8').decode(all), tooBig: false }
}
