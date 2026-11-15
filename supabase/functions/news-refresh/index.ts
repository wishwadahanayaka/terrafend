import { createClient } from '@supabase/supabase-js'
import { FETCH_TIMEOUT_MS, isAuthorised, MAX_BYTES, readCapped, refresh, type SourceState } from './logic.ts'
import { SOURCES } from './sources.ts'

// Reads the news sources every 15 minutes (a cron job calls this) and keeps the disaster headlines in
// news_items. What it does is in logic.ts; this file only connects that to fetch() and the database.
// Setup and checks: docs/news-feed.md.

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

Deno.serve(async (req) => {
  // No secret set means nobody gets in, rather than everybody
  if (!(await isAuthorised(req.headers.get('x-news-secret'), Deno.env.get('NEWS_SECRET')))) {
    return json({ error: 'Unauthorized' }, 401)
  }
  if (req.method !== 'POST') return json({ error: 'Use POST' }, 405)

  // ?force=true asks every source now, whatever its interval (robots.txt still applies).
  // ?dry_run=true reads and judges everything but stores nothing, and lists what the filter dropped.
  // ?only=<source id> runs that one source.
  const params = new URL(req.url).searchParams
  const force = params.get('force') === 'true'
  const dryRun = params.get('dry_run') === 'true'
  const only = params.get('only')
  if (only && !SOURCES.some((s) => s.id === only)) return json({ error: `Unknown source: ${only}` }, 400)

  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const outcome = await refresh(
    {
      now: () => Date.now(),
      sources: SOURCES,
      fetch: async (url, { method, headers }) => {
        const res = await fetch(url, { method, headers, redirect: 'manual', signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })
        const found = {
          etag: res.headers.get('etag'),
          lastModified: res.headers.get('last-modified'),
          location: res.headers.get('location'),
        }
        if (method === 'HEAD' || res.status !== 200) {
          await res.body?.cancel()
          return { status: res.status, headers: found, body: null, tooBig: false }
        }
        const { text, tooBig } = await readCapped(res.body, MAX_BYTES)
        return { status: res.status, headers: found, body: tooBig ? null : text, tooBig }
      },
      readStates: async () => {
        const { data, error } = await supabase.from('news_source_state').select('*')
        if (error) throw error
        return (data ?? []) as SourceState[]
      },
      writeItems: async (rows) => {
        // An item_key that is already stored is left as it was. Only the new rows come back.
        const { data, error } = await supabase
          .from('news_items')
          .upsert(rows, { onConflict: 'item_key', ignoreDuplicates: true })
          .select('id')
        if (error) throw error
        return data?.length ?? 0
      },
      markEnded: async (keys, at) => {
        const { error } = await supabase.from('news_items').update({ ended_at: at }).in('item_key', keys).is('ended_at', null)
        if (error) throw error
      },
      writeStates: async (states) => {
        const { error } = await supabase.from('news_source_state').upsert(states, { onConflict: 'source' })
        if (error) throw error
      },
      log: (entry) => console.log(JSON.stringify(entry)),
    },
    { force, dryRun, only },
  )

  return json(outcome, outcome.result === 'failed' ? 502 : 200)
})
