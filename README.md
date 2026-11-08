# TerraFend

[![CI](https://github.com/wishwadahanayaka/terrafend/actions/workflows/ci.yml/badge.svg)](https://github.com/wishwadahanayaka/terrafend/actions/workflows/ci.yml)

A mobile-first web app that shows floods, landslides and road blockages across Sri Lanka on a map, and checks your driving route for hazards along the way.

**Live demo:** https://terrafend.vercel.app

## Why

Floods, landslides and blocked roads are a regular problem in Sri Lanka during the monsoon. Official warnings do exist, but they are spread across different agencies and aren't tied to the road you're actually travelling on. TerraFend aims to put them in one place, on a map, next to reports from other people on the ground.

## Features

Working now:

- Full-screen map of Sri Lanka, locked to the island so it can't be dragged away
- "My location" button that shows your position as a blue dot, with an accuracy circle
- Hazard reports: pick a spot on the map, choose a type (flood, landslide, fallen tree, fallen power line, road closed, accident, road works, damaged road or bridge, wild elephant, protest or road block, other), say whether vehicles can get through, and add a note and an optional photo
- Photos are shrunk on your phone before upload, and their hidden metadata (like GPS location) is removed in the process
- Reports show as coloured markers on the map. Tap one to see its details and photo
- Voting: anyone can say a hazard is "still there" (which keeps it alive for another 6 hours) or "it's gone" (three of those clear it)
- Reports expire after 6 hours unless people confirm them, and old reports and photos are cleaned up automatically every hour
- Route check: search for a destination, see the driving route, distance and time, and the hazards along it in order, with one tap to jump to each. There's a button to open the same trip in Google Maps. If the route passes a road reported as blocked, it offers another route that avoids it, shown beside the original for comparison
- River gauges: official water levels from the Department of Irrigation's gauges as small drop markers, coloured by Normal, Alert, Minor flood and Major flood. Tap one for the level, the flood marks, when it was read (in Sri Lanka time) and a short next-hour forecast. The layer can be switched off, and it hides itself if the data isn't available. Gauges at Alert or above near a checked route are listed above the hazards
- Rain along the route: a forecast for about every 10 km of a checked route, timed to when you'd be there, with heavy rain, very heavy rain and thunderstorms called out in the route panel and on the map itself (a forecast, not an official warning)
- Rain across the island: soft coloured squares under the markers showing the worse of what the satellite estimated over the past 3 hours and what the forecast expects over the next 3. Tap one to see which, and the hour. Small rain badges beside the river gauges show rain the gauges measured
- Global alerts: Orange and Red alerts from GDACS (the UN and EU's disaster alert system) for cyclones, earthquakes, floods, volcanoes, droughts and wildfires that affect Sri Lanka or are within about 500 km of it, as diamond markers. A cyclone also shows its track and forecast area. Green alerts show when the Global alerts switch is on. A checked route lists the alerts it passes through or near, first in its panel.
- A Layers menu with a switch each for Reports, Rivers, Rain and Global alerts. Serious items (blocked or restricted road reports, rivers at Alert or above, heavy rain and thunderstorms) always show, and the switches only add the less serious ones. One chip counts everything serious right now, and tapping it zooms out to show it all
- Install it like an app: on Android and iPhone, add TerraFend to the home screen and it opens full screen with its own icon
- Works offline: the app opens without a connection and shows the last data it loaded (rivers, rain, forecasts, global alerts and reports) under a banner such as "Offline: showing data from 4:12 pm. It may be out of date." Map tiles you have already looked at are kept for 7 days. Reporting, route checks and voting wait until you are back online
- A "New version available, tap to refresh" prompt when an update is released, instead of changing the app while you use it
- Languages: English, Sinhala and Tamil. A button at the top right switches between them (EN / සිං / த), the choice is remembered, and on a first visit the app follows the phone's language if it is Sinhala or Tamil. Switching works offline too. The translations need review by native speakers (see Languages below)
- Banner reminding users this is not an official warning service

Roadmap:

- [x] Map with the user's location
- [x] Crowd hazard reports (with photos and voting)
- [x] Route check: find hazards along a travel route
- [ ] Official data layers (river gauges, measured rain and GDACS global alerts are done)
- [x] Sinhala and Tamil alongside English (translations welcome review)
- [ ] Phone alerts
- [x] Installable app that opens offline and shows the last loaded data
- [ ] Reports written offline and sent later

## Tech stack

Frontend:

- React, Vite and TypeScript
- Tailwind CSS
- Leaflet with react-leaflet, and OpenStreetMap tiles
- TanStack Query for loading and caching data
- i18next and react-i18next for English, Sinhala and Tamil
- lucide-react for icons
- browser-image-compression for shrinking photos

Backend, all on Supabase's free tier:

- PostgreSQL with PostGIS for locations and "near the route" searches
- Row level security, so the database itself decides who can read and write what
- Anonymous sign-in, so people can report without making an account
- Storage for report photos, with size and file type limits
- Edge Functions (Deno): one calls OpenRouteService for place search and routes, keeping its API key off the phone; another cleans up expired data
- Cron and Vault: Supabase Cron runs the cleanup every hour, with its secret kept in Vault

Other:

- OpenRouteService for place search and driving routes
- Open-Meteo for the rain forecast, called straight from the browser (no key needed)
- Vercel for hosting
- vite-plugin-pwa for installing the app and opening it offline (a service worker keeps the app's own files and the map tiles you have viewed; the data is saved by the app itself, with the time it was loaded)

### Planned data sources

- GDACS disaster alerts
- NBRO landslide warnings
- Department of Meteorology warnings

## Data credits

River levels: Data: Sri Lanka Water Levels (Shakeeb Sadikeen), from the Department of Irrigation. See [waterlevels.lk](https://waterlevels.lk).

Measured rain: Rain gauges: Department of Irrigation via Sri Lanka Water Levels (Shakeeb Sadikeen). See [waterlevels.lk](https://waterlevels.lk).

Satellite rain: GSMaP data by Japan Aerospace Exploration Agency (JAXA), through Sri Lanka Water Levels.

Global alerts: Data: GDACS (European Commission JRC and UN OCHA). See [gdacs.org](https://www.gdacs.org).

Rain forecast, and the backup place search: Weather data and geocoding by [Open-Meteo.com](https://open-meteo.com/).

Fonts: Noto Sans Sinhala and Noto Sans Tamil (Noto Project Authors, SIL Open Font License 1.1), used only on phones that have no Sinhala or Tamil font of their own.

The rain map uses a simplified Sri Lanka coastline, derived from [geoBoundaries](https://www.geoboundaries.org/) (CC BY 4.0), only to leave sea out of its grid.

## Running it locally

You need Node.js installed.

```
git clone https://github.com/wishwadahanayaka/terrafend.git
cd terrafend
npm install
npm run dev
```

Then open http://localhost:5173.

The location button only works on `localhost` or `https`, because browsers block location on plain `http` pages.

The app talks to a Supabase project. To run your own copy:

1. Create a free Supabase project and turn on anonymous sign-ins.
2. Run the files in `supabase/migrations/` in order (0001 to 0006) in the SQL Editor.
3. Copy `.env.example` to `.env` and fill in your project URL and publishable key. The `.env` file isn't committed.
4. For routes and place search, deploy the `routing` function from `supabase/functions/` and set your OpenRouteService key as the `ORS_API_KEY` secret. For the hourly cleanup, deploy `cleanup-expired` and follow the notes in migration 0003.

Other commands:

- `npm run build` type-checks and builds for production
- `npm run lint` runs the linter
- `npm run preview` serves the production build (with the service worker) after `npm run build`
- `npm run icons` makes the app icons from `public/icon.svg`
- `npm test` runs the tests once, `npm run test:watch` re-runs them as you edit

## Languages

TerraFend is in English, Sinhala (සිංහල) and Tamil (தமிழ்). English is built in. The Sinhala and Tamil files (`src/i18n/locales/si.ts` and `ta.ts`) only download when someone picks them, and the service worker keeps them so switching works offline. Every piece of the app's own text, including the safety wording, the cards, the report form, the route panel, and phrases like "20 min ago", is translated, and plurals follow each language's rules.

**The Sinhala and Tamil translations were written by an AI and have not been reviewed by a native speaker. Corrections are very welcome**, especially for the safety text and the longer explanations. Open an issue or a pull request that edits the file for that language. Each file starts with a note saying the same, and a test makes sure all three files have exactly the same keys.

Not translated, on purpose: names that come from other sources (rivers and gauges, GDACS event and country names, place search results), the data credit lines, and the database values behind the report types. Digits are always 0-9, as is usual in Sri Lanka. The Sinhala and Tamil letters use the phone's own fonts. Only if a phone has none does the browser fetch the small [Noto Sans Sinhala](https://fonts.google.com/noto/specimen/Noto+Sans+Sinhala) or [Noto Sans Tamil](https://fonts.google.com/noto/specimen/Noto+Sans+Tamil) file in `public/fonts/` (SIL Open Font License 1.1, licences included).

## Installing and offline

The app's own files are kept by a service worker, so it opens without a connection once it has been opened online. The last loaded data is saved on the phone (in localStorage) with the time it was loaded: it is dropped after 6 hours, and the rain forecast after 3. Nothing from Supabase's sign-in, reports, votes or the routing function is ever kept by the service worker.

Map tiles from OpenStreetMap are kept only for the parts of the map you have looked at, for 7 days, up to 400 tiles, following [OSM's tile usage policy](https://operations.osmfoundation.org/policies/tiles/). Nothing is downloaded ahead of time, so offline the map background only shows places you have already viewed.

The service worker is off in `npm run dev`. To try the installable app, run `npm run build` then `npm run preview` and open http://localhost:4173. The icons are made from `public/icon.svg` with `npm run icons`.

## Testing

The core logic has unit tests, written with [Vitest](https://vitest.dev/): map box rounding, rain levels and the forecast rules, rain gauge rates, river gauge parsing, route distances and wording, finding blocked roads for a reroute, matching and grouping duplicate reports, global alert relevance, time formatting, and what is saved for offline use. They run on small sample data only, with no network and no real APIs. The test files sit next to the code they test, as `src/lib/*.test.ts`.

Every push and pull request to `main` runs the same checks on GitHub Actions (`.github/workflows/ci.yml`): install, lint, type-check, build, then the tests. The badge at the top shows the latest result.

## Disclaimer

TerraFend is **not an official warning service**. It is a portfolio project and its information can be late, incomplete or wrong. Follow the Disaster Management Centre (DMC) for official alerts, and don't rely on this app for decisions that affect your safety.

## License

MIT. See [LICENSE](LICENSE).
