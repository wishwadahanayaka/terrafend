# News on map, and official landslide areas: plan

Planned 15 Nov 2026. Nothing here is built. Read with `docs/news-feed-plan.md` (the feed this builds
on) and `supabase/functions/news-refresh/`.

**Recommendation in one line:** build the official landslide areas (part B) first, on the shared
boundary files (part A), and the news areas (part D) after them. The trial below shows that headlines
rarely name a place, and when a description does, the place is often a reference point and not the
area of the event. NBRO's warnings name the exact DS divisions and levels, every day there is rain.

## Status

| Step | What | Status |
|---|---|---|
| A | Boundaries and gazetteer: DS divisions and districts with en/si/ta names, simplified, one build script | planned |
| B | Official landslide areas: parse NBRO's LEWM PDF, migration, function, map layer, route warnings | planned, **first** |
| C | (part of B) the "Landslide warnings, coming soon" row becomes a real layer | planned |
| D | News areas: place matching in `news-refresh`, `news_places`, "News on map" toggle, route note | planned, after B |
| E | Roads from headlines | later, assessed only |

## What was tried (15 Nov 2026, about 9 pm)

All of it was one-off reading for this plan. Nothing in the app or the function changed, no SQL was run,
and no test calls any of these.

- **The stored headlines:** the 15 rows in `news_items`, read once with the publishable key (the same
  read the app makes). **0 of 15 name a place**: "Thundershowers expected across several provinces...",
  "Bay of Bengal system threatens heavy rain across Sri Lanka", "மண்சரிவு தொடர்பில் பல பகுதிகளுக்கு
  எச்சரிக்கை" (warning for many areas), "පළාත් 7කට දැඩි වැසි" (heavy rain in 7 provinces), and DMC's
  report titles. No hits, so no false hits either.
- **Today's feeds:** each enabled media feed fetched once with TerraFend's User-Agent (6 requests, 150
  items, every one with a description: 48 to 232 characters on average, the first lines of the article).
  - 10 titles named a place, and **all 10 were non-disaster stories that the keyword filter already
    drops** (a diabetes campaign in Colombo, a fire in Divulapitiya, a murder in Nuwara Eliya...). On the
    kept items, titles gave 0 places.
  - Descriptions gave places for 3 kept items, and **all 3 were wrong as areas**: two were the Met
    Department's sea warning ("sea areas off the coast from Kankesanthurai via Trincomalee and Pottuvil
    to Hambantota", which is water, not those towns) and one was a distance ("about 600 km east of
    Trincomalee").
  - One near miss caught by the ambiguity rule: Sinhala ඇල්ලූ ("caught") starts like ඇල්ල (Ella).
- **The matcher on made-up headlines** written for the traps (26, in three languages): 26 right after
  the rules below were added (19 before). That number is optimistic, since the headlines and the rules
  were written together.
- **Common words:** the app's own 476 Sinhala and Tamil UI strings, which name no places: 0 accidental
  matches.
- **The landslide warning:** the newest LEWM PDF, fetched once from its stored DMC link (540 KB, 3 pages):
  it has a real text layer; see part B.

The prototype is a scratch script, not in the repo. It is about 150 lines and the rules are below.

## A. Boundaries and gazetteer (shared by B and D)

**Source: the Survey Department's boundaries, through OCHA on HDX** ("Sri Lanka - Subnational
Administrative Boundaries", `cod-ab-lka`). Licence **CC BY-IGO** (read from HDX's API; the page itself
could not be opened from here, so read it once by hand). Last updated January 2026. Levels: 9 provinces,
25 districts, **339 DS divisions**, 14,043 GN divisions, each with English, Sinhala and Tamil names and a
p-code (`LK1109` = Kaduwela).
- Credit line: "Boundaries: Survey Department of Sri Lanka, via OCHA (HDX), CC BY-IGO", in the legend
  and the README.
