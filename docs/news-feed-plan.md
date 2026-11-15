# Disaster news feed: plan

Recent disaster-related headlines for Sri Lanka (floods, landslides, cyclones, heavy rain, evacuations,
road closures, wild elephants on roads), official sources first, refreshed every 15 minutes. Headline,
source, time and link only. Never the article text.

Approved 15 Nov 2026, with these changes to the first draft:

- The migration is **0010** (`0010_news_feed.sql`), because it runs first. The photo-path cleanup that
  was planned as 0010 (for about 29 Nov 2026) becomes **0011**.
- The User-Agent's contact is the GitHub repository, not an email address.
- The AI-written Sinhala and Tamil keyword lists are used for now, clearly marked for native review.
  The owner reviews the Sinhala list using the real kept and missed headlines while the feed is watched.

## Status

| Step | What | Status |
|---|---|---|
| 1 | Review the sources (this document) | done |
| 2 | Function logic and tests (`supabase/functions/news-refresh/`) | **built**, not deployed |
| 3 | Migration 0010, `supabase/checks/0010_check.sql`, privacy checks 6 and 17, `docs/news-feed.md` | **built**, not run |
| 4 | Run 0010, deploy, set the secrets, dry run, watch for 2 to 3 days, tune the keywords | **in progress**: 0010 run, deployed, cron running from 15 Nov 2026. Two sources are switched off (`enabled: false`, 15 Nov 2026): `meteo_advisory` (meteo.gov.lk times out from Supabase even at 25 s) and `thinakaran` (403 to Supabase), leaving 12 read; code and tests kept. Owner reviews the Sinhala headlines with the command in `docs/news-feed.md` (Sinhala sources kept 0 on the first run). |
| 5a | App logic: reading the table, the query hook, grouping, chip numbers, source names, `?fakeNews=`, offline (24 h, not in the banner), tests | **built** (`news.ts`, `newsFetch.ts`, `useNews.ts`, `fakeNews.ts`); no UI |
| 5b | App screens: the sheet, the chip part and the Layers entry behind `?news=1`, UI text in en/si/ta | **built** (`NewsSheet.tsx`, `NewsEntry.tsx`, `ThreatChip.tsx`, `newsFlag.ts`); shown only with `?news=1` |
| 6 | Switch on for everyone: set `NEWS_FOR_EVERYONE = true` in `src/lib/newsFlag.ts` (one line), add the README credit, update CLAUDE.md | not done: test on the live site with `?news=1` first |
| 7 | Later: Lankapuvath when it's back, NBRO with the landslide layer, news pins | not planned in detail |

Native review of the Sinhala and Tamil keyword lists runs alongside steps 4 and 5.

## 1. Sources

Checked by fetching each robots.txt, feed or page on 15 Nov 2026 (about 2:55 pm Sri Lanka time).

