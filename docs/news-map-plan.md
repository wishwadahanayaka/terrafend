# News on map, and official landslide areas: plan

Planned 15 Nov 2026. Parts 1 to 3 of the landslide areas (the boundaries, the PDF reader and the name
matching; then the backend: migration 0011 and the function; then the map layer) and part 4 (route warnings) are built; see "Built:
landslide areas, part 1", "part 2" and "part 3" below. Read with `docs/news-feed-plan.md`
(the feed this builds on) and `supabase/functions/news-refresh/`.

**Recommendation in one line:** build the official landslide areas (part B) first, on the shared
boundary files (part A), and the news areas (part D) after them. The trial below shows that headlines
rarely name a place, and when a description does, the place is often a reference point and not the
area of the event. NBRO's warnings name the exact DS divisions and levels, every day there is rain.

## Status

| Step | What | Status |
|---|---|---|
| A | Boundaries and gazetteer: DS divisions and districts with en/si/ta names, simplified, one build script | **built** for the landslide areas (`npm run areas`, `src/data/areas/`); the news gazetteer (aliases, towns, rivers) is part of D |
| B | Official landslide areas: parse NBRO's LEWM PDF, migration, function, map layer, route warnings | **parts 1 to 4 built**: 1 and 2 are committed, run and deployed (reader `lewm.ts`, `pdfText.ts`, matching `names.ts`; migration `0011_landslide_areas.sql`, `0011_check.sql`, the function's `logic.ts` and `index.ts`, `docs/landslide-areas.md`); 3 is the map layer (below), written but not yet tried on a phone. Part 4, route warnings, is built (below) |
| C | (part of B) the "Landslide warnings, coming soon" row becomes a real layer | **built** (part 3 of B, on for everyone) |
| D | News areas: place matching in `news-refresh`, `news_places`, "News on map" toggle, route note | planned, after B |
| E | Roads from headlines | later, assessed only |

## Built: landslide areas, part 1 (15 Nov 2026)

Data and logic only: no migration, no deploy, no screens.

- **Boundaries** (`scripts/build-areas.mjs`, `npm run areas`):
  - **Source:** HDX `cod-ab-lka` (Survey Department, CC BY-IGO, updated January 2026: 25 districts and
    339 DS divisions). The script downloads the GeoJSON zip once into `.cache/areas/` (git-ignored).
  - **Simplifying:** mapshaper 0.7.100 runs through `npx`, so it isn't a project dependency. It
    simplifies to about 200 m (topology kept), then dissolves the divisions into districts so their
    borders line up exactly.
  - **Output:**
    - `src/data/areas/ds.json` (542 KB, 134 KB gzipped);
    - `src/data/areas/districts.json` (158 KB, 47 KB gzipped);
    - `supabase/functions/landslide-refresh/ds-names.json` (English names and p-codes only, 5 KB
      gzipped).

    Each file has a `meta` block with the source, licence, attribution and the list of changes.
  - **Name fixes:** the source keeps names in a 50-byte field (a shapefile limit), so long Sinhala and
    Tamil names are cut off mid-word. Fixed by `scripts/area-name-fixes.mjs`, never by editing the
    output:
    - the cut-off word "district" is stripped from district names (ගම්පහ දිස්ත්‍රික්, ත්‍රිකුණාමළය දිස්);
    - Kalutara's legacy-font error කඵතර is fixed to කළුතර;
    - **34 cut-off DS names** are completed (ශ්‍රී ජයවර්ධනපුර ක → ... කෝට්ටේ, புதுக்குடியிருப் →
      ...பு). These are AI-written, marked for native review, and only ever complete the text the
      source has (a test checks).

    Every DS name at the byte limit must be either completed or listed as checked and whole, or the
    build stops. The remaining oddities, which need a native speaker, are listed as notes (Tamil
    கண்டி for Gangawata Korale, காலி for Galle Four Gravets).
