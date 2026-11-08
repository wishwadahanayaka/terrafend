import { createClient } from '@supabase/supabase-js'
import { isAuthorised, refresh, type Point } from './logic.ts'
import grid from './grid.json' with { type: 'json' }

// Fetches the island rain forecast from Open-Meteo once an hour (a cron job calls this) and keeps it
// in the island_forecast table, so phones read it from there instead of each asking Open-Meteo.
// What it does is in logic.ts; this file only connects that to Open-Meteo and the database.
// grid.json is the list of 137 points the app uses, made from the app's own grid (see docs/forecast-cache.md).

const FETCH_TIMEOUT_MS = 20_000

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

Deno.serve(async (req) => {
  // No secret set means nobody gets in, rather than everybody
  if (!(await isAuthorised(req.headers.get('x-forecast-secret'), Deno.env.get('FORECAST_SECRET')))) {
    return json({ error: 'Unauthorized' }, 401)
  }
  if (req.method !== 'POST') return json({ error: 'Use POST' }, 405)

  // ?force=true skips the "not within 30 minutes of the last run" check.
  // ?dry_run=true asks Open-Meteo and checks the answer, but stores nothing.
  const params = new URL(req.url).searchParams
  const force = params.get('force') === 'true'
  const dryRun = params.get('dry_run') === 'true'

  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const outcome = await refresh(
    {
      now: () => Date.now(),
      points: grid as Point[],
      readFetchedAt: async () => {
        const { data, error } = await supabase.from('island_forecast').select('fetched_at').eq('id', 1).maybeSingle()
        if (error) throw error
        return data?.fetched_at ?? null
      },
      fetchForecast: async (url) => {
        const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })
        let body: unknown = null
        try {
          body = await res.json()
        } catch {
          // not JSON (an error page, say)
        }
        return { status: res.status, body }
      },
      writeRow: async (row) => {
        const { error } = await supabase.from('island_forecast').upsert({ id: 1, ...row })
        if (error) throw error
      },
      // Only the two note columns change, so the stored forecast stays as it was
      writeFailure: async (at, message) => {
        const { error } = await supabase.from('island_forecast').update({ last_attempt_at: at, last_error: message }).eq('id', 1)
        if (error) throw error
      },
      sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
      log: (entry) => console.log(JSON.stringify(entry)),
    },
    { force, dryRun },
  )

  return json(outcome, outcome.result === 'rate_limited' || outcome.result === 'failed' ? 502 : 200)
})
