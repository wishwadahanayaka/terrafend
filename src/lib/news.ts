import { HAZARDS, type Hazard } from '../../supabase/functions/news-refresh/hazards'
import { isOwnLink, tidyTitle } from '../../supabase/functions/news-refresh/shared'
import { SOURCES, type Lang } from '../../supabase/functions/news-refresh/sources'
import { t } from '../i18n'
import type { NewsFilter } from './newsFilter'

// Disaster news headlines, read from the news_items table that the news-refresh function fills (see
// docs/news-feed.md). Headline, source, time and link only, never the article text. This file is
// the logic: reading a row, naming the source, grouping for the sheet, and the numbers for the chip.
// Fetching is in newsFetch.ts. Nothing here draws anything.

const HOUR_MS = 3_600_000

// The sheet shows the last two days; the chip counts the last day
export const NEWS_WINDOW_MS = 48 * HOUR_MS
export const NEWS_CHIP_WINDOW_MS = 24 * HOUR_MS
export const NEWS_MAX_ITEMS = 100

// The sheet shows this many stories per kind of disaster, then "Show N more"
export const VISIBLE_PER_HAZARD = 3

// Two headlines are the same story when they are in the same language, filed under the same hazard,
// came out within this long of each other, and share enough words. These are the numbers to tune.
export const DUPLICATE_WINDOW_MS = 36 * HOUR_MS
export const DUPLICATE_OVERLAP = 0.5 // of the words in the shorter headline
export const DUPLICATE_MIN_SHARED = 3 // but never fewer than this many (fewer, if the headline has fewer)

export type NewsLanguage = Lang
// The sheet's language filter lives in its own small file (the main download needs it, not this one)
export type { NewsFilter }

export type NewsItem = {
  id: number
  url: string
  title: string
  // Short code of where it came from ('adaderana_si', 'dmc_news'...). sourceName() turns it into words.
  source: string
  kind: 'official' | 'media'
  // A fixed official channel ('dmc_situation', 'meteo_sea'...), for the notices that keep coming. null for headlines.
  channel: string | null
  language: NewsLanguage
  hazard: Hazard
  publishedAt: number
  fetchedAt: number
  // When an official notice was withdrawn
  endedAt: number | null
}

// ---- Reading rows ----

// Where each source's links may go. A source this version of the app doesn't know is not shown at
// all, since there is nothing to check its links against.
const DOMAINS = new Map(SOURCES.map((s) => [s.id, s.ownDomains]))

const LANGUAGES: NewsLanguage[] = ['en', 'si', 'ta']
const isLanguage = (v: unknown): v is NewsLanguage => LANGUAGES.includes(v as NewsLanguage)
const isHazard = (v: unknown): v is Hazard => HAZARDS.includes(v as Hazard)
const CODE = /^[a-z0-9_]{2,40}$/

const timeOf = (v: unknown): number | null => {
  if (typeof v !== 'string') return null
  const ms = Date.parse(v)
  return Number.isFinite(ms) ? ms : null
}

// One row of news_items as the app asks for it (see NEWS_COLUMNS in newsFetch.ts), checked
// field by field. null if anything is wrong with it, including a link that isn't https on the
// source's own site. Never throws.
export function parseNewsRow(row: unknown): NewsItem | null {
  try {
    return readRow(row)
  } catch {
    return null
  }
}

function readRow(row: unknown): NewsItem | null {
  if (typeof row !== 'object' || row === null) return null
  const r = row as Record<string, unknown>
  const { id, url, title, source, kind, channel, language, hazard } = r

  if (typeof id !== 'number' || !Number.isSafeInteger(id)) return null
  if (typeof url !== 'string' || typeof title !== 'string' || typeof source !== 'string' || !CODE.test(source)) return null
  if (kind !== 'official' && kind !== 'media') return null
  if (channel !== null && (typeof channel !== 'string' || !CODE.test(channel))) return null
  if (channel !== null && kind !== 'official') return null
  if (!isLanguage(language) || !isHazard(hazard)) return null

  const domains = DOMAINS.get(source)
  if (!domains || !isOwnLink(url, domains)) return null
  const clean = tidyTitle(title)
  if (!clean) return null

  const publishedAt = timeOf(r.published_at)
  const fetchedAt = timeOf(r.fetched_at)
  if (publishedAt === null || fetchedAt === null) return null
  let endedAt: number | null = null
  if (r.ended_at !== null && r.ended_at !== undefined) {
    endedAt = timeOf(r.ended_at)
    if (endedAt === null) return null
  }

  return { id, url, title: clean, source, kind, channel, language, hazard, publishedAt, fetchedAt, endedAt }
}

