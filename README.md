# TerraFend

A mobile-first web app that shows floods, landslides and road blockages across Sri Lanka on a map, and will check your route for hazards along the way.

**Live demo:** https://terrafend.vercel.app

## Why

Floods, landslides and blocked roads are a regular problem in Sri Lanka during the monsoon. Official warnings do exist, but they are spread across different agencies and aren't tied to the road you're actually travelling on. TerraFend aims to put them in one place, on a map, next to reports from other people on the ground.

## Features

Working now:

- Full-screen map of Sri Lanka
- "My location" button that shows your position as a blue dot, with an accuracy circle
- Clear messages when location is denied, unavailable or slow
- Banner reminding users this is not an official warning service

Roadmap:

- [x] Map with the user's location
- [ ] Crowd hazard reports (floods, landslides, fallen trees, road closures, wild elephants and more)
- [ ] Route check: find hazards along a travel route
- [ ] Official data layers
- [ ] Sinhala and Tamil alongside English
- [ ] Phone alerts
- [ ] Offline support, so the app still opens and shows the last loaded reports when the signal is weak or gone

## Tech stack

Used now:

- React, Vite and TypeScript
- Tailwind CSS
- Leaflet with react-leaflet, and OpenStreetMap tiles
- Vercel for hosting

Planned:

- Turf.js for route and hazard geometry
- TanStack Query for data fetching
- vite-plugin-pwa for installing the app and working offline
- Supabase (PostgreSQL with PostGIS, anonymous auth, storage, realtime, Edge Functions)
- OpenRouteService for routing, called through a Supabase Edge Function

### Planned data sources

- Sri Lanka Irrigation Department river gauges (ArcGIS)
- Open-Meteo weather data
- GDACS disaster alerts
- NBRO landslide warnings
- Department of Meteorology warnings

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

Other commands:

- `npm run build` type-checks and builds for production
- `npm run lint` runs the linter

API keys will go in a `.env` file that isn't committed.

## Disclaimer

TerraFend is **not an official warning service**. It is a portfolio project and its information can be late, incomplete or wrong. Follow the Disaster Management Centre (DMC) for official alerts, and don't rely on this app for decisions that affect your safety.

## License

MIT. See [LICENSE](LICENSE).