- **Reader** (`supabase/functions/landslide-refresh/lewm.ts`, with `pdfText.ts` for the PDF step):
  - **Library:** unpdf 1.9.1, pinned in `deno.json` and `package.json`. It is pdf.js built for
    serverless runtimes (no worker, canvas or DOM), so the same code runs in Supabase Edge Functions
    (Deno) and in the Node tests. This pdf.js build has no eval path at all, and it runs without
    system fonts, font faces or XFA. Its size and page count are capped.
  - **Speed:** 20 to 190 ms per PDF, in Node and Deno alike.
  - **Rules, learned from ten real LEWMs (May to Nov 2026):**
    - every cell ends with "Divisional Secretariat Division(s) (DSD) and surrounding areas.", which
      separates the cells;
    - cells and district names are vertically centred in their row, so a cell's lines span its
      district's name;
    - a long table runs over 2 to 3 pages without repeating the header, and rows (even single cells)
      can break across a page;
    - the "Update:" line is often missing (the Message ID's last number is the update);
    - the Sinhala and Tamil text is partly in legacy fonts, so only the English is read.
  - **Result:** all ten read; none had a Level 3 cell, so Level 3 is tested on layouts built in the
    tests.
  - **Failing safe:** anything unexpected gives `parseOk: false` and a reason, never half a table:
    - a missing or reordered header, or no "Note:" line;
    - a cell without its closing words, or one that lines up with no district or two;
    - text crossing columns, or anything but a DS name in a cell;
    - Message IDs, the Update line, the validity and the printed issue time that disagree;
    - impossible dates.
- **Matching** (`names.ts`):
  - **How:** a name is looked for only in its row's district. Case, spaces, hyphens, underscores,
    th/t, dh/d and doubled letters are ignored, and 13 aliases cover the rest (Aranayaka, Kuruwita,
    Bulathkohupitiya, Meegahakivula, Pitabeddara, Bibila...).
  - **Result:** on the ten samples, 288 of 290 entries matched. The other two are reported unmatched
    on purpose: "Kotmale" alone (East or West?) and "Ratnapura-Ratnapura".
  - **Reporting:** a name in the wrong district gets a hint where it is. The same division at two
    levels is reported as a contradiction.
- **Tests:**
  - `lewm.test.ts`: the reader on three real warnings kept as text with positions (13 districts over
    three pages with a Level 2 cell split across a page; a row split across pages; today's), layouts
    built in the test, and broken layouts. No PDF is committed (they are DMC's documents, over 450 KB
    each); the PDF step (`pdfText.ts`) is tried on small PDFs written in the test, and a test checks no
    `.pdf` is in the fixtures folder.
  - `landslideNames.test.ts`: every name in the fixtures, the aliases, unmatched and conflicts.
  - `areas.test.ts`: the boundary files, the fixes, the licence and credit, and the script's checks
    and zip reader on made-up input.

## Built: landslide areas, part 2 (16 Nov 2026)

The backend: migration, function, checks, docs. No screens, no map layer. Nothing is run or deployed:
the owner runs the migration and deploys by hand (`docs/landslide-areas.md`).

- **Migration `0011_landslide_areas.sql`** (stops with a message if 0010 is missing):
  - `landslide_warnings`: one row per PDF that is a warning, **read or not**. `pdf_url` unique;
    `message_id` unique (from inside the PDF); update number, `listed_at` (DMC's list time: what
    "newest" goes by, known even for an unreadable PDF), `issued_at`, `valid_from`, `valid_to`,
    `parse_ok`, `parse_error`, `fetched_at`. A table constraint makes a warning either complete (read) or
    only a reason (not read): no partial guess can be stored.
  - `landslide_areas`: one row per name: level 1 to 3, district and DS name **as printed**, the
    p-codes (or null), arrow shift, newly-added, and `match_note`. A constraint says a name is matched
    (with both codes) or explained (null code and a reason): unmatched names are kept and readable. One
    division per warning (a unique index). Deleted with its warning (cascade).
  - `landslide_seen_pdfs`: PDFs looked at and skipped (`not_lewm`, `duplicate`). Closed to the API.
    A stored warning, read or not, counts as seen by itself.
  - RLS on; the app reads named columns only (`parse_error` and `fetched_at` are private); only
    `service_role` writes, and only select and insert.
  - `store_landslide_warning(jsonb, jsonb)`: the warning and its areas in one transaction, runs as the
    caller, `service_role` only. `landslide_current()`: for the app, runs as the caller, `stable`:
    the NEWEST warning (by `listed_at`, then `id`), `valid` (read and `valid_to > now()`), its areas and
    `parse_ok`; if the newest could not be read it says so and gives no areas and no fallback.
  - Cron: `landslide-refresh` at minutes 9 and 39 (free: the others use 0, 4, 19, 23, 34, 41, 49) and
    `landslide-cleanup` at 56 (warnings and skipped PDFs after 14 days). Vault secret `landslide_secret`.
  - `supabase/checks/0011_check.sql` (23 PASS/FAIL and info rows) and a new check 18 in `privacy.sql`.
- **Function `landslide-refresh`** (`logic.ts` pure, `index.ts` wiring):
  - Reads DMC's list itself (the plan said it would read `news_items`; reading the list shows every new
    entry and not just the newest), politely like `news-refresh`, with its own row (`landslide_list`) in
    `news_source_state`. It imports `news-refresh/logic.ts` for the User-Agent, the redirect rules,
    robots.txt reading and the timeouts. `news-refresh` only gained `export` keywords (`request`,
    `baseHeaders`, `Limits`) and a narrower parameter type: no behaviour change, so it needs no redeploy.
  - Looks at the newest 5 list entries (ignoring any older than 13 days), downloads only PDFs not seen,
    and identifies a warning by its message ID, not its file name.
  - **Not a warning** only on positive evidence (readable text with neither the title nor `LEWM`):
    recorded as seen and skipped. A scan, or a warning in a layout the reader can't handle, is stored as
    a warning that **could not be read**, never skipped.
  - A download that fails is tried again on the next runs; after 3 tries it is stored as "could not be
    downloaded", so a newer warning that can't be fetched is not hidden behind an older one.
  - Checks every row against the tables' rules before storing (message ID, update number, validity,
    lengths, p-codes, one division once). A warning that breaks one, or that the database still
    refuses as bad data (Postgres error class 22 or 23: `database rejected: ...`), is stored as "could
    not be read" instead of being refused on every run. Any other storing error (no code, network,
    timeout, 5xx) stores nothing, counts as a failed run and is retried next run (`store_failed`),
    without blocking the other PDFs. PDF links must be on `dmc.gov.lk` / `www.dmc.gov.lk` in `/images/dmcreports/`, in the
    function and in both tables. `service_role` can only select and insert on the three tables.
  - `?dry_run=true` parses and returns everything and writes nothing (not even its state); `?force=true`
    ignores the interval and the seen list; `?pdfs=N` looks at the newest N.
  - Needs `LANDSLIDE_SECRET` (header `x-landslide-secret`), deployed with `--no-verify-jwt`
    (`config.toml` has `verify_jwt = false`).
