// For testing only. In the dev server, ?fakeNews= replaces the news headlines with sample ones, so the
// news sheet and chip can be tried on a quiet day without the table or the news sites being involved.
// Several can be given at once, separated by commas: ?fakeNews=official,advisory,media
//   official  DMC's own warning, plus its situation report, landslide warning and water level report
//   advisory  Met Department advisories for sea and land, and a lightning one that has been withdrawn
//   media     English news reports across the kinds of disaster (rain, wind and sea, flood, landslide...)
//   alllang   Sinhala and Tamil news reports (add media to get English too)
//   dupes     one story from two outlets in English and from three in Sinhala (they group into one each)
//   many      six different rain stories, so "Show 3 more" appears (not part of "all")
//   long      a Tamil headline over 300 characters (it is cut)
//   ended     two withdrawn official notices (hidden)
//   old       one report 47 hours old (still shown) and others over 48 hours old (hidden)
//   empty     no headlines at all
//   fail      the load fails ("News unavailable right now")
//   all       official, advisory, media, alllang and dupes. Also what ?fakeNews or ?fakeNews=1 means.
// Every headline starts with "TEST ·" and is made-up wording. The rows are shaped like the real table's
// and go through the same checks as real ones (parseNewsRows). Saved data is not touched: with any
// fake switch on, only the forecast is saved (see main.tsx). loadNews only loads this file inside an
// import.meta.env.DEV check, so the production build leaves it out.

import { parseNewsRows, type NewsItem } from './news'
import { SOURCES } from '../../supabase/functions/news-refresh/sources'

export const FAKE_NEWS_MODES = ['official', 'advisory', 'media', 'alllang', 'dupes', 'many', 'long', 'ended', 'old', 'empty', 'fail'] as const
export type FakeNewsMode = (typeof FAKE_NEWS_MODES)[number]

const ALL: FakeNewsMode[] = ['official', 'advisory', 'media', 'alllang', 'dupes']

// The modes asked for, or null when the switch is not in the address
export function fakeNewsModes(search?: string): FakeNewsMode[] | null {
  const query = search ?? (globalThis.location ? globalThis.location.search : '')
  const value = new URLSearchParams(query).get('fakeNews')
  if (value === null) return null
  const wanted = value.split(',').map((v) => v.trim().toLowerCase())
  if (wanted.includes('all') || wanted.includes('1') || wanted.every((v) => v === '')) return ALL
  const found = FAKE_NEWS_MODES.filter((m) => wanted.includes(m))
  return found.length > 0 ? found : ALL
}

type Spec = {
  source: string
  title: string
  minutesAgo: number
  hazard: string
  language?: 'en' | 'si' | 'ta'
  kind?: 'official' | 'media'
  channel?: string
  // A withdrawn notice: how long ago
  endedMinutesAgo?: number
  path?: string
}

const MIN = 60_000
const HOUR = 60

const media = (source: string, language: 'en' | 'si' | 'ta', hazard: string, minutesAgo: number, title: string): Spec => ({
  source,
  language,
  hazard,
  minutesAgo,
  title: `TEST · ${title}`,
})
const notice = (source: string, channel: string, hazard: string, minutesAgo: number, title: string, endedMinutesAgo?: number): Spec => ({
  source,
  channel,
  hazard,
  minutesAgo,
  title: `TEST · ${title}`,
  kind: 'official',
  language: 'en',
  endedMinutesAgo,
})

