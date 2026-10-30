import { createClient } from '@supabase/supabase-js'

const BUCKET = 'report-photos'
const BATCH = 500
const DAY_MS = 24 * 60 * 60 * 1000
const KEEP_DAYS = 30

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

// Compares hashes so the check takes the same time wherever the strings differ
async function sameSecret(a: string, b: string): Promise<boolean> {
  const enc = new TextEncoder()
  const [x, y] = await Promise.all([
    crypto.subtle.digest('SHA-256', enc.encode(a)),
    crypto.subtle.digest('SHA-256', enc.encode(b)),
  ])
  const xa = new Uint8Array(x)
  const ya = new Uint8Array(y)
  let diff = 0
  for (let i = 0; i < xa.length; i++) diff |= xa[i] ^ ya[i]
  return diff === 0
}

Deno.serve(async (req) => {
  // No secret set means nobody gets in, rather than everybody
  const expected = Deno.env.get('CLEANUP_SECRET')
  const sent = req.headers.get('x-cleanup-secret')
  if (!expected || !sent || !(await sameSecret(sent, expected))) {
    return json({ error: 'Unauthorized' }, 401)
  }
  if (req.method !== 'POST') return json({ error: 'Use POST' }, 405)

  // ?dry_run=true only counts what would be removed
  const dryRun = new URL(req.url).searchParams.get('dry_run') === 'true'

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  )

  const now = Date.now()
  const nowIso = new Date(now).toISOString()
  const oldIso = new Date(now - KEEP_DAYS * DAY_MS).toISOString()

  const summary = { dryRun, photosRemoved: 0, reportsDeleted: 0, orphansRemoved: 0 }
  const errors: string[] = []

  // 1. Photos of expired or cleared reports
  try {
    const { data: stale, error } = await supabase
      .from('reports')
      .select('id, photo_path')
      .not('photo_path', 'is', null)
      .or(`status.eq.cleared,expires_at.lt.${nowIso}`)
      .limit(BATCH)
    if (error) throw error

    if (stale.length > 0) {
      if (dryRun) {
        summary.photosRemoved = stale.length
      } else {
        const { data: removed, error: removeError } = await supabase.storage
          .from(BUCKET)
          .remove(stale.map((r) => r.photo_path as string))
        if (removeError) throw removeError
        summary.photosRemoved = removed?.length ?? 0

        // Only after the files are gone, so a failed delete is retried next hour
        const { error: updateError } = await supabase
          .from('reports')
          .update({ photo_path: null })
          .in('id', stale.map((r) => r.id))
        if (updateError) throw updateError
      }
    }
  } catch (err) {
    errors.push(`photos: ${(err as Error).message}`)
  }

  // 2. Old reports. There is no "cleared at" column, but a report can only be
  // cleared while it is still unexpired, so expires_at is a safe upper bound.
  // Votes go with them through the cascade.
  try {
    if (dryRun) {
      const { count, error } = await supabase
        .from('reports')
        .select('id', { count: 'exact', head: true })
        .lt('expires_at', oldIso)
      if (error) throw error
      summary.reportsDeleted = count ?? 0
    } else {
      const { data, error } = await supabase
        .from('reports')
        .delete()
        .lt('expires_at', oldIso)
        .select('id')
      if (error) throw error
      summary.reportsDeleted = data.length
    }
  } catch (err) {
    errors.push(`reports: ${(err as Error).message}`)
  }

  // 3. Photos nothing points to (the list comes from a database function)
  try {
    const { data: orphans, error } = await supabase.rpc('orphan_report_photos')
    if (error) throw error
    const paths = (orphans as { name: string }[]).map((o) => o.name)

    if (dryRun) {
      summary.orphansRemoved = paths.length
    } else if (paths.length > 0) {
      const { data: removed, error: removeError } = await supabase.storage.from(BUCKET).remove(paths)
      if (removeError) throw removeError
      summary.orphansRemoved = removed?.length ?? 0
    }
  } catch (err) {
    errors.push(`orphans: ${(err as Error).message}`)
  }

  console.log(JSON.stringify({ ...summary, errors }))
  return json({ ...summary, errors }, errors.length ? 500 : 200)
})
