# TerraFend

A mobile-first PWA for Sri Lanka that shows natural hazards and road blockages (floods, landslides, fallen trees, road closures, wild elephants, etc.) on a map, and checks a travel route for hazards along it. Everything must be free to build and host.

It is a portfolio project by a beginner software engineering student.

## Stack

- React + Vite + TypeScript
- Tailwind CSS
- Leaflet with react-leaflet, OpenStreetMap tiles
- Turf.js (geometry, route-vs-hazard checks)
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

- Steps 1 and 2 are complete: map, location, report form, markers, voting, photos, and hourly cleanup.
- Migrations 0001, 0002 and 0003 have all been run in Supabase. New database changes go in new migration files.
- Supabase CLI is logged in and linked to project `ktwdmwiaodtirrcitlgb`. Deploy functions with `npx supabase functions deploy <name>`. Docker isn't needed.
- Edge Function `cleanup-expired` is deployed and tested. Supabase Cron runs it hourly, using the Vault secrets `cleanup_secret` and `project_url`.
- Supabase secrets set: `CLEANUP_SECRET` and `ORS_API_KEY`. Their values must never appear in code, files or chat.
- Vercel has `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`, and auto-deploys on push to main.
- Deno is installed locally, with editor support set up for `supabase/functions`.
- Current work: step 3, the route check.

## Build plan

1. Map with the user's location (done)
2. Crowd hazard reports
3. Route check
4. Official data layers
5. Sinhala and Tamil alongside English, phone alerts, offline support (the app still opens and shows the last loaded reports when the signal is weak or gone, which often happens during disasters)

Work on one step at a time. Do not start the next step until asked.

## Rules

- Never put API keys in code. Use `.env`, which is git-ignored. Keep a `.env.example` with variable names only.
- Keep the UI mobile-first. Design for a phone screen first, then widen.
- Explain changes simply, because the user is learning.
- Use the Edit tool for file edits, not PowerShell string replacement (it corrupted index.html once).
- Write code comments the way an experienced human developer would: short, plain and natural. Only comment where it helps, explain why something is done rather than restating what the code obviously does, and don't comment every line. No emojis, no decorative section banners, no overly formal or robotic phrasing, and no comments like "This function handles..." on self-explanatory code.

## Commands

- `npm run dev` start the dev server
- `npm run build` type-check and build for production
- `npm run lint` run the linter