- geoBoundaries has a copy of the DS layer (CC BY 3.0 IGO, same source) but it is from 2023 and has 330
  divisions: it is missing Norwood, Ambagamuwa Korale, Kothmale East/West, Thalawakele and others that
  were split since. **Today's landslide warning names Norwood and Ambagamuwa Korale**, so use HDX.
  geoBoundaries' district layer is OpenStreetMap (ODbL), so don't use that one either.
- The names need a hand check before use. Sinhala and Tamil district names are cut off by a field
  length ("ගම්පහ දිස්ත්‍රික්", "களுத்துறை மாவட்டம"); Kalutara is කඵතර, a legacy-font error for කළුතර; Tamil
  uses கண்டி for Gangawata Korale (Kandy Four Gravets) and காலி for Galle Four Gravets. HDX itself warns
  that 530 GN names have conflicting Sinhala spellings (GN level is not used here).

**Which level to draw: polygons, never circles.**
- A district outline when the text names a district, the DS division when it names a DS division or a
  town in it. A circle around a town centre implies a precision news never has, and looks like a marker;
  a faint polygon reads as "somewhere in this area".
- DS divisions are what NBRO warns by and what DMC's situation reports count by, so one geometry file
  serves both layers.
- GN divisions (14,000) are too fine and their names too common.

**The file:** a build script (`npm run areas`, like `npm run icons`) downloads the HDX GeoJSON (133 MB
zip, once, not committed), simplifies with **mapshaper** (topology-aware, so neighbours stay joined;
MPL-2.0; a dev tool only), dissolves DS into districts, and writes `src/data/areas/ds.json` and
`districts.json` with `{ code, district, names: {en, si, ta} }` per area. It is loaded lazily, only when
a layer that needs it is on, and precached like every built file, so it works offline.
- Measured on the 2023 copy (330 polygons): 1.6 MB raw. Simplified to about 110 m: 613 KB, **191 KB
  gzipped**. To about 220 m: 314 KB, **88 KB gzipped**. Use about 200 m: the areas are approximate
  anyway. Districts add an estimated 20 to 30 KB gzipped.
- The gazetteer is built from the same names: 1,062 distinct spellings for districts and DS divisions in
  three languages, plus a hand alias list (media spellings that differ from the Survey Department's:
  ரத்தினபுரி / இரத்தினபுரம், யாழ்ப்பாண(ம்), ஹம்பாந்தோட்டை / அம்பாந்தோட்டை, රත්නපුරය...). The Sinhala and
  Tamil aliases are AI-written and marked NEEDS REVIEW BY A NATIVE SPEAKER.

**Rivers and towns (later in D, not needed for B).**
- Towns that are not DS names (Hatton, Kadugannawa, Peradeniya, Kankesanthurai): GeoNames (CC BY 4.0)
  points, each assigned to its DS by point-in-polygon at build time. Sinhala and Tamil names come from
  Wikidata labels (CC0) where they exist, otherwise hand-written and marked for review.
- About 15 major rivers (Kelani, Kalu, Gin, Nilwala, Mahaweli, Walawe, Deduru, Attanagalu, Maha Oya,
  Mundeni Aru, Malwathu, Kala, Yan, Menik, Kirindi): a hand list mapping each to the DS divisions of its
  flood-prone lower reach. Used only when no DS or district is named. Trap: Tamil களனி is both the
  Kelaniya DS and the Kelani river (களனி கங்கை).

## B. Official landslide areas (recommended first)

**The source.** The newest LEWM PDF, whose link `news-refresh` already stores (`dmc_landslide` row).
- The only other source found is a NBRO dashboard on `lrip.nbro.gov.lk` (an ArcGIS Operations
  Dashboard linked from nbri.gov.lk's homepage), and that host did not answer from here (timed out).
- NBRI's own "warnings" RSS was last updated Nov 2025 (see the feed plan).
- Worth asking NBRI whether the dashboard has a public feature service. Until then, the PDF is the
  source.

**What the PDF holds** (checked on `LEWM-14-11-2026-1600-09`):
- Page 1 has the message ID, the update number, the first-issued date and **"Validity Period: From 16:00
  hrs on 14.11.2026 To 16:00 hrs on 15.11.2026"**. It also explains the three levels (1 Yellow "Watch", 75
  mm in 24 h; 2 Amber "Alert", 100 mm; 3 Red "Evacuate", 150 mm).
