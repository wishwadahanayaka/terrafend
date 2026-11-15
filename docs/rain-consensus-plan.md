# Rain consensus upgrade: plan

Approved on 15 Nov 2026. Only **step 1** of the rollout (the last section) is being built first. The rest
is kept here so it isn't lost. Facts about Open-Meteo and MET Norway were checked on their docs on that
day and can change: step 0 re-checks the ones the plan depends on.

## Status

| Step | What | State |
|---|---|---|
| 0 | One-place test request in a browser: model IDs, response key names, hourly steps, "equivalent to X calls" | not done |
| 1 | Past/Next switch, satellite light-rain rule, two hints (app only, no migration) | built |
| 2 | Migration + `forecast-refresh` fetches several models, in shadow mode for about a week | not done |
| 3 | Consensus in the app, behind a dev switch | not done |
| 4 | Consensus switched on, docs and credits updated | not done |
| 5 | Later, maybe: route rain from the cached models. MET Norway left out. | not done |

## Why the map looks untrustworthy

Found in `rainMap.ts`, `rainForecast.ts`, `rainSquares.ts`, `rainMeasured.ts`, `openMeteo.ts`, the
`forecast-refresh` function (`logic.ts`) and `forecast-cache.md`:

1. **One square mixes past and future.** `combineRain` drew, per square, the worse of what the satellite saw
   in the past 3 hours and what the forecast says for the next 3. A square could be blue because it rained
   two hours ago or because it may rain in two hours, and nothing showed which. Gauge icons are only ever
   past rain, so the two often disagree on purpose.
2. **The forecast is coarser than the squares it paints.** The forecast grid is about 22 km. Each 11 km
   satellite square took the forecast of the 22 km cell it falls in, so four squares shared one value.
3. **The "past 3 hours" from the satellite is often 2 to 5 hours old.** The newest satellite hour arrives
   1 to 3 hours late, so evening rain can still be drawn late at night as "light rain".
4. **Light and moderate rain only show with the Rain switch on.** If the switch was off, light rain at a
   person's location was never going to show, whatever the data said.

Consensus (idea 2 below) helps against false alarms. It does **not** fix missed light rain: requiring
models to agree shows *less* light rain. Misses are addressed by points 3 and 4 and by the Past/Next split.

## What was checked on Open-Meteo and MET Norway

- **Several models in one request.** `models=` takes several models, and each variable then comes back per
  model. The exact response key names (something like `precipitation_ecmwf_ifs`) and several model IDs
  could not be confirmed from the docs pages: step 0 checks them.
- **Chance of rain comes from ensembles, not single models.** The docs say `precipitation_probability` is
  "always derived from ensemble models". Single models probably won't give it, and today's strict rule needs
  it (60% chance). So the per-model rule has to change (idea 2).
- **How calls are counted.** Open-Meteo's formula: weight = locations x (days / 14) x (variables / 10), each
  part counting as at least 1, and the variable count "can be multiplied by the number of weather models".
  A commenter says the docs calculator gives different numbers, so step 0 confirms it.
- **Free limits:** 600 calls a minute, 5,000 an hour, 10,000 a day, 300,000 a month (the monthly limit is
  not enforced yet).
- **Models that cover Sri Lanka and are worth a vote:**

| Model | Why | Notes |
|---|---|---|
| ECMWF IFS HRES 9 km (`ecmwf_ifs`) | The strongest global model | Hourly to 90 h, new run every 6 h |
| GFS Global 0.11 degrees (`gfs_global`, name to confirm) | Independent (US) | Hourly to 120 h |
| ICON Global 11 km (name to confirm) | Independent (Germany) | **Changes to native grids on 30 Nov 2026**, its ID may change |
| UK Met Office Global 10 km (name to confirm) | Independent, strong in the tropics | Hourly |
| GEM Global about 15 km, as a 5th | Gives an odd number of votes | Only if step 0 shows hourly steps |

- **Models to leave out:** ECMWF AIFS and NCEP AIGFS (6-hourly steps only; AIGFS weather codes leave out
  thunderstorms), IFS 0.25 degrees open data (3-hourly), JMA GSM (too coarse), BOM ACCESS-G (discontinued
  June 2025), KMA GDPS (discontinued March 2026).

## Idea 1: several models in the shared cache

One request per run, still from `forecast-refresh`:
`models=best_match,ecmwf_ifs,gfs_global,<icon>,<ukmo>[,gem_global]` with the same three variables.

- **`best_match` stays in the request.** It keeps filling the existing `data` column in exactly today's
  shape. Installed older versions of the app keep working, and it still provides the chance of rain for
  cards.
- **Per model, the function stores a compact summary, not raw numbers.** For each cell, one 48-character
  string per model, one digit per hour: 0 dry, 1 light, 2 moderate, 3 heavy, 4 very heavy, 5 thunderstorm
  (strict). Plus one median rain amount per cell per hour, taken across the models that answered. A model
  whose arrays are empty or all null for a cell counts as not answered.

Cost (to confirm in step 0):

