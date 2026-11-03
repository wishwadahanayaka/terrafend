# TerraFend

A mobile-first PWA for Sri Lanka that shows natural hazards and road blockages (floods, landslides, fallen trees, road closures, wild elephants, etc.) on a map, and checks a travel route for hazards along it. Everything must be free to build and host.

It is a portfolio project by a beginner software engineering student.

## Direction

TerraFend is a live hazard map for Sri Lanka, not a turn-by-turn navigation app. It tracks threats on the map, checks a route for them, and (later) offers a reroute when the route is affected. Google Maps handles navigation. Current work: putting all threat types on the map.

## Stack

- React + Vite + TypeScript
- Tailwind CSS
- Leaflet with react-leaflet, OpenStreetMap tiles
- TanStack Query
- vite-plugin-pwa
- Later: Supabase (PostgreSQL + PostGIS, anonymous auth, storage, realtime, Edge Functions)
- Later: OpenRouteService for routing, called through an Edge Function
- Later data sources: Sri Lanka Irrigation Department river gauges (ArcGIS), Open-Meteo, GDACS, NBRO and Met Department warnings
- Hosting: Vercel

Only the packages needed for the current step are installed. Add the rest when their step starts.

## Supabase

- Project region: Mumbai.
- Data API is on, but "automatically expose new tables" is off. Every new table needs explicit GRANTs for `anon` / `authenticated`, plus RLS policies.
- Automatic RLS is on for new tables.
- Users sign in anonymously, so they use the `authenticated` role.
- The frontend only ever uses the project URL and the anon (publishable) key, read from `.env`.
- Never use the secret or `service_role` key in frontend code. It bypasses RLS.
- Insert a point as the text `SRID=4326;POINT(lng lat)`, longitude first.
- Schema changes live in `supabase/migrations/` as numbered SQL files, run by hand in the SQL Editor.

## Current status