| # | Source | URL | Type | Lang | Method | Verified | Notes |
|---|---|---|---|---|---|---|---|
| 1 | DMC Emergency Warnings | `dmc.gov.lk/index.php?option=com_content&view=category&layout=blog&id=16&Itemid=237&format=feed&type=rss&lang=en` | official | en (also `lang=si`/`ta`) | RSS | yes | Works, **0 items today** ("There are no articles in this category"). No robots.txt (redirects to the homepage). "© DMC. All Rights Reserved", no terms page found. `no-cache`. Every 15 min, unfiltered. |
| 2 | DMC News | same with `id=8&Itemid=193` | official | si or en per item | RSS | yes | 9 items, newest 12 Nov. Includes workshops and MoUs, so it is filtered. Hourly. |
| 3 | DMC report lists: Situation Report (`Itemid=273`), Landslide Warning (`276`), Water level & Rainfall (`277`) | `dmc.gov.lk/index.php?option=com_dmcreports&view=reports&Itemid=…&lang=en` | official | en | HTML table (no feed: `format=feed` is 404) | yes | Title / Date / Time / PDF link. Landslide warnings are NBRO's messages (`LEWM_…pdf`). Daily, water levels 3 a day, so only the newest of each is kept. Medium fragility: a template change breaks it, 0 rows is reported as an error. Hourly. |
| 4 | Met Department severe weather advisories | `meteo.gov.lk/content.json` | official | en | JSON (the site's own data file) | yes | `severe_weather_advisory.{land,sea,lighting,tsunami,heat}_pdf`, empty string = none. **`sea_pdf` set today.** Fixed PDF names overwritten per issue. ETag + Last-Modified. No robots.txt. Medium-high fragility (not a public API). Every 15 min. **Switched off 15 Nov 2026**: times out from Supabase even at 25 s (works from a home PC). |
| 5 | NBRO (now NBRI; nbro.gov.lk → nbri.gov.lk) warnings | `nbri.gov.lk/index.php?option=com_content&view=category&id=20&format=feed&type=rss` | official | en | RSS | yes, stale | Newest item 7 Nov 2025. Live warnings come through DMC (row 3). **Not used.** robots.txt only blocks admin folders. |
| 6 | Irrigation Department | `irrigation.gov.lk/web/index.php?format=feed&type=rss` | official | en | RSS | yes, not useful | 4 site pages from 2023–2024. No robots.txt. **Not used.** |
| 7 | Lankapuvath | `english./sinhala./tamil.lankapuvath.lk/feed/` | official | all | RSS (WordPress) | **no** | HTTP 500 "Database Error" on all three. robots.txt is only Cloudflare's content-signal preamble. Retry later. |
| 8 | news.lk (Government Information) | `news.lk` | official | – | – | **no** | robots.txt allows, but every request gets a Sucuri JavaScript challenge. Not to be got round. |
| 9 | Ada Derana | `https://adaderana.lk/rss.xml` (`rss.php` redirects) | media | en | RSS | yes | 25 items. robots.txt blocks only Bytespider. Every 15 min. |
| 10 | Ada Derana Sinhala | `https://sinhala.adaderana.lk/rss.xml` | media | si | RSS | yes | 25 items (`rsshotnews.php` is 403). Every 15 min. |
| 11 | Ada Derana Tamil | `https://adaderanatamil.lk/rss.xml` | media | ta | RSS | yes | 70 items. robots.txt blocks only `/api/`. Every 15 min. |
| 12 | Daily Mirror | `https://www.dailymirror.lk/rss/breaking_news/108` | media | en | RSS | yes | 12 items. **Crawl-delay: 3600**: hourly. Dates have **no time zone** (Sri Lanka time). Terms: reproduce "only by giving the due courtesy to 'dailymirror.lk'". |
| 13 | Lankadeepa | `https://www.lankadeepa.lk/rss/latest_news/1` | media | si | RSS | yes | 12 items, served as text/html. **Crawl-delay: 3600**: hourly. |
| 14 | Tamil Mirror | `https://www.tamilmirror.lk/rss/news/175` | media | ta | RSS | yes | One item appears twice. `Content-Signal: search=yes, ai-train=no, use=reference`; blocks AI crawlers by name. Headline + link, no AI: fits. Every 30 min. |
| 15 | Divaina | `https://www.divaina.lk/feed` | media | si | RSS | yes | Daily paper, changes overnight. 65 KB (full text, discarded). ETag. Every 2 h. |
| 16 | Thinakaran | `https://www.thinakaran.lk/feed/` | media | ta | RSS | yes | ETag. No robots.txt. Hourly. **Switched off 15 Nov 2026**: 403 to Supabase (works from a home PC). |
| 17 | NewsFirst | `/feed` (every subdomain) | media | – | – | **no** | 403 everywhere. Not to be got round. |
| 18 | The Morning | `/feed`, `/rss.xml`, `/sitemap.xml` | media | – | – | **no** | All 404; homepage says `noindex,nofollow`. |
| 19 | Virakesari, Hiru News | guessed `/rss` paths | media | ta, si | – | **no** | No feed found. Virakesari asks for Crawl-delay 20. |

## 2. Filtering (no paid AI)

**Before matching:** NFC, remove zero-width joiners (U+200C/U+200D) from both the headline and the list
word (Sinhala ශ්‍රී has one, so a word typed without it would miss), collapse spaces, lowercase.

**Matching:** English matches whole words, with a `*` for endings (`evacuat*`). Sinhala and Tamil match
stems anywhere, because endings stick onto words; a `|` at the end means the word must end there.
Tamil stems stop before a final `்` or vowel sign that an ending changes (கடல் → கடலுக்கு, so the stem is
கடல).

**Scoring:** strong term +2 (names the hazard), weak term +1 each, but two weak words only add up when
one of them names a hazard ("warning" + "alert" alone is not enough), negative phrase −3, foreign place
−3 unless Sri Lanka, a district or a province is also named (cyclones and tsunamis skip this rule: a
storm off India can still reach the island), link in a world section (`/international/`, `/world/`,
உலக) dropped. Kept at **2**. Elephant words count as strong only with an incident word (attack, killed,
road, train…), otherwise weak. Each item gets one hazard tag (tsunami, cyclone, landslide, flood,
earthquake, wind_sea, rain, elephant, road, drought, other, in that order of priority; a named hazard
beats "other").

The lists are in `supabase/functions/news-refresh/keywords.ts`. Sinhala and Tamil are AI-written and
marked **NEEDS REVIEW BY A NATIVE SPEAKER**. Traps found while writing them: வெள்ள (flood) also starts
வெள்ளை (white) and வெள்ளி (Friday), so only fuller flood words are used; වැසි (rain) is inside වැසියන්
(residents); මිල (price) starts මිලියන (million); காலி (Galle) also means "empty"; English "us".

**Tried on 15 Nov 2026's real headlines** (185 across 9 feeds, a depression in the Bay of Bengal that
day): 16 kept, all weather or disaster related, including "Red warning issued over strong winds and
rough seas", පළාත් 7කට දැඩි වැසි, தென்கிழக்கு வங்கக்கடலில் உருவானது தாழமுக்கம், and both Tamil "fishermen,
don't go to sea" warnings. A politician's call to protect tuskers was dropped (no incident word). Two DMC
News items about a flood MoU and a tsunami board are kept (official news about hazards). Near-miss:
"மழைக்கு எதிர்வுகூறல்" (rain forecast for some provinces) scores 1.