- **Names**: `names.ts` now also returns the district as printed on a match, and the district code,
  arrow shift and "newly added" on a name that did not match (so every name can be stored as a row).
- **Tests** (105 new, 1104 in all): `landslideRefresh.test.ts` (70: the list and robots.txt rules, a new
  PDF, a PDF seen before, not a warning, could not be read, could not be downloaded, the newest
  warning, dry run, time budget, rows the database would refuse, the wiring), the 0011 section of
  `migrations.test.ts` (the grants, constraints, functions, cron minutes against every other job,
  `landslide_current()` using only granted columns and no older warning, the SQL patterns matching the
  function's, and every p-code in the boundary files and names list fitting them), and the two check
  scripts. The database stand-in in the tests
  applies the same rules as the SQL's constraints. **The SQL itself has not run on a database**: the first
  run of the migration and `0011_check.sql` is its real test.
- **Not covered**: a stale list. If DMC's list stops changing or the page changes without breaking the
  parse, nothing says so (the app would show the last warning until it expires). See "Health check" in
  `docs/landslide-areas.md`.

## Built: landslide areas, part 3, the map layer (16 Nov 2026)

On for everyone (no URL flag). Not tried in a real browser by the author of the code: the checks to do
by hand are at the end.

- **Data.** `useLandslide` calls `landslide_current()` with a plain POST (like `forecastCache.ts` and
  `newsFetch.ts`, only the `apikey` header), every 10 minutes while the app is open, saved offline for 24
  hours. "Still valid" is `now < valid_to`, worked out on the phone from the saved times and the clock
  (a minute tick, and a timer for the moment `valid_to` passes). The server's own `valid` flag is not
  read, so a saved answer shown offline stops being current on time. One name the app can't read makes
  the whole answer unreadable: nothing is quietly left out.
- **Outlines.** `ds.json` is 536 KB, **136 KB gzipped**, a chunk of its own (`dsAreas-<hash>.js`). It
  is downloaded only when the newest warning is valid and has something to draw: a Level 2 or 3 area
  (whatever the switch says), or a Level 1 area with the switch on. It is not in the install:
  the service worker keeps it the first time it is used. District names (2.6 KB) are in a small file
  made from `districts.json`, so the district outlines don't come with it.
- **Layers panel.** The switch is on by default and follows the layer rule: "Alert and Evacuate areas
  always show. Switch on to add Watch areas." Under it one line: "Active warning: N areas" (every name
  in the warning) / "No active landslide warning" / "Latest warning couldn't be read" and a link to the
  PDF. Names with no match, or no outline, are listed as text and never dropped. With the switch off and
  Watch areas in the warning, a second line says they are hidden. The legend lists only the levels drawn.
