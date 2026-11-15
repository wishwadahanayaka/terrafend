// Where the news feed comes from. Each one was checked by hand on 15 Nov 2026 (its robots.txt, its
// feed or page, and any terms): see docs/news-feed-plan.md for what each check found.
// No imports and nothing Deno-only, so the tests can load it.
//
// To stop asking a source (for example because its owner asks), set enabled: false and redeploy.
// Its stored headlines can then be removed with:
//   delete from public.news_items where source = '<id>';

export type Lang = 'en' | 'si' | 'ta'

export type Source = {
  // Stored in news_items.source and news_source_state.source
  id: string
  url: string
  kind: 'official' | 'media'
  // 'detect' reads the language from each headline's letters (DMC mixes Sinhala and English)
  language: Lang | 'detect'
  // rss: an RSS or Atom feed. dmcList: one of DMC's report tables (title, date, time, PDF).
  // meteoJson: the Met Department's content.json, whose advisory fields are only filled while an
  // advisory is out.
  parser: 'rss' | 'dmcList' | 'meteoJson'
  // How often to ask, in minutes. Never less than crawlDelayMin.
  everyMin: number
  // What the site's robots.txt asked for (Crawl-delay) when it was checked, in minutes. 0 if nothing.
  // The function also reads robots.txt once a day and goes by whichever is longer.
  crawlDelayMin: number
  // How long to wait for each request to this source's site (its robots.txt and its feed or page), in
  // ms. Leave it out for the normal 10 s (FETCH_TIMEOUT_MS in logic.ts). A request is also cut short
  // when the run is nearly out of time, whatever is set here.
  timeoutMs?: number
  // Links must be on one of these (or www. in front of one), over https
  ownDomains: string[]
  // keywords: only headlines judge() keeps. none: every item (official warning channels).
  filter: 'keywords' | 'none'
  // A fixed official channel ('dmc_situation'...). The app names it in the person's language.
  channel?: string
  enabled: boolean
}

const DMC = 'https://www.dmc.gov.lk/index.php'
const dmcList = (itemid: number, type: number) =>
  `${DMC}?option=com_dmcreports&view=reports&Itemid=${itemid}&report_type_id=${type}&lang=en`