// A whole answer. null means it is unusable: not a list, or a list where not one row could be read
// (a changed table, say), which is not the same as an empty list. Rows that can't be read are dropped.
export function parseNewsRows(rows: unknown): NewsItem[] | null {
  if (!Array.isArray(rows)) return null
  const seen = new Set<number>()
  const items: NewsItem[] = []
  for (const row of rows) {
    const item = parseNewsRow(row)
    if (item && !seen.has(item.id)) {
      seen.add(item.id)
      items.push(item)
    }
  }
  return rows.length > 0 && items.length === 0 ? null : items
}

// ---- Names ----

// "Disaster Management Centre", "Ada Derana (Sinhala)"... in the person's language. The id itself if
// this version of the app has no name for it, so a new source still shows something.
export function sourceName(source: string): string {
  const key = `news.source.${source}`
  const name = t(key)
  return name === key ? source : name
}

// The name of a fixed official channel: "Situation report", "Severe weather advisory: sea areas"...
export function channelName(channel: string): string {
  const key = `news.channel.${channel}`
  const name = t(key)
  return name === key ? channel : name
}

// "Floods", "Strong winds and rough seas"... the heading of a group of news reports. The code itself
// if there is no name, so a new kind of hazard still shows something.
export function newsHazardName(hazard: string): string {
  const key = `news.hazard.${hazard}`
  const name = t(key)
  return name === key ? hazard : name
}

// "dmc.gov.lk" from a link, for "Read on dmc.gov.lk". The whole link if it can't be read.
export function siteOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

// The official notices that are files (the DMC reports, the Met Department's advisories) say "Open the
// notice (PDF)"; the others are pages
export function isPdfLink(url: string): boolean {
  try {
    return new URL(url).pathname.toLowerCase().endsWith('.pdf')
  } catch {
    return false
  }
}

// ---- Same story from several outlets ----

const STOP_WORDS = new Set([
  'the', 'and', 'for', 'with', 'from', 'into', 'over', 'after', 'amid', 'says', 'said', 'will', 'has', 'have', 'are',
  'was', 'were', 'been', 'this', 'that', 'their', 'its', 'near', 'across', 'about', 'than', 'more', 'also', 'not', 'but',
])
// Written as a pattern string so no invisible character sits in this file
const JOINERS = new RegExp('[\\u200c\\u200d]', 'g')
const PRINTABLE_ASCII = /^[ -~]+$/

// The words of a headline that say what it is about. Latin words are whole words without the small
// ones. Sinhala and Tamil words are cut to their first five letters, because endings stick onto
// words and the same word comes out differently in two outlets. (That cut is a guess by an AI, not
// a native speaker: see DUPLICATE_* above for the numbers to tune.)
export function titleWords(title: string): Set<string> {
  const words = title.normalize('NFC').replace(JOINERS, '').toLowerCase().match(/[\p{L}\p{M}\p{N}]+/gu) ?? []
  const keys = new Set<string>()
  for (const word of words) {
    if (PRINTABLE_ASCII.test(word)) {
      if (word.length > 2 && !STOP_WORDS.has(word)) keys.add(word)
    } else {
      const letters = Array.from(word)
      if (letters.length >= 2) keys.add(letters.slice(0, 5).join(''))
    }
  }
  return keys
}

function similarWords(a: Set<string>, b: Set<string>): boolean {
  const smaller = Math.min(a.size, b.size)
  if (smaller === 0) return false
  let shared = 0
  for (const w of a) if (b.has(w)) shared++
  return shared >= Math.min(DUPLICATE_MIN_SHARED, smaller) && shared / smaller >= DUPLICATE_OVERLAP
}