| | Variables x models | Weight per place | Calls per run | Per day (24 runs) |
|---|---|---|---|---|
| Today | 3 x 1 | 1.0 | 137 | 3,288 |
| best_match + 4 models | 3 x 5 = 15 | 1.5 | 206 | 4,932 |
| best_match + 5 models | 3 x 6 = 18 | 1.8 | 247 | 5,918 |

All of these fit the free limits (247 calls is under 600 a minute; about 178,000 a month is under
300,000). The catch: the function's address is shared with other Supabase projects, so less spare quota
means more chance of a 429. The current behaviour stays: keep the old row and try again at the next run.

**If one model's name is wrong, Open-Meteo refuses the whole request (HTTP 400).** This matters because of
the ICON change on 30 Nov. So on a 400 the function retries once with `best_match` alone, and the map falls
back to today's rules.

Data size: today the row is about 36 to 55 KB and about 16 kB is transferred per read. The new summary
column adds about 33 KB of digit strings (which compress very well) plus about 20 KB of median amounts. I
expect about 25 to 30 kB per read. The raw per-model numbers are never stored. Supabase egress stays far
below the free 5 GB a month at current use; around 800 reads a day it would start to matter.

## Idea 2: consensus, not average

**Per model, for the 3-hour window:**

- The model's level is its worst hour in the window.
- The model's own amount alone decides light, moderate, heavy and very heavy, because there is no per-model
  chance of rain.
- A thunderstorm vote keeps the strict rule: weather code 95 to 99 **and** at least 7.5 mm in that hour,
  from that model.
- So "models agreeing" takes the place of the 60% chance gate.

**The vote, per square:**

- `answered` = the models with data for that cell and window.
- A level is shown if at least a majority of `answered` reach it or higher (thunder also counts as heavy),
  **and** at least 2 models agree: 3 of 5, or 3 of 4 (2 of 4 is a tie, not a majority).
- The square shows the highest level that passes.
- If one or more models, but not a majority, show a thunderstorm or heavy rain, it becomes today's
  "possible" note: never drawn, one line in the Layers panel.
- If fewer than 3 models answered, that square uses today's `best_match` rules, and the card says it rests
  on one forecast.

**Wording.** Forecasts say "likely", "possible" or "shows", never "expect". Agreement is not a chance of
rain, so the cards keep "70% chance of rain" from `best_match` as a separate line.

| Key | English | Sinhala (needs native review) | Tamil (needs native review) |
|---|---|---|---|
| `consensus.agree_one` / `_other` | 1 of 5 weather models shows {{level}} here in the next 3 hours / 3 of 5 weather models show {{level}} here in the next 3 hours | to be written when built | to be written when built |
| `consensus.missing` | Only {{answered}} of {{asked}} weather models answered. | to be written | to be written |
| `consensus.single` | Based on one forecast only. | to be written | to be written |

`{{level}}` is a phrase that fits inside the sentence (for example "heavy rain"), done the same way as the
current `rain.where.*` phrases.

**Route rain** still asks Open-Meteo for one model, so it won't match the map's consensus. For now its line
would say "one forecast". Later, the route could read the cached models for its nearest grid cells (no
extra calls, but coarser).

## Idea 3: Past vs Next, never mixed (built in step 1)

- A two-part switch under Rain in the Layers panel: **"Past 3 h (measured)"** and **"Next 3 h (forecast)"**.
  "Now" is avoided, because the satellite runs 1 to 3 hours late. Remembered in localStorage. Default is
  Next 3 h, since TerraFend is about travelling.
- **Past view:** satellite squares and gauge icons. **Next view:** forecast squares only. Heavy gauge badges
  show in both views, because serious items always show. Light and moderate gauge icons show only in Past.
- A small label on the map says which view is on. Tapping it flips the view.
- Card tags: "MEASURED" with the time window, "FORECAST" with the time window.
- Nothing serious is hidden silently: the view not shown carries a count on its half of the switch, for
  example "Past 3 h · 2 heavy". The threats chip still counts both, and tapping a rain part switches to that
  view.
- `combineRain` builds two separate square sets instead of taking the worse of the two.

## Idea 4: confirming light rain from the satellite only (built in step 1)

- A satellite square that would show **light** rain, and has no other source, is drawn only if at least one
  of these holds:
  1. Light or more in at least 2 of the 3 satellite hours (it lasted).
  2. At least 1 of its 8 neighbouring squares is light or more (it covers an area).
  3. A fresh gauge within 15 km measured at least 0.5 mm in the past 3 hours.
- **Gauge veto:** a fresh gauge within 10 km that measured exactly 0 mm in the past 3 hours removes a light
  satellite square, even if one of the above holds.
- Moderate and heavier satellite rain is unchanged.
- Trade-offs: a real, small, short shower at light level can be missed (light rain is the least important
  level). Gauges sit mostly along rivers, so the veto and the confirmation only help near them. No
  migration and no new data: pure functions on data the app already has.

## Idea 5: MET Norway as a backup provider (not worth it now)

