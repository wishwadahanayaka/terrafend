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
- Banner reminding users this is not an official warning service

Roadmap:

- [x] Map with the user's location
- [x] Crowd hazard reports (with photos and voting)
- [x] Route check: find hazards along a travel route
- [ ] Official data layers (river gauges, measured rain and GDACS global alerts are done)
- [ ] Sinhala and Tamil alongside English
- [ ] Phone alerts
- [ ] Offline support, so the app still opens and shows the last loaded reports when the signal is weak or gone

## Tech stack

Frontend:

- React, Vite and TypeScript
- Tailwind CSS
- Leaflet with react-leaflet, and OpenStreetMap tiles
- TanStack Query for loading and caching data
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

Planned:

- vite-plugin-pwa for installing the app and working offline

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
2. Run the files in `supabase/migrations/` in order (0001 to 0004) in the SQL Editor.
3. Copy `.env.example` to `.env` and fill in your project URL and publishable key. The `.env` file isn't committed.
4. For routes and place search, deploy the `routing` function from `supabase/functions/` and set your OpenRouteService key as the `ORS_API_KEY` secret. For the hourly cleanup, deploy `cleanup-expired` and follow the notes in migration 0003.

Other commands:

- `npm run build` type-checks and builds for production
- `npm run lint` runs the linter
- `npm test` runs the tests once, `npm run test:watch` re-runs them as you edit

## Testing

The core logic has unit tests, written with [Vitest](https://vitest.dev/): map box rounding, rain levels and the forecast rules, rain gauge rates, river gauge parsing, route distances and wording, finding blocked roads for a reroute, global alert relevance, and time formatting. They run on small sample data only, with no network and no real APIs. The test files sit next to the code they test, as `src/lib/*.test.ts`.

Every push and pull request to `main` runs the same checks on GitHub Actions (`.github/workflows/ci.yml`): install, lint, type-check, build, then the tests. The badge at the top shows the latest result.

## Disclaimer

TerraFend is **not an official warning service**. It is a portfolio project and its information can be late, incomplete or wrong. Follow the Disaster Management Centre (DMC) for official alerts, and don't rely on this app for decisions that affect your safety.

## License

MIT. See [LICENSE](LICENSE).