// ---- Grouping for the sheet ----

export type Story = {
  // The newest headline of the story
  main: NewsItem
  // Every headline of the story, the main one first
  members: NewsItem[]
  // The other outlets that reported it (source codes), newest first: "Also reported by ..."
  also: string[]
}

export type HazardGroup = {
  hazard: Hazard
  total: number
  // The first VISIBLE_PER_HAZARD stories, and the rest behind "Show N more"
  visible: Story[]
  more: Story[]
}

export type GroupedNews = {
  // Official notices: not filtered by language, since they are the ones that matter most
  official: NewsItem[]
  // News reports, by kind of disaster, in the order of HAZARDS
  groups: HazardGroup[]
  // How many stories (not headlines) are in the groups
  storyCount: number
}

export type GroupOptions = {
  now: number
  language?: NewsFilter
  // Older than this is left out. The sheet uses two days.
  maxAgeMs?: number
}

const newer = (a: NewsItem, b: NewsItem) => a.publishedAt - b.publishedAt || a.id - b.id

// Where the official notices go in the list. DMC's emergency warnings first, then the fixed channels in
// this order (the most urgent kinds of notice first), then DMC's other news.
const CHANNEL_ORDER = [
  'meteo_tsunami',
  'meteo_land',
  'meteo_sea',
  'meteo_lightning',
  'meteo_heat',
  'dmc_landslide',
  'dmc_flood',
  'dmc_situation',
]
function officialRank(item: NewsItem): number {
  if (item.source === 'dmc_warnings') return 0
  if (item.channel) {
    const at = CHANNEL_ORDER.indexOf(item.channel)
    return 1 + (at === -1 ? CHANNEL_ORDER.length : at)
  }
  return 100
}

// Some official notices are only good for a day. A landslide warning says "Validity Period: From 16:00
// on 14.11.2026 To 16:00 on 15.11.2026", and the situation and water level reports are a snapshot of
// that day. Past 24 hours from when they were issued they must not look current.
export const OFFICIAL_VALID_MS = 24 * HOUR_MS

// 'current'      still good, or a kind of notice with no 24-hour limit (Met advisories end with their own end time)
// 'maybeExpired' a landslide warning past its 24 hours: it may no longer be valid
// 'older'        a situation or water level report past 24 hours: an older report
export type OfficialAge = 'current' | 'maybeExpired' | 'older'

const TIMED_CHANNELS: Record<string, Exclude<OfficialAge, 'current'>> = {
  dmc_landslide: 'maybeExpired',
  dmc_situation: 'older',
  dmc_flood: 'older',
}

export function officialAge(item: NewsItem, now: number): OfficialAge {
  if (item.kind !== 'official' || !item.channel) return 'current'
  const old = TIMED_CHANNELS[item.channel]
  return old && now - item.publishedAt > OFFICIAL_VALID_MS ? old : 'current'
}

// Newest notice of each fixed channel (a withdrawn one leaves its channel empty, it doesn't bring an
// older one back), and every other official item. Withdrawn ones are hidden. Taking only the newest
// of a channel is also what hides an out-of-date landslide warning when a newer one exists. If the
// newest is itself past its 24 hours it stays, but goes after the current ones.
function pickOfficial(items: NewsItem[], now: number): NewsItem[] {
  const channels = new Map<string, NewsItem>()
  const loose: NewsItem[] = []
  for (const item of items) {
    if (item.kind !== 'official') continue
    if (item.channel) {
      const have = channels.get(item.channel)
      if (!have || newer(item, have) > 0) channels.set(item.channel, item)
    } else if (item.endedAt === null) {
      loose.push(item)
    }
  }
  const picked = [...channels.values()].filter((i) => i.endedAt === null).concat(loose)
  const outOfDate = (i: NewsItem) => (officialAge(i, now) === 'current' ? 0 : 1)
  return picked.sort((a, b) => outOfDate(a) - outOfDate(b) || officialRank(a) - officialRank(b) || newer(b, a))
}