- **Style (the proposal).** A light fill and an outline in NBRO's colour, heavier with the level:
  Level 1 yellow, dashed, weight 2; Level 2 orange-amber, solid, weight 3; Level 3 red, solid, weight 4.
  Edges are irregular admin boundaries, so they don't look like the rain's squares, and the dash and
  weight make the levels differ without colour. Hatching was left out: Leaflet's SVG renderer would need
  a pattern definition injected, and the outline weights do the same job. In a pane at z 370 (the rain
  panes are 380 and 390, the markers 600).
- **Chip.** Level 3 and Level 2 count ("landslide evacuation warning in 3 areas", "landslide alert in 5
  areas"), Level 1 does not. Why: the chip is for serious things (a river at Alert or above, heavy rain),
  and a Level 1 "Watch" is the lowest step, issued for 17 to 39 divisions on most rainy days in the real
  warnings, so counting it would put a landslide part on the chip nearly every day and teach people to
  ignore it. It is on the map (with the switch on) and in the Layers panel. It follows the existing rule
  (serious items always show and count): Level 2 and 3 are drawn and counted whatever the switch says,
  and a tap on the part fits the map to those areas once their outlines have loaded, otherwise it opens
  the Layers panel.
- **Card.** "Issued 16 Nov, 6:52 pm" and "Valid until 17 Nov, 6:52 pm": both always with the date.
- **The rule, as built.** This is the plan's section B (Level 2 and 3 always drawn, the switch adding
  Level 1). An earlier version of part 3 made the switch the whole layer; it was changed back the same
  day, so the outlines load for any valid Level 2 or 3 area, and for a Level 1 area only with the switch on.
- **Tests** (114 new, 1218 in all): `landslide.test.ts` (reading the answer, the PDF link, validity on
  the phone including a saved answer read later, which levels are drawn, the chip rule, the card, the
  style, the credits),
  `landslideStatus.test.ts` (every status line), `landslideFetch.test.ts`, `fakeLandslide.test.ts` (all
  ten modes, real codes, `offline-expiry`), `landslideShapes.test.ts` (placing areas, the lazy load and
  the service worker rule), `landslideLayer.test.ts` (the wiring, read from source), `layerSettings.test.ts`,
  and more in `offline.test.ts` and `appQueries.test.ts`.
- Part 4 (route warnings) is below.

