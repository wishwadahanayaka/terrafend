import { createClient } from '@supabase/supabase-js'
import names from './ds-names.json' with { type: 'json' }
import {
  isAuthorised,
  jsonResponse,
  MAX_NEWEST_ENTRIES,
  PDF_MAX_BYTES,
  readCappedBytes,
  refresh,
  STATE_ID,
  type SourceState,
} from './logic.ts'
import { pdfPages } from './pdfText.ts'
import { MAX_BYTES, readCapped } from '../news-refresh/logic.ts'
import type { Gazetteer } from './names.ts'

// Reads DMC's list of landslide warnings every 30 minutes (a cron job calls this), reads each new
// LEWM PDF and keeps the warning and the DS divisions it names in landslide_warnings and
// landslide_areas. What it does is in logic.ts; this file only connects that to fetch(), unpdf and
// the database. Setup and checks: docs/landslide-areas.md.

Deno.serve(async (req) => {
  // No secret set means nobody gets in, rather than everybody
  if (!(await isAuthorised(req.headers.get('x-landslide-secret'), Deno.env.get('LANDSLIDE_SECRET')))) {
    return jsonResponse({ error: 'Unauthorized' }, 401)
  }
  if (req.method !== 'POST') return jsonResponse({ error: 'Use POST' }, 405)

  // ?dry_run=true reads and parses everything but stores nothing, and returns what it found.
  // ?force=true ignores the interval and the list of PDFs already seen (robots.txt still applies).
  // ?pdfs=N looks at the newest N entries of the list instead of 5 (at most 10).
  const params = new URL(req.url).searchParams
  const force = params.get('force') === 'true'
  const dryRun = params.get('dry_run') === 'true'
  const asked = Number(params.get('pdfs'))
  const pdfs = Number.isInteger(asked) && asked >= 1 ? Math.min(asked, MAX_NEWEST_ENTRIES) : undefined

  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const outcome = await refresh(
    {
      now: () => Date.now(),
      sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
      fetch: async (url, { method, headers, timeoutMs }) => {
        const res = await fetch(url, { method, headers, redirect: 'manual', signal: AbortSignal.timeout(timeoutMs) })
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
      fetchPdf: async (url, { headers, timeoutMs }) => {
        const res = await fetch(url, { method: 'GET', headers, redirect: 'manual', signal: AbortSignal.timeout(timeoutMs) })
        const location = res.headers.get('location')
        if (res.status !== 200) {
          await res.body?.cancel()
          return { status: res.status, location, bytes: null, tooBig: false }
        }
        const { bytes, tooBig } = await readCappedBytes(res.body, PDF_MAX_BYTES)
        return { status: 200, location, bytes: tooBig ? null : bytes, tooBig }
      },
      readPdf: pdfPages,
      readState: async () => {
        const { data, error } = await supabase.from('news_source_state').select('*').eq('source', STATE_ID).maybeSingle()
        if (error) throw error
        return (data as SourceState | null) ?? null
      },
      writeState: async (state) => {
        const { error } = await supabase.from('news_source_state').upsert(state, { onConflict: 'source' })
        if (error) throw error
      },
      readSeen: async (urls) => {
        const [warnings, skipped] = await Promise.all([
          supabase.from('landslide_warnings').select('pdf_url').in('pdf_url', urls),
          supabase.from('landslide_seen_pdfs').select('pdf_url').in('pdf_url', urls),
        ])
        if (warnings.error) throw warnings.error
        if (skipped.error) throw skipped.error
        return new Set([...(warnings.data ?? []), ...(skipped.data ?? [])].map((row) => row.pdf_url as string))
      },
      store: async (warning, areas) => {
        // One database function, so a warning and its areas are written together or not at all
        const { data, error } = await supabase.rpc('store_landslide_warning', { p_warning: warning, p_areas: areas })
        // The error keeps Postgres's code (23514 is a failed check): logic.ts only treats class 22 and 23
        // as "the data was refused". A network error, a timeout or an HTTP 5xx has no such code.
        if (error) {
          throw Object.assign(new Error(error.code ? `${error.code} ${error.message}` : error.message), { code: error.code })
        }
        return typeof data === 'number' ? data : null
      },
      markSeen: async (rows) => {
        const { error } = await supabase.from('landslide_seen_pdfs').upsert(rows, { onConflict: 'pdf_url', ignoreDuplicates: true })
        if (error) throw error
      },
      gazetteer: names as Gazetteer,
      log: (entry) => console.log(JSON.stringify(entry)),
    },
    { force, dryRun, pdfs },
  )

  return jsonResponse(outcome, outcome.result === 'failed' ? 502 : 200)
})