**Official items:** DMC Emergency Warnings, DMC's report tables and the Met advisories are kept whole.
DMC News is filtered.

**Duplicates:** the same link is one row (the unique `item_key`; also absorbs Tamil Mirror's doubled
item; across sources the first in the list wins, officials come first). The same story from several
outlets is grouped in the app (step 5): same language, same hazard, within 36 hours, word sets
overlapping at least 50% become one row ("Also reported by …"). Across languages, the sheet shows 3
headlines per hazard and a "Show N more", with a language filter.

## 3. Backend (built)

Edge Function `news-refresh` (pattern of `forecast-refresh`: pure `logic.ts`, `index.ts` only wiring),
secret `NEWS_SECRET` + Vault `news_secret`, `--no-verify-jwt`, pg_cron at minutes 4, 19, 34, 49 (away from
the cleanup at :00 and the forecast at :23). Setup: `docs/news-feed.md`.

```
supabase/functions/news-refresh/
  sources.ts   the list above: id, url, kind, language ('detect' for DMC), parser
               ('rss' | 'dmcList' | 'meteoJson'), everyMin, crawlDelayMin, ownDomains, filter, channel
  keywords.ts  the three languages' lists, negatives, foreign and home words, hazards
  logic.ts     parseFeed (RSS 2.0 + Atom, CDATA, entities), parseDmcList, parseMeteo, judge,
               cleanTitle, normaliseUrl, parseDate/publishedAt, robotsVerdict, isDue,
               refresh(deps, {force, dryRun, only}), readCapped
  index.ts     secret check, POST only, fetch (manual redirects, 10 s timeout, 25 s for meteo_advisory only, 1 MB cap), Supabase writes
```

- User-Agent: `TerraFend/1.0 (+https://terrafend.vercel.app; free Sri Lanka hazard map; contact: https://github.com/wishwadahanayaka/terrafend)`.
- Each source: skipped until its interval has passed (one minute of slack for the cron's timing, never
  taken off a robots.txt Crawl-delay); `If-None-Match`/`If-Modified-Since`, a 304 is nothing to do; 10 s
  timeout, at most 3 redirects and only within its own site, 1 MB cap, 50 items.
- 4 at a time; one failure never stops the others. After 3 failures in a row, hourly; after a 403/410,
  daily. No run starts a source after 45 s.
- robots.txt re-read once a day per site, once per site per run. A disallow pauses the source. If it
  can't be read, the last answer stands; with none, the source waits for the next run. A Crawl-delay
  after the Sitemap line (Daily Mirror, Lankadeepa) counts for everyone.
- Times: no zone means Sri Lanka time; future times become the run's time; over 7 days old is dropped.
  `Date.parse` accepts nonsense ("yesterday" came out as the year 530), so a time needs a four-digit
  year and has to land between 2000 and 2100.
- Links must be https on the source's own site (http on the own site is moved to https); tracking
  parameters and `#` parts are dropped.
- Met advisories: key `meteo:<field>:<PDF ETag>` (a HEAD request), so a new issue is a new row; a field
  that empties (or a new issue) sets `ended_at` on the old one.