- Page 2 is the table: one row per district, columns Level 1 / Level 2 / Level 3. Each cell holds DS
  names separated by commas and "and", with ↑/↓/↑↑/↓↓ for a level change and `*` for newly added. A cell
  ends with the boilerplate "Divisional Secretariat Division(s) (DSD) and surrounding areas."
- The English text extracts cleanly. The Sinhala and Tamil are partly legacy fonts that extract as
  gibberish (kz;rhpT is மண்சரிவு), so only the English is used.
- The 17 DS names in it: **15 match HDX exactly**. "Hali_Ela" needs underscore-to-hyphen (Hali-Ela),
  and "Yatiyanthota" is "Yatiyantota" in HDX. So names are matched after normalising (case, spaces,
  `_`/`-`, `th`/`t`, doubled letters), within the row's district only, with an alias table for the
  rest.

**How reliable is parsing it in an Edge Function.** Medium.
- The layout is a fixed template and the text is real (not scanned).
- The PDF library would be `unpdf` (pdf.js packaged for serverless, MIT, runs in Deno through `npm:`).
- Parse with positions, not plain text. Find the x-range of the three "Level n" headers and the y-range
  of each district row, then put each word in its cell by position, joining wrapped lines inside a
  cell.
- Fail safe, never guess. If the headers aren't found, a level isn't 1 to 3, the validity can't be read,
  or a cell has text that isn't a DS name of that district, store the warning with `parse_ok = false`
  and the unmatched names. The map then shows nothing new, and the sheet still has the PDF link (as
  today).
- Risks:
  - a template change;
  - a scanned PDF one day;
  - a name spelled a new way (shown as unmatched; added to the alias table);
  - CPU: Supabase Edge Functions allow about 2 s of CPU per request (check the docs). pdf.js on a 540
    KB, 3-page file should be well under that, but it must be measured in a dry run first.

**Backend.**
- A separate function `landslide-refresh`, so a slow parse never delays the news run. Every 30 minutes
  (minutes 9 and 39), it:
  - reads the newest `dmc_landslide` row from `news_items` (service role, no extra DMC page fetch);
  - if its message is new, fetches that one PDF (TerraFend User-Agent, 2 MB cap, own-site check, 20 s
    timeout), parses and stores it.
- About 1 to 3 PDFs a day, under 2 MB in all.
- `?dry_run=true` returns the parsed table, unmatched names and timings.
- **Migration 0012** (`0011` is taken by the photo-path cleanup planned for about 29 Nov 2026):
  `landslide_warnings`:
  - `message_id` unique (`LEWM-14-11-2026-1600-09`), `issued_at`, `valid_from`, `valid_to`, `pdf_url`
    (https, dmc.gov.lk);
  - `areas jsonb`, an array of `{ ds: 'LK2209', level: 1..3, shift: -2..2, added: bool }`, checked by
    the function and by a SQL check on shape;
  - `parse_ok`, `unmatched text[]`, `fetched_at`.
  - RLS on, public select through a column grant, only `service_role` writes, deleted after 14 days
    by a cron job. No Realtime.