export const SOURCES: Source[] = [
  // Official
  {
    id: 'dmc_warnings',
    url: `${DMC}?option=com_content&view=category&layout=blog&id=16&Itemid=237&format=feed&type=rss&lang=en`,
    kind: 'official',
    language: 'detect',
    parser: 'rss',
    everyMin: 15,
    crawlDelayMin: 0,
    ownDomains: ['dmc.gov.lk'],
    filter: 'none',
    enabled: true,
  },
  {
    id: 'dmc_news',
    url: `${DMC}?option=com_content&view=category&layout=blog&id=8&Itemid=193&format=feed&type=rss&lang=en`,
    kind: 'official',
    language: 'detect',
    parser: 'rss',
    everyMin: 60,
    crawlDelayMin: 0,
    ownDomains: ['dmc.gov.lk'],
    filter: 'keywords',
    enabled: true,
  },
  {
    id: 'dmc_situation',
    url: dmcList(273, 1),
    kind: 'official',
    language: 'en',
    parser: 'dmcList',
    everyMin: 60,
    crawlDelayMin: 0,
    ownDomains: ['dmc.gov.lk'],
    filter: 'none',
    channel: 'dmc_situation',
    enabled: true,
  },
  {
    // NBRO's landslide early warnings, as DMC publishes them
    id: 'dmc_landslide',
    url: dmcList(276, 5),
    kind: 'official',
    language: 'en',
    parser: 'dmcList',
    everyMin: 60,
    crawlDelayMin: 0,
    ownDomains: ['dmc.gov.lk'],
    filter: 'none',
    channel: 'dmc_landslide',
    enabled: true,
  },
  {
    id: 'dmc_flood',
    url: dmcList(277, 6),
    kind: 'official',
    language: 'en',
    parser: 'dmcList',
    everyMin: 60,
    crawlDelayMin: 0,
    ownDomains: ['dmc.gov.lk'],
    filter: 'none',
    channel: 'dmc_flood',
    enabled: true,
  },
  {
    // Off (15 Nov 2026): meteo.gov.lk times out from Supabase even at 25 s. Not to be got round.
    id: 'meteo_advisory',
    url: 'https://meteo.gov.lk/content.json',
    kind: 'official',
    language: 'en',
    parser: 'meteoJson',
    everyMin: 15,
    crawlDelayMin: 0,
    timeoutMs: 25_000,
    ownDomains: ['meteo.gov.lk'],
    filter: 'none',
    enabled: false,
  },

  // News sites
  {
    id: 'adaderana_en',
    url: 'https://adaderana.lk/rss.xml',
    kind: 'media',
    language: 'en',
    parser: 'rss',
    everyMin: 15,
    crawlDelayMin: 0,
    ownDomains: ['adaderana.lk'],
    filter: 'keywords',
    enabled: true,
  },
  {
    id: 'adaderana_si',
    url: 'https://sinhala.adaderana.lk/rss.xml',
    kind: 'media',
    language: 'si',
    parser: 'rss',
    everyMin: 15,
    crawlDelayMin: 0,
    ownDomains: ['sinhala.adaderana.lk'],
    filter: 'keywords',
    enabled: true,
  },
  {
    id: 'adaderana_ta',
    url: 'https://adaderanatamil.lk/rss.xml',
    kind: 'media',
    language: 'ta',
    parser: 'rss',
    everyMin: 15,
    crawlDelayMin: 0,
    ownDomains: ['adaderanatamil.lk'],
    filter: 'keywords',
    enabled: true,
  },
  {
    // robots.txt: Crawl-delay: 3600
    id: 'dailymirror',
    url: 'https://www.dailymirror.lk/rss/breaking_news/108',
    kind: 'media',
    language: 'en',
    parser: 'rss',
    everyMin: 60,
    crawlDelayMin: 60,
    ownDomains: ['dailymirror.lk'],
    filter: 'keywords',
    enabled: true,
  },
  {
    // robots.txt: Crawl-delay: 3600
    id: 'lankadeepa',
    url: 'https://www.lankadeepa.lk/rss/latest_news/1',
    kind: 'media',
    language: 'si',
    parser: 'rss',
    everyMin: 60,
    crawlDelayMin: 60,
    ownDomains: ['lankadeepa.lk'],
    filter: 'keywords',
    enabled: true,
  },
  {
    // robots.txt: Content-Signal: search=yes, ai-train=no, use=reference. Headlines and links, no AI.
    id: 'tamilmirror',
    url: 'https://www.tamilmirror.lk/rss/news/175',
    kind: 'media',
    language: 'ta',
    parser: 'rss',
    everyMin: 30,
    crawlDelayMin: 0,
    ownDomains: ['tamilmirror.lk'],
    filter: 'keywords',
    enabled: true,
  },
  {
    // A daily paper: the feed changes overnight
    id: 'divaina',
    url: 'https://www.divaina.lk/feed',
    kind: 'media',
    language: 'si',
    parser: 'rss',
    everyMin: 120,
    crawlDelayMin: 0,
    ownDomains: ['divaina.lk'],
    filter: 'keywords',
    enabled: true,
  },
  {
    // Off (15 Nov 2026): thinakaran.lk returns 403 to Supabase. Not to be got round.
    id: 'thinakaran',
    url: 'https://www.thinakaran.lk/feed/',
    kind: 'media',
    language: 'ta',
    parser: 'rss',
    everyMin: 60,
    crawlDelayMin: 0,
    ownDomains: ['thinakaran.lk'],
    filter: 'keywords',
    enabled: false,
  },
]

// Not used, and why (checked 15 Nov 2026). Kept here so nobody adds them back without checking again.
// - Lankapuvath (english./sinhala./tamil.lankapuvath.lk/feed/): HTTP 500 "Database Error". Try again later.
// - news.lk: every request gets a JavaScript challenge (Sucuri), so a server can't read it. Not to be got round.
// - NewsFirst (/feed on every subdomain): 403. Not to be got round.
// - The Morning: no feed (/feed, /rss.xml, /sitemap.xml are 404) and its pages say noindex, nofollow.
// - NBRO/NBRI warnings feed: works, but its newest item is from Nov 2025. Its warnings reach DMC's list.
// - Irrigation Department feed: only four site pages from 2023 and 2024.