- `?dry_run=true` stores nothing, sends no caching headers, and lists `items` and `dropped` (for tuning).
  `?only=<id>` runs one source. `?force=true` ignores intervals (not robots.txt).

### Migration 0010 (built, not run)

`supabase/migrations/0010_news_feed.sql`: `news_items` (unique `item_key`, `url`, `title`, `source`,
`kind`, `channel`, `language`, `hazard`, `published_at`, `fetched_at`, `ended_at`, `place_name`,
`location`, `score`, `matched`), RLS with a public select policy, a column grant for the app,
`news_source_state` closed to the API, `run_news_refresh()` (security definer, Vault), and the cron jobs
`news-refresh` and `news-cleanup` (deletes after 7 days). Checks: `supabase/checks/0010_check.sql`, and
`privacy.sql` check 6 (lists `news_items`) and check 17 (read-only, private columns, state table closed).

Differences from the first draft, found while building:

- `url` and `item_key` allow **2048** characters, not 1000: a Tamil Mirror link with its Tamil slug
  percent-encoded was already 779.
- `item_key` is **not** in the app's column grant (neither was it in the draft's list; the test now says
  so on purpose). The app has `url`; the key is internal (the Met keys are not links).
- `news_source_state.memo` also holds the robots.txt Crawl-delay last read.

## 4. Live updates: refetch, not Realtime

The app (step 5) refetches every 10 minutes while open, every 5 while the sheet is open, and on coming
back to the foreground. Realtime is not used: the data only changes every 15 minutes; the free plan
allows about 200 concurrent Realtime connections, and a disaster is exactly when many people open the app
at once; iOS closes websockets of a backgrounded web app, so it would refetch on resume anyway; and the
table would have to join the Realtime publication. A plain `fetch` with only the `apikey` header (like
`forecastCache.ts`), named columns, the last 48 hours, at most 100 items.

## 5. App (5a, the logic, and 5b, the screens, are built)

Decided while building the logic (5a):

- The official block always shows in full: the language filter applies to the news reports only, since
  the official notices are the ones that matter and are mostly English PDFs.