- Terms (checked): data under CC BY 4.0 with attribution; an identifying User-Agent with contact details; at
  most 20 requests a second in total; obey the `Expires` header; coordinates to at most 4 decimals;
  "Browsers and mobile apps should not contact the API directly", so it would only run in the Edge Function.
- It takes one place per request, so a run is 137 requests (about 7 seconds when paced).
- Outside Scandinavia it is mostly ECMWF, so it adds no independent vote, and it was not confirmed to give a
  chance of rain for Sri Lanka.
- Verdict: the app already falls back to a cached forecast up to 6 hours old and then says "unavailable".
  MET Norway would add a second credit, a second parser and a second set of rules. Revisit only if
  Open-Meteo outages turn out to be a real problem.

## Migration (steps 2 to 4; the next free number when built, 0010 is reserved for the photo paths)

```sql
alter table public.island_forecast
  add column models     jsonb,  -- {asked:[...], answered:[...], levels:{model:[cell strings]}, median_mm:[[...]]}
  add column last_stats jsonb;  -- per-run counts, for checking the new rule; never shown to the app
grant select (models) on public.island_forecast to anon, authenticated;  -- last_stats stays ungranted
notify pgrst, 'reload schema';
```

`data` keeps its exact shape for older versions of the app. The shared check (`validateCompact`) gets a
sibling, `validateModels`, used by both the function and the app.

## Tests (all with stand-ins, no network)

- **Function:** the multi-model URL matches the app's; per-model keys parse; a missing or all-null model
  counts as not answered; a 400 retries with `best_match` alone; `data` keeps today's shape; `last_stats` is
  filled; size limits are checked.
- **Consensus:** per-model levels and the strict thunderstorm rule; the window takes each model's worst
  hour; majority with 5, 4, 3, 2 and 1 models answering, including the 2-of-4 tie; thunder counts toward
  heavy; a minority thunder vote becomes "possible"; fewer than 3 answering falls back to `best_match`.
- **Satellite light rule (step 1):** an isolated light square is hidden; one that lasts, has a neighbour or
  has a gauge agreeing is shown; the gauge veto works; stale gauges are ignored; moderate is unchanged.
- **Past/Next (step 1):** what each view draws; the count on the hidden half; tapping the chip switches view;
  the choice is saved; past and future are never in one square.
- **Wording (i18n):** the new keys and plurals in all three languages, and a test that no English forecast
  text contains "expect".
- **Offline and cache:** an old row without `models` gives today's behaviour.
- **Headless checks:** new dev fakes such as `?fakeRainMap=heavy3of5:kandy` and
  `?fakeRainMap=sat-lightlone:galle`.

## What could go wrong

- **Model IDs, or the ICON change on 30 Nov, break the request.** Handled by the 400 fallback, but needs
  watching.
- **Majority voting under-warns.** Tropical storms are small, and every one of these models is 10 to 25 km.
  Mitigations: the "possible" note stays, measured rain still shows, and real numbers are checked before
  consensus is switched on (shadow mode).
- **Models update at different times,** so an older run still gets a vote. Acceptable; recording run times
  would cost extra metadata calls.
- **Call counting may differ** from the published formula. Step 0 checks it.
- **Unexplained mismatches.** A heavy rain gauge with no forecast square. The Past/Next split makes this
  honest instead of confusing, and the legend carries a line about it.
- **More moving parts** on a free tier, for a student project.

## Rollout order

0. **One-place test in a browser (no key, about 2 calls).** Request one point near Kandy with the 6 models.
   Confirms the model IDs, the response key names, whether single models give a chance of rain, hourly time
   steps, and the "equivalent to X calls" figure in Open-Meteo's docs calculator.
1. **Fix the cheap things first** (app only, no migration): the Past/Next switch, the satellite light-rain
   rule, a hint in the Layers panel that light rain needs the Rain switch, and a legend line saying measured
   and forecast rain cover different times.
2. **Migration plus the function in shadow mode.** Fetch the models, fill `models` and `last_stats`, keep
   the app unchanged for about a week, compare old and new cell counts with SQL.
3. **Consensus in the app** behind a dev switch, with fakes and headless checks.
4. **Switch consensus on,** update `docs/forecast-cache.md`, CLAUDE.md and the credits. Open-Meteo stays the
   only credit.
5. **Later, maybe:** route rain from the cached models. Leave MET Norway out.

## Sources

- Open-Meteo forecast API docs: https://open-meteo.com/en/docs
- Open-Meteo pricing and free tier: https://open-meteo.com/en/pricing
- Open-Meteo, weather data for multiple locations (the call weight formula): https://openmeteo.substack.com/p/weather-data-for-multiple-locations
- Open-Meteo ECMWF API: https://open-meteo.com/en/docs/ecmwf-api
- Open-Meteo DWD ICON API: https://open-meteo.com/en/docs/dwd-api
- Open-Meteo GFS API: https://open-meteo.com/en/docs/gfs-api
- Open-Meteo model updates: https://open-meteo.com/en/docs/model-updates
- MET Norway API terms of service: https://docs.api.met.no/doc/TermsOfService