const SETS: Record<Exclude<FakeNewsMode, 'empty' | 'fail'>, Spec[]> = {
  official: [
    { source: 'dmc_warnings', kind: 'official', language: 'en', hazard: 'other', minutesAgo: 30, title: 'TEST · Public warning for the Kelani river basin' },
    notice('dmc_flood', 'dmc_flood', 'flood', 90, 'Water level & Rainfall'),
    notice('dmc_situation', 'dmc_situation', 'other', 4 * HOUR, 'Situation Report'),
    notice('dmc_landslide', 'dmc_landslide', 'landslide', 6 * HOUR, 'Landslide Warning'),
  ],
  advisory: [
    notice('meteo_advisory', 'meteo_sea', 'wind_sea', 3 * HOUR, 'Severe weather advisory: sea areas'),
    notice('meteo_advisory', 'meteo_land', 'rain', 5 * HOUR, 'Severe weather advisory: land areas'),
    notice('meteo_advisory', 'meteo_lightning', 'rain', 8 * HOUR, 'Lightning advisory', 60),
  ],
  media: [
    media('adaderana_en', 'en', 'rain', 40, 'Heavy rain lashes Galle district overnight'),
    media('dailymirror', 'en', 'wind_sea', 2 * HOUR, 'Fishermen told to stay ashore as rough seas build off the south coast'),
    media('adaderana_en', 'en', 'flood', 5 * HOUR, 'Families moved to safety as the river rises in Ratnapura'),
    media('dailymirror', 'en', 'landslide', 9 * HOUR, 'Landslide warning extended to four districts'),
    media('adaderana_en', 'en', 'elephant', 20 * HOUR, 'Wild elephant attack leaves farmer injured near Ampara'),
    media('dailymirror', 'en', 'road', 26 * HOUR, 'Fallen tree blocks the Kandy road for three hours'),
  ],
  alllang: [
    media('adaderana_si', 'si', 'rain', HOUR, 'පළාත් කිහිපයකට තද වැසි'),
    media('lankadeepa', 'si', 'flood', 3 * HOUR, 'ගාල්ල ප්‍රදේශයේ ගංවතුරෙන් පවුල් අවතැන් වෙයි'),
    media('divaina', 'si', 'landslide', 10 * HOUR, 'නායයෑම් අනතුරු ඇඟවීම් දිස්ත්‍රික්ක හතරකට'),
    media('adaderana_ta', 'ta', 'cyclone', 90, 'வங்கக்கடலில் தாழமுக்கம் உருவாகிறது'),
    media('tamilmirror', 'ta', 'landslide', 4 * HOUR, 'மண்சரிவு அபாய எச்சரிக்கை நீடிப்பு'),
  ],
  dupes: [
    media('adaderana_en', 'en', 'rain', 25, 'Heavy rain warning issued for seven provinces'),
    media('dailymirror', 'en', 'rain', 50, 'Warning issued over heavy rain in seven provinces'),
    media('adaderana_si', 'si', 'flood', 35, 'රත්නපුර දිස්ත්‍රික්කයේ ගංවතුර අවදානම'),
    media('lankadeepa', 'si', 'flood', 55, 'රත්නපුර දිස්ත්‍රික්කයේ ගංවතුර අවදානමක්'),
    media('divaina', 'si', 'flood', 80, 'රත්නපුරයේ ගංවතුර අවදානම ඉහළයි'),
  ],
  many: [
    media('adaderana_en', 'en', 'rain', 12, 'Showers over the hill country for a third day'),
    media('dailymirror', 'en', 'rain', 31, 'Evening thunder rattles the western coast'),
    media('adaderana_en', 'en', 'rain', 58, 'Schools in the north close early as downpours settle in'),
    media('dailymirror', 'en', 'rain', 3 * HOUR, 'Paddy farmers watch a swollen tank nervously'),
    media('adaderana_en', 'en', 'rain', 7 * HOUR, 'Umbrellas sell out across the capital'),
    media('dailymirror', 'en', 'rain', 15 * HOUR, 'Night storm knocks out power on the east coast'),
  ],
  long: [media('tamilmirror', 'ta', 'landslide', 15, 'மண்சரிவு அபாய எச்சரிக்கை '.repeat(14).trim())],
  ended: [
    notice('meteo_advisory', 'meteo_tsunami', 'tsunami', 6 * HOUR, 'Tsunami warning', 60),
    notice('meteo_advisory', 'meteo_heat', 'other', 20 * HOUR, 'Heat advisory', 5 * HOUR),
  ],
  old: [
    media('adaderana_en', 'en', 'rain', 47 * HOUR, 'Showers ease after a wet weekend, says the weather office'),
    media('dailymirror', 'en', 'flood', 50 * HOUR, 'River levels fall in the Kelani basin'),
    notice('dmc_situation', 'dmc_situation', 'other', 49 * HOUR, 'Situation Report'),
  ],
}

function toRow(spec: Spec, id: number, now: number): Record<string, unknown> {
  const source = SOURCES.find((s) => s.id === spec.source)
  if (!source) throw new Error(`fakeNews: no source ${spec.source}`)
  const publishedAt = now - spec.minutesAgo * MIN
  const path = spec.channel ? `images/test/${spec.channel}-${id}.pdf` : `news/test-${id}`
  return {
    id,
    url: `https://${source.ownDomains[0]}/${spec.path ?? path}`,
    title: spec.title,
    source: spec.source,
    kind: spec.kind ?? 'media',
    channel: spec.channel ?? null,
    language: spec.language ?? 'en',
    hazard: spec.hazard,
    published_at: new Date(publishedAt).toISOString(),
    fetched_at: new Date(Math.min(now, publishedAt + 2 * MIN)).toISOString(),
    ended_at: spec.endedMinutesAgo === undefined ? null : new Date(now - spec.endedMinutesAgo * MIN).toISOString(),
  }
}

// The sample headlines for these modes, as the app would read them from the table. Throws for
// "fail", which is how a failed load looks to the query.
export function fakeNews(modes: FakeNewsMode[], now: number): NewsItem[] {
  if (modes.includes('fail')) throw new Error('fakeNews=fail: pretending the news could not be loaded')
  const specs = modes.flatMap((m) => (m === 'empty' || m === 'fail' ? [] : SETS[m]))
  // Newest first, like the table is read
  const rows = specs.map((spec, i) => toRow(spec, 9000 + i, now)).sort((a, b) => String(b.published_at).localeCompare(String(a.published_at)))
  return parseNewsRows(rows) ?? []
}