- Official items without a channel (DMC's warnings and news) all show, not only the newest; only the
  fixed channels show their newest notice.
- Duplicates: same language, same hazard, within 36 hours, at least half the words of the shorter
  headline and at least 3 shared words, compared with the story's newest headline only. Sinhala and
  Tamil words are cut to five letters first. Two headlines that differ only in a place name can still
  merge; the numbers are named constants in `news.ts`.
- The chip counts stories and notices of the last 24 hours in every language, the same story once.
- The read asks for official rows first (`order=kind.desc,...`), so the 100-row limit can't push them out.
- The saved news is kept 24 hours; the saved file's age limit is raised to match, and every other query
  keeps its own 6-hour (forecast 3-hour) limit.

- Entry: a "News" part at the end of the threats chip ("No active threats · News 4"), newspaper icon,
  a red dot when an official item came in within 24 hours. An outlined pill so it doesn't read as a
  threat; `fitParts` reserves its room so it never falls into "+N more". No toolbar room needed (there is
  none at 320 px in Tamil). Second way in: "Disaster news (4) ›" under "Serious right now" in the Layers panel.
- Sheet (like My reports): "Disaster news", "Updated 4:15 pm", X; language filter All / EN / සිං / த
  (remembered).
- Official block first: blue left border, shield icon, newest item per channel only, last 48 hours,
  never one with `ended_at`. "Official: Department of Meteorology · Severe weather advisory: sea areas ·
  issued 2:05 pm · Open the notice (PDF)". Channel names translated.
- News reports, grouped by hazard, 3 per hazard then "Show N more": headline in its own language with
  `lang` and a small EN/සිං/த label; "Ada Derana · 25 min ago"; a grey "News report, not an official
  warning"; "Also reported by …"; links in a new tab with `noopener noreferrer`, checked again against the
  source's own domain.
- Footer: "Headlines are picked automatically by keywords, so some may be unrelated and some may be
  missed." / "Not an official warning. Follow DMC for official alerts." / Emergency numbers link.
- Offline: "Offline: showing headlines saved at 4:15 pm." (saved query, its own 24-hour limit, not part
  of the offline banner's "data from"). Empty: "No disaster news in the last 2 days." Error: "News
  unavailable right now" + Try again.
- All text in en/si/ta (`news.*`), si/ta marked for review. Headlines are data, so the "never expect"
  wording test doesn't apply to them.
- Dev fakes: `?fakeNews=official|advisory|media|dupes|alllang|long|ended|old|empty|fail` (dev only,
  removed from production).

## 6. News pins later

`place_name` and `location` exist (same Sri Lanka bounds as `reports`) and are in the column grant.
Later work only fills them (for example by matching district and town names) and draws them.

## Data size and cost

- A run reads at most about 440 KB (usually much less: intervals and 304s), 15–40 MB a day in all.
- Stored: perhaps 20–60 items a day in a disaster, about 0.6 KB each: under 0.5 MB for 7 days.
- About 2,900 function runs a month (free plan: about 500,000). App reads in step 5: about 10 KB a
  refetch; 100 daily users open for 2 hours at one refetch every 10 minutes is about 360 MB a month (free
  plan: 5 GB egress). Cost $0. If egress ever matters, ask only for rows newer than the last `id`.
- Free-plan figures are from third-party summaries (supabase.com could not be read when this was
  written); check supabase.com/pricing.

## Tests (built for steps 2–3)

No real network or Supabase; every headline is made up.

- `src/lib/newsRefresh.test.ts`: the secret; titles (CDATA, entities twice, tags, control and direction
  characters, the joiner kept, 300 characters); links (own site, www, http→https, look-alikes,
  `javascript:`, login parts, ports, tracking parameters, Tamil paths, 2048 cap); times (each format,
  zone-less as Sri Lanka time, nonsense, the 7-day rule); RSS and Atom parsing (no description ever
  read); DMC tables; Met fields; robots.txt (groups, longest rule, `*` and `$`, Crawl-delay after the
  Sitemap line, an HTML page); when a source is due (slack, Crawl-delay, backoff, 403); whole runs with
  stand-ins (stored rows, one source failing, all failing, caching headers and 304, dry run, force, only,
  disabled, state unreadable, time budget, robots disallow/once per site/unreadable, redirects, size cap,
  HTML instead of a feed, 403, bad links, old and future items, duplicates, the 50 cap, official
  channels unfiltered, DMC News filtered, first source wins, DMC newest only and layout change, Met
  issue/end/new issue/fallback/304, write failures); body reading; the source list; index.ts wiring.
- `src/lib/newsKeywords.test.ts`: kept and dropped headlines in all three languages, the traps above,
  zero-width joiners, Tamil endings, the lists' own sanity, hazards equal to the SQL check.
- `src/lib/migrations.test.ts`: 0010 grants, policies, RLS, the function, cron minutes, cleanup, bounds,
  no Realtime; privacy checks 6 and 17; all check scripts read-only.

## What could go wrong

- **Legal:** headlines may be protected; Sri Lanka's Intellectual Property Act (2003) has a fair-use
  section but nothing tested on headline lists (not legal advice). Only headline + source name + link, no
  images or summaries, the source named on every item (Daily Mirror's terms ask for that), a contact in
  the User-Agent, and a source removed the same day if it asks (`enabled: false` + delete its rows).
  Emailing the outlets before launch is the cautious option.
- **Broken feeds:** an empty DMC warnings feed looks the same as a broken one; the DMC table layout or
  the Met JSON keys can change; Lankapuvath and news.lk are already unusable; Supabase's shared IPs can
  be blocked. Watch `news_source_state` (health check in `docs/news-feed.md`).
- **Spam or a hacked feed:** own-domain links, cleaned titles, 50 items per source, React escaping in the
  app. A bad row can be deleted in the SQL Editor.
- **Wrong matches and misses:** the AI-written lists will miss Sinhala and Tamil word forms until reviewed.
- **Media read as official:** "Red warning issued" in a headline is a report of a warning, hence the
  "News report, not an official warning" line.
- **Wrong times:** zone-less or mislabelled dates (Divaina may stamp local time as UTC) can misorder items.
  Future times are clamped; the app shows the age.

## Rollout

1. Review the sources (done). Native review of the keyword lists alongside.
2. Function logic and tests (built).
3. Migration 0010 and its checks (built). The owner runs it by hand.
4. Deploy, set `NEWS_SECRET` and Vault `news_secret`, dry run, watch 2–3 days, tune the keywords.
5. App sheet behind `?news=1`, headless checks, UI text review.
6. Switch on the chip part and the Layers entry; README credits ("News headlines link to their
   publishers"); CLAUDE.md.
7. Later: Lankapuvath, NBRO with the landslide layer, news pins.