**App.**
- The "Landslide warnings, coming soon" row becomes a real switch. It follows the layer rule in
  CLAUDE.md:
  - Level 3 (Red) and Level 2 (Amber) DS areas always show and count in the threats chip ("landslide
    evacuation warning in 3 areas", "landslide alert in 5 areas");
  - Level 1 (Yellow) needs the switch.
- Fill colours are NBRO's own yellow, amber and red, with a solid outline. The card says "Landslide
  warning, Level 3 (Red): evacuate. Aranayake DS division, Kegalle. Valid until 4:00 pm. Official: NBRO,
  via DMC", has a link to the PDF, and keeps NBRO's note that "surrounding areas" are included and that
  not every place in the division is unsafe.
- Hidden after `valid_to`. The sheet keeps its greyed "may no longer be valid" line.
- Route check: a route through a Level 2 or 3 area is a warning in the route panel and the header
  count. It is official, so it is a warning, not a soft note. It never triggers a reroute: rerouting
  stays for blocked roads.

**Tests.**
- The parser runs on made-up text-item fixtures in the PDF's layout: wrapped cells, all three levels,
  arrows, `*`, a missing header, a shifted column, an unknown name, a different district's name, a
  validity that can't be read. They are made up like the headline fixtures, not copies of the PDF.
- The name matcher has the two variants above.
- `migrations.test.ts`: the grant, policy, cleanup and no Realtime.
- Map rules: always-show levels, expiry at `valid_to`, the chip parts.
- Route: inside and outside a polygon.
- A dev fake: `?fakeLandslide=3:aranayake,2:mawanella,1:ella` (dev only).

## D. News areas (after B)

### 1. Matching (no paid AI)

**Where.** In `news-refresh`, at store time, only for headlines the keyword filter keeps. It uses the
gazetteer from A (copied into the function folder; the app does not download it).

**What text.**
- **The title only at first.** The trial shows descriptions mostly add reference points.
- Descriptions can be added later, with these limits:
  - read only for matching, never stored or shown;
  - the first 300 characters only;
  - only for land hazards (flood, landslide, rain, road, elephant, drought);
  - marked `from = 'description'`, so the share of wrong matches can be measured before they are
    drawn.
- **This changes a documented promise.** `logic.ts`, the feed plan and the README all say the
  description is never read. Reword them in the same change: "Descriptions are read only to find
  place names, never stored or shown."
- Divaina's feed carries the full article (65 KB). Cut it to the first 300 characters before matching.

**The rules** (all in the prototype, each with a trial case):
- Text is normalised like `forMatching` (NFC, no zero-width joiners, lowercase). The longest name wins
  where two overlap ("Nuwara Eliya" over "Eliya").
- **English:** whole words, written with a capital in the headline.
- **Sinhala and Tamil:** from the start of a word, with up to 6 letters of ending (ගාල්ලේ, රත්නපුරයට,
  மட்டக்களப்பில்). Tamil names drop a final vowel sign or virama first, since endings change it
  (மட்டக்களப்பு → மட்டக்களப்பில்), the same rule as the Tamil keyword stems.
- **A district wins over a DS division with the same name** (Ratnapura, Badulla, Galle): coarser is
  more honest.
- **Not the place of the event** (blocked):
  - a road or landmark after the name: Galle Road, Galle Face, "Kandy road", පාර, මාර්ග, வீதி, சாலை;
  - an institution: court, magistrate, port, stock (exchange), university, club, team, උසාවි and
    අධිකරණ (court), நீதிமன்ற (court);
  - a speaker: "Colombo says/said/told";
  - a road pair: "Colombo-Kandy", "කොළඹ - මහනුවර", "கண்டி - கொழும்பு" (both names; roads are part E);
  - "Gulf of Mannar", "Bay of ...", "from X";
  - a foreign place right after: "Kandy, Tamil Nadu".
- **Reference points** (new, from the trial):
  - a distance next to the name: "N km (east/west...) of X", "X ... N கி.மீ. தூரத்தில்", "X සිට ... කි.මී.";
  - a coast list: "from X via Y to Z", "X ... ஊடாக ... வரை", "X සිට ... දක්වා" with
    "sea/coast/கடல்/මුහුද" nearby.
- **Hazards that are not drawn on land:** wind_sea, cyclone and tsunami. Their places are coasts and
  seas, so they get no area. Earthquakes too: places in their headlines are usually where it was felt.
- **Common words** (matched only with a place word after them: district, area, DS, දිස්ත්‍රික්, ප්‍රදේශ,
  மாவட்ட, பகுதி):
  - காலி (Galle; also "empty");
  - எல்லை (Ella; also "border");
  - மடு (Madhu; also "pond");
  - ඇල්ල (Ella; also "waterfall", and ඇල්ලූ is "caught");
  - மகா ஓயா.

  The list is AI-written and needs native review. Expect it to grow while the feed is watched.
- **Passing mentions** remain the main risk ("Minister in Colombo..."). The speaker rule catches some
  of them. Drawing only for named hazards, plus the "Approximate, from news reports" label, limit the
  damage. A headline naming more than 4 places is drawn at district level only, and over 8 not at all
  (a list of places is rarely a precise area).
- **Foreign places with the same name:** few in practice (no Sri Lankan district shares a name abroad
  that appears in these feeds). Two protections: the keyword filter already drops foreign stories,
  and the "foreign place right after" rule covers the rest.

**Dry run.** `?dry_run=true` also lists the places found per kept headline, and the blocked ones with
the reason, so the owner can tune the lists from real headlines as was done for the keywords.

### 2. Data model

- **A new table, not the existing `place_name` / `location` columns.** One headline can name several
  places, a point is not an area, and a separate table can be emptied and re-filled without touching
  the headlines. The two old columns stay unused (dropping them would mean a column-grant change for
  nothing). They can go in a later migration if no use turns up.
- **Migration 0013** (0012 if this is built before B) creates `news_places`:
  - `id`;
  - `news_item_id bigint not null references news_items(id) on delete cascade`;
  - `area_code text` (p-code, `^LK\d{2,4}$`);
  - `level text check (level in ('district','ds'))`;
  - `matched text` (the spelling found, at most 100);
  - `from_text text check (from_text in ('title','description'))`;
  - `unique (news_item_id, area_code)`;
  - an index on `news_item_id`.
- Grants and RLS:
  - RLS on, a public select policy, `grant select (news_item_id, area_code, level, matched)` to `anon`
    and `authenticated`;
  - only `service_role` writes;
  - `from_text` stays private, for tuning, like `score`.
- **Cleanup:** the cascade removes places when the 7-day news cleanup deletes the headline. No cron job
  of its own.
- **The app read:** the same news request embeds them (`select=...,news_places(area_code,level)`,
  PostgREST follows the foreign key), so there is no second request. `NEWS_COLUMNS` and the
  `appQueries` tests are updated; a test checks `from_text` is never asked for.
- `privacy.sql` and `migrations.test.ts` get matching checks.

### 3. Map

- **Toggle:** "News on map" in the Layers panel, **off by default**, remembered in localStorage
  (`terrafend:newsOnMap`). Nothing is drawn, and the boundary file isn't downloaded, while it is off.
  - Never counted in the threats chip.
  - The news sheet's chip part stays as it is.
- **Expiry:** media 12 hours after `published_at`, official 24. Media headlines sometimes name a place
  for a still-running situation, but 12 hours keeps old floods from lingering.
- **Grouping:** one shape per area code. All the headlines behind it are listed on one card, newest
  first, at most 5, with "Show all in Disaster news" opening the sheet.
  - When the area holds several hazards, the outline takes the colour of the highest-priority one (the
    `HAZARDS` order) and the card lists them all.
  - A DS area and its district can both show; the DS shape is drawn above.
- **Colours** match the palette:
  - flood sky-700 `#0369a1` (beside the rivers' sky-600);
  - landslide amber-800 `#92400e` (brown, so it is never confused with NBRO's yellow, amber and red);
  - rain indigo-600 `#4f46e5` (as heavy rain);
  - road slate-600 `#475569`;
  - elephant emerald-800 `#065f46`;
  - drought yellow-700 `#a16207`;
  - other slate-500.
  - Nothing in red, amber or green, which mean report severity and official levels.
- **Never mixed with user reports:**
  - a dashed outline with a very light fill (0.06), in its own pane at z-index 370, below the rain
    squares (380 and 390), the route and every marker;
  - one small square badge with a newspaper icon at the area's label point, never a round pin;
  - hidden while picking a spot;
  - report pins are solid circles with a white border, so the two never look alike.
- **Card:**
  - "Approximate, from news reports" at the top, always;
  - the area name in the person's language ("Kaduwela DS division, Colombo");
  - each headline as in the sheet: a link in a new tab with `noopener noreferrer`, its own `lang`, the
    source and time ago;
  - the grey "News report, not an official warning";
  - the footer line "Places are picked automatically from headlines and may be wrong."
  - At 320 px it uses the existing popup fit (text width capped, scrolls inside), and the headline list
    is limited to 5.
- **Words:** all new text in en/si/ta, with the Sinhala and Tamil marked for native review. "Approximate"
  and "may be wrong" are deliberate. A test checks "expect" is never used.

### 4. Routes: a soft note, never a reroute (recommended)

**Recommendation:** yes, as a quiet line, and only while "News on map" is on.
- A route that passes through a **DS-level** news area of flood, landslide or road gets one grey line
  under the route's warnings: "News reports mention flooding near Kaduwela (approximate)". It never
  counts in the header, never goes in the warnings list, and never offers a reroute.
- District-level areas are too large to say "near", so they don't add a note.
- Reasons it stays quiet: places from headlines are sometimes wrong, the event may be over, and
  rerouting on a news mention would send people off their way for nothing. It is useful as "worth
  checking", which is what the line says.
- It shows only with the toggle on, because the person chose to see news places. The official
  landslide areas (part B) are warnings whatever the switch says.
- The rule is a pure function (`newsAlongRoute(route, areas, now)`): route points about every 500 m,
  point-in-polygon, at most 3 notes.

## E. Roads from headlines (later; assessed only)

Feasible in a limited way, not now.
- "A9 closed at Kanagarayankulam", "Kandy-Colombo road closed due to earth slip at Kadugannawa",
  "Southern Expressway: traffic halted".
- Patterns: A/B road numbers (`A\d{1,3}`, `B\d{1,3}`), expressway names, "X-Y road", "road at/near Z".
  In Sinhala and Tamil: මාර්ගය, வீதி with two place names.
- **Geometry is the hard part.** Drawing it needs the road's line (OSM, ODbL; A-roads alone are
  several MB raw) and a point on it for "at Z" (Z is often a village not in the gazetteer). Both
  invite confident-looking wrong lines.
- **A cheaper first version:** no map at all. If the routing answer includes road names or refs (ORS
  can return them in its steps; the function would have to keep them), a route that uses "A1" when a
  headline in the last 12 hours says "A1 ... closed" gets the same quiet line as part D4.
- Plan it after D has run for a few weeks, with the false-match numbers in hand.

## Data size and cost

| Item | Size | Notes |
|---|---|---|
| DS boundaries | 88 to 191 KB gzipped (measured) | about 200 m simplification recommended; loaded only when a layer needs it; precached |
| District boundaries | about 20 to 30 KB gzipped (estimate) | dissolved from DS at build time |
| Gazetteer (function) | 1,062 spellings, about 30 KB | not downloaded by the app |
| `landslide_warnings` | 1 to 3 rows a day, about 2 KB each | 14 days kept |
| `news_places` | 0 to 3 rows per kept headline, about 60 bytes | gone with the headline after 7 days |
| LEWM PDFs | about 540 KB each, 1 to 3 a day | read once per issue |
| App reads | about 1 to 3 KB more per news refetch, under 2 KB per landslide read | |

- **Cost: $0.** The free plan's database (500 MB), egress (5 GB) and Edge Function calls (about 1,500
  more a month for `landslide-refresh`) are far from their limits. The one unknown is the PDF parse's
  CPU time, measured in the dry run.
- **Vercel:** the boundary file is static and cached.

## Tests

- **Gazetteer and boundaries:**
  - every DS and district code has en/si/ta names;
  - no spelling points to two codes in the same language (except on the common-words list);
  - aliases point to real codes;
  - the file's codes equal the gazetteer's;
  - the simplified file has no empty polygons and stays under a size budget;
  - the credit is present.
- **Matcher:** every rule and trap above as a case:
  - Galle Road, Galle Face, Colombo-Kandy road, Ratnapura court, "Colombo says";
  - "Kandy, Tamil Nadu", Gulf of Mannar, "600 km east of Trincomalee", the coast list;
  - காலி, எல்லை, மடு, ඇල්ල, ඇල්ලූ;
  - Tamil and Sinhala endings, district over DS, longest match, the 4- and 8-place limits;
  - no area for sea hazards.

  All headline wording is made up, as now.
- **PDF parser:** part B's list.
- **Function runs with stand-ins:** places stored for kept headlines only; a rerun doesn't duplicate;
  a parse failure stores `parse_ok = false`; the dry run lists places.
- **Migrations:** grants, cascade, no `from_text` for the app, no Realtime, cleanup jobs.
- **App:**
  - toggle off by default and nothing downloaded while off;
  - expiry (12 h, 24 h, edges);
  - grouping and colour priority;
  - never in the chip;
  - the route note only with the toggle on, DS-level only, never a warning;
  - the landslide always-show levels;
  - the new words in all three languages.
- **Headless checks** with fakes: the layer at 320 and 360 px in all three languages, the card, the
  pane order (reports and rain above), and offline.

## Dev fakes

- `?fakeNewsAreas=flood:kaduwela,landslide:ratnapura-district,road:galle,rain:jaffna` (dev only): made-up
  headlines with places, through the same grouping and expiry. `:old` makes one 13 hours old.
- `?fakeLandslide=3:aranayake,2:mawanella,1:ella` and `?fakeLandslide=expired` (dev only).
- Both are behind `import.meta.env.DEV` and checked absent from `dist`, like the other fakes.

## What could go wrong

- **Wrong places drawn:** the main risk of part D, which is why it comes second, is off by default,
  says "approximate" twice, and starts from titles only.
- **Read as official:** news areas are dashed, brown/blue/indigo, never red; the card says "News
  report, not an official warning". Official landslide areas are solid and named "Official: NBRO".
- **Old areas looking current:** expiry 12 h (media), `valid_to` (landslide), and the sheet's
  existing greyed notices.
- **PDF template change or a scanned PDF:** `parse_ok = false`, nothing drawn, the PDF link remains.
  Watch with a health check like the news one.
- **Boundary changes:** new DS divisions (Norwood, Thalawakele) appear in warnings before an old file
  knows them. They show as unmatched; rebuild from a newer HDX release.
- **Name variants:** Sinhala and Tamil spellings in media differ from the Survey Department's. The
  alias list grows from the dry run's output; it needs native review.
- **Licence:** CC BY-IGO needs the credit; check the HDX page's licence text by hand once.
- **Size:** keep the boundary file under its budget; it only loads when needed.
- **Colour clashes:** NBRO yellow/amber/red and the river gauges' yellow/orange/red both mean official
  levels, but one is a filled area and the other a drop marker. The news colours avoid both.

## Rollout

1. **A:** the boundary build script and gazetteer, with tests. The owner checks the licence text on
   HDX and the Sinhala and Tamil names.
2. **B:** migration 0012 and `landslide-refresh` with `?dry_run=true`. Run the dry run on the PDFs of
   the next rainy week (the DMC list keeps older ones, including Level 3 days), measure CPU time, then
   switch on the cron job.
3. **C:** the landslide layer in the app (the "coming soon" row), route warnings, chip parts. Headless
   checks, then live.
4. **D, backend:** the matcher in `news-refresh` (titles only), migration 0013, the dry run lists
   places. Watch 1 to 2 weeks of real headlines, tune the lists, and get a native review of the
   Sinhala and Tamil names and common words.
5. **D, app:** the "News on map" toggle (off by default), the card, the route note. Live.
6. **D, descriptions:** only if the measured share of wrong `description` matches is low.
7. **E:** roads, only after D has numbers.