function storiesOf(items: NewsItem[]): Story[] {
  const words = new Map(items.map((i) => [i.id, titleWords(i.title)]))
  const stories: Story[] = []
  // Newest first, so the main headline of a story is its newest. An item is compared with the
  // main headline only, so a long chain of loosely similar headlines can't be joined into one story.
  for (const item of [...items].sort((a, b) => newer(b, a))) {
    const home = stories.find(
      (s) =>
        s.main.language === item.language &&
        s.main.hazard === item.hazard &&
        Math.abs(s.main.publishedAt - item.publishedAt) <= DUPLICATE_WINDOW_MS &&
        similarWords(words.get(s.main.id)!, words.get(item.id)!),
    )
    if (home) home.members.push(item)
    else stories.push({ main: item, members: [item], also: [] })
  }
  for (const story of stories) {
    const others = story.members.slice(1).map((m) => m.source).filter((s) => s !== story.main.source)
    story.also = [...new Set(others)]
  }
  return stories
}

// What the sheet shows. Official notices first (the newest of each fixed channel, and DMC's own
// warnings and news), then the news reports: the same story from several outlets in the same
// language is one story, and stories are grouped by the kind of disaster. The language filter
// applies to the news reports only.
export function groupNews(items: NewsItem[], { now, language = 'all', maxAgeMs = NEWS_WINDOW_MS }: GroupOptions): GroupedNews {
  const recent = items.filter((i) => now - i.publishedAt <= maxAgeMs)
  const official = pickOfficial(recent, now)
  const media = recent.filter((i) => i.kind === 'media' && (language === 'all' || i.language === language))
  const stories = storiesOf(media)

  const groups: HazardGroup[] = []
  for (const hazard of HAZARDS) {
    const inGroup = stories.filter((s) => s.main.hazard === hazard)
    if (inGroup.length === 0) continue
    groups.push({
      hazard,
      total: inGroup.length,
      visible: inGroup.slice(0, VISIBLE_PER_HAZARD),
      more: inGroup.slice(VISIBLE_PER_HAZARD),
    })
  }
  return { official, groups, storyCount: stories.length }
}

// ---- The chip ----

export type NewsChip = {
  // Official notices and news stories of the last 24 hours, in every language, with the same story
  // from several outlets counted once
  count: number
  // An official notice came out in the last 24 hours (and has not been withdrawn or gone out of date)
  officialRecent: boolean
}

export function newsChip(items: NewsItem[], now: number): NewsChip {
  const grouped = groupNews(items, { now, language: 'all', maxAgeMs: NEWS_CHIP_WINDOW_MS })
  // A notice past its 24 hours is on the sheet but not here, and never lights the red dot
  const live = grouped.official.filter((i) => officialAge(i, now) === 'current')
  return { count: live.length + grouped.storyCount, officialRecent: live.length > 0 }
}

// What the News part of the chip and the Layers entry show.
//   null          nothing yet: the first load hasn't finished (or the news feed is off)
//   count: null   the headlines could not be loaded and none are saved: the entry still shows, without
//                 a number, so the sheet can say so and offer Try again
//   count: n      the last 24 hours
export type NewsEntryState = { count: number | null; officialRecent: boolean }

// `hasFailed` means a load has failed at some point, not that one is failing right now: while it tries
// again the query goes back to "pending", and the entry should not vanish and come back.
export function newsEntryState(items: NewsItem[] | undefined, hasFailed: boolean, now: number): NewsEntryState | null {
  if (items) return newsChip(items, now)
  return hasFailed ? { count: null, officialRecent: false } : null
}

// The words on the chip's News part: "News 4", or just "News" when there is nothing to count (or the
// headlines couldn't be loaded). The sheet says what there is.
export function newsPillText(count: number | null): string {
  return count ? t('news.chipCount', { count }) : t('news.chip')
}

// What a screen reader says for it, including the red dot's meaning
export function newsAriaLabel(count: number | null, officialRecent: boolean): string {
  if (!count) return t('news.chipAriaNone')
  return t(officialRecent ? 'news.chipAriaOfficial' : 'news.chipAria', { count })
}