By hand, on a phone or in the dev server: `?fakeLandslide=level1|level2|level3|mixed|unmatched|expired|unreadable|none|fail|offline-expiry`.
Look at 360 px and 320 px for: the Layers panel (switch and status line, and the long "Also named in the
warning" line with `unmatched`), the legend (bottom left, clear of the rain label and the buttons),
a card (not wider than the screen, the Emergency link opens the numbers screen), the chip, and
Sinhala and Tamil.

## Built: landslide areas, part 4, route warnings (16 Nov 2026)

Not tried in a real browser by the author of the code. No SQL, no deploy.

- **How:** the route line is checked against the matched DS outlines of the newest valid warning with Turf
  (`@turf/boolean-intersects`), after a bounding-box check. Same warning view, same `placeAreas`, same
  `ds.json` as the map; the outlines chunk is asked for only with a route on screen and a valid warning
  with a matched name (any level: the Watch note ignores the Layers switch). Touching an edge counts.
  The outlines are simplified to about 200 m, so a road within roughly 200 m of an edge may be judged
  either way.
- **Panel:** Level 3 and 2 are serious items and counted (header pill "N landslide areas", worst level's
  colour); Level 1 is a plain note and never counted. Each has "Valid until", "NBRO via DMC", the official
  PDF and "Show on map" (fits the map to the areas; for Watch areas with the switch off it turns the
  switch on). Unreadable newest warning: one note and the PDF. Names that can't be checked: one line.
  Details are in CLAUDE.md.
- **Never a reroute:** nothing here touches `reroute.ts`.
- **Choice made without asking (say if you want it changed):** when a valid warning exists and the route
  passes none of its areas the panel says nothing, because NBRO's areas include "surrounding areas" and
  "not in an area" must not read as "safe".

### Reroute around Level 3 areas: assessed, not built (recommendation: no, not with `avoid_polygons`)

- **What exists:** the `routing` function's route action already takes up to 20 `avoid` points, turns each
  into a 200 m square and sends them as `options.avoid_polygons` (a MultiPolygon). That is only used for
  blocked reports. When ORS finds no route it answers "No other route avoids these blocked roads".
- **ORS's documented limits** ([hosted API restrictions](https://giscience.github.io/openrouteservice/hosted-api-restrictions)):
  avoid polygon area 200 km², avoid polygon extent (height or width) 20 km, and **distance with avoid
  areas 150 km** (this also limits the existing blocked-road reroute on long trips). The page doesn't say
  whether the 200 km² is per polygon or in total; an ORS moderator says "in total"
  ([forum](https://ask.openrouteservice.org/t/big-avoid-polygons/6445)), and forum posts mention long thin
  shapes being refused.
- **Measured on the real outlines** (339 DS divisions, planar estimate): median 136 km² and 19 km across;
  **156 of 339 break the area or the extent limit (104 over 200 km², 152 over 20 km)**, up to 1,065 km²
  and 67 km. Even hill divisions that were in warnings are close or over: Dehiowita 195 km² and 24 km,
  Yatiyantota 181 and 23, Deraniyagala 223 and 22, Balangoda 185 and 29, Ratnapura 329 and 29; Aranayake,
  Mawanella, Eheliyagoda, Kolonna and Ella fit alone (107 to 179 km², 15 to 20 km). With several red
  divisions the total goes past 200 km² whichever way the limit is read. Vertices are no problem
  (median 80, max 234 per outline; the request would be a few KB).
- **A route that starts or ends inside a red area:** an avoid area covering the start or end leaves no
  usable road there, so ORS can't find a route (not tested against ORS: it uses the quota). The function
  would turn that into the wrong message ("No other route avoids these blocked roads"). And a person who
  lives in a red area has to be able to get out: avoiding it would be wrong.
- **Recommendation: no.** Sending DS outlines as avoid polygons fails for about half of them, the distance
  limit stops long trips, and avoiding a whole division is more than NBRO's warning says (it is about
  slope and rain, not about every road).
- **If you want it later,** the cheap and honest way is the existing blocked-road mechanism: put avoid
  points (200 m squares, at most 20) on the stretches of the route that are inside Level 3 areas, ignore
  any stretch within about 1 km of the start or end, and keep the 150 km limit in mind; then re-check the
  new route with `routePassesThrough` and say plainly "this route still passes through a Level 3 area" if
  it does. It would be an offer ("Find a way round the evacuation area?"), never automatic, and "no
  other route" would be an expected answer, since some of these roads are the only way. A second option
  is ORS `alternative_routes` (up to 3, but only for routes up to 100 km), picking the one that passes
  the fewest Level 3 areas, which needs no avoid polygons. Neither is built.

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

**Backend (built: part 2, see "Built: landslide areas, part 2" below; the design above changed in
three ways).** It reads DMC's list itself and not `news_items` (so it sees every new entry, not only the
newest), each area is a table row and not a JSON array, and a failed read is a row too.
- A separate function `landslide-refresh`, so a slow parse never delays the news run. Every 30 minutes
  (minutes 9 and 39), it reads DMC's list, downloads the PDFs it hasn't seen, parses, matches and stores.
- **Migration 0011**: `landslide_warnings` (one row per PDF that is a warning, read or not),
  `landslide_areas` (one row per division named) and `landslide_seen_pdfs` (skipped PDFs). RLS on, column
  grants, only `service_role` writes, deleted after 14 days by a cron job. No Realtime.

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
- **A migration with the next free number when it is written** (after 0011, the landslide warnings,
  and the photo-path cleanup) creates `news_places`:
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
2. **B:** migration 0011 and `landslide-refresh` with `?dry_run=true`. Run the dry run on the PDFs of
   the next rainy week (the DMC list keeps older ones, including Level 3 days), measure CPU time, then
   switch on the cron job.
3. **C:** the landslide layer in the app (the "coming soon" row), route warnings, chip parts. Headless
   checks, then live.
4. **D, backend:** the matcher in `news-refresh` (titles only), its migration (the next free number), the dry run lists
   places. Watch 1 to 2 weeks of real headlines, tune the lists, and get a native review of the
   Sinhala and Tamil names and common words.
5. **D, app:** the "News on map" toggle (off by default), the card, the route note. Live.
6. **D, descriptions:** only if the measured share of wrong `description` matches is low.
7. **E:** roads, only after D has numbers.