- Steps 1, 2 and 3 are complete: map, location, report form, markers, voting, photos, hourly cleanup, and the route check (place search, route line, hazards along the route).
- Migrations 0001, 0002, 0003 and 0004 (`reports_along_route`) have all been run in Supabase. New database changes go in new migration files.
- Supabase CLI is logged in and linked to project `ktwdmwiaodtirrcitlgb`. Deploy functions with `npx supabase functions deploy <name>`. Docker isn't needed.
- Edge Function `cleanup-expired` is deployed and tested. Supabase Cron runs it hourly, using the Vault secrets `cleanup_secret` and `project_url`.
- Supabase secrets set: `CLEANUP_SECRET` and `ORS_API_KEY`. Their values must never appear in code, files or chat.
- Vercel has `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`, and auto-deploys on push to main.
- Edge Function `routing` (place search and routes through OpenRouteService) is deployed and tested. It checks the user's token itself (`verify_jwt = false`).
- Place search falls back to the Open-Meteo geocoding API (`backupSearch.ts`, no key, from the browser, towns and cities only, Sri Lanka only) whenever the `routing` search fails; routes still need ORS. The panel then shows "Using backup search, which finds towns and cities only." with the Open-Meteo credit. In the dev server, `?fakeRouting=1` fakes searches and routes, and `?fakeRouting=searchdown` also makes the main search fail so the backup can be tried.
- Deno is installed locally, with editor support set up for `supabase/functions`.
- Step 4, part 1 is complete: river gauges from the waterlevels.lk API (no key needed), shown as drop markers. Alert, Minor and Major gauges always show; the Rivers switch in the Layers menu adds the rest (remembered in localStorage). There's a colour legend and a card per gauge. Cards and the README carry the credit line "Data: Sri Lanka Water Levels (Shakeeb Sadikeen), from the Department of Irrigation". Readings refresh every 10 minutes, and a failed load shows a quiet note.
- To test alert colours, run the dev server and open `?fakeRiver=<gauge id>:<alert|minor|major>` (dev only, see `useRiverGauges.ts`).
- Step 4, part 2 is complete: rain forecast along a checked route from the Open-Meteo API (no key, called from the browser, credit "Weather data by Open-Meteo.com" shown under the section and in the README). A point about every 10 km (max 25) gets the forecast for the hour you'd be there; heavy rain (7.5 mm/h), very heavy (15 mm/h) and thunderstorms (codes 95-99) show in the route panel and header, cached 30 minutes per checked route (`rainForecast.ts`). Each stretch is also drawn on the map (`RainOverlay.tsx`): the route line recoloured in the level's colour, plus an icon at its middle that opens a card (same popup fit). Tapping a rain item in the panel zooms to it and opens the card. The overlay hides while picking a spot and fades when the results are out of date. To test on a dry day, open the dev server with `?fakeRain=heavy:35-50,thunder:80` (levels light, moderate, heavy, veryheavy, thunder; km or km range along the route). Light (0.5-2.5 mm/h) and moderate (2.5-7.5 mm/h) rain are not warnings: they get one plain line under the warnings in the panel, with no header pill and nothing on the map, and "No rain expected along the route" shows only when every point is under 0.5 mm/h.
- Layers menu (`LayerControls.tsx`, top right, replaces the Rivers button): switches for Reports, Rivers and Rain, plus greyed "coming soon" rows for Global alerts and Landslide warnings. Rule for every layer: serious items always show (blocked and large-vehicles-only reports, rivers at Alert or above, heavy rain, very heavy rain, thunderstorms), and the switches only add the less serious ones (passable reports, normal rivers, light and moderate rain). Reports on a checked route always show. Switches are saved in localStorage (`layerSettings.ts`; the rivers key is still `terrafend:showAllRivers`). The (i) legend now covers the river and rain colours and carries both credits.
- Threats chip (`ThreatChip.tsx`, lazy, under the Layers button): one chip such as "1 river at flood level · 2 serious reports · thunderstorms in 1 area · heavy rain in 3 areas", or "No active threats" when every source loaded and nothing is serious. Tapping it fits the map to all serious items. Serious reports are counted island-wide by `useSeriousReports.ts`, using the `reports_in_view` function over all of Sri Lanka (so the newest 500 reports at most). Neighbouring rain squares count as one area (`warningAreas` in `rainMap.ts`).
- Rain across the island (Open-Meteo, no key, credit shown on every card and in the legend): `rainMap.ts` builds a grid of land points (a simplified coastline is embedded to skip sea points, geoBoundaries CC BY 4.0). The spacing starts at 15 km and widens until there are at most 150 points, which comes out at about 22 km and 137 points. One multi-location request (`fetchHourly` in `openMeteo.ts`, shared with the route rain) gets hourly precipitation and weather code in Asia/Colombo time. Each cell shows the worst of the next 3 hours, using the same levels as the route rain. `RainMapOverlay.tsx` draws the squares in two Leaflet panes (z-index 380 for light and moderate, 390 for warnings, so under the route line and all markers). Each pane is faded as a whole so touching squares show no seams, and the cards are pinned to the normal popup pane so they stay solid. Tapping a square opens a card with the level, the hour, "Forecast, not an official warning" and the credit. `useRainMap.ts` caches for 30 minutes, refreshes every 30, retries once, and a failure shows "Rain forecast unavailable right now" in the Layers panel only. Hidden while picking a spot. Cell cards use the normal auto-pan padding but not the zoom-in fit that marker cards have. To test on a dry day, open the dev server with `?fakeRainMap=thunder:kandy,heavy:galle` (levels light, moderate, heavy, veryheavy, thunder; places listed in `rainMap.ts`).
- Route rain wording: a rain item within 5 km of the start says "at the start of the route", within 5 km of the end "near the end of the route". Ranges say "from the start of the route to 25 km" or "from 80 km to the end of the route". Applies to warnings and to the light or moderate line.
- Card padding at the top of the screen is now 208px (`popupPadding.ts`), because the threats chip can wrap to three lines on a phone.
- Route panel: the From and To boxes (including "My location") are kept when the panel is closed and reopened, and only "Clear route" empties them. Changing them after a check marks the old results "out of date" (dimmed, and "Open in Google Maps" is disabled) until "Check route" is tapped again. The header and list also show river gauges at Alert or above within 2 km of the route, listed before user reports.
- The map is locked to Sri Lanka (`maxBounds`), and the minimum zoom follows the screen size.
- Cards open with auto-pan padding (`popupPadding.ts`) so they clear the banner, the river controls and the buttons. They stay fully on screen on phones (`usePopupFit.ts`): text width is capped to the screen, `MapLimits` widens the sea margin left, right and north to fit a card, and if a card still can't fit it zooms in one step before opening. The Route, Report and location buttons fade out while a card is open.
- Data code (Supabase, markers, route planner, report form, photo compression) is lazy-loaded to keep the first download small.
- Next: the rest of step 4 (GDACS "Global alerts", NBRO landslide warnings, Met Department warnings), when asked. Their rows are already in the Layers menu as "coming soon".

## Build plan

1. Map with the user's location (done)
2. Crowd hazard reports (done)
3. Route check (done)
4. Official data layers
5. Sinhala and Tamil alongside English, phone alerts, offline support (the app still opens and shows the last loaded reports when the signal is weak or gone, which often happens during disasters)

Work on one step at a time. Do not start the next step until asked.

## Rules

- Never put API keys in code. Use `.env`, which is git-ignored. Keep a `.env.example` with variable names only.
- Keep the UI mobile-first. Design for a phone screen first, then widen.
- Explain changes simply, because the user is learning.
- Use the Edit tool for file edits, not PowerShell string replacement (it corrupted index.html once).
- Write code comments the way an experienced human developer would: short, plain and natural. Only comment where it helps, explain why something is done rather than restating what the code obviously does, and don't comment every line. No emojis, no decorative section banners, no overly formal or robotic phrasing, and no comments like "This function handles..." on self-explanatory code.
- Don't call the real routing function or OpenRouteService in automated or headless tests; use `?fakeRouting=1`.

## Commands

- `npm run dev` start the dev server
- `npm run build` type-check and build for production
- `npm run lint` run the linter
