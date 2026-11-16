import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { newPhotoPath } from './photoName'
import {
  AREA_CODE_RULE,
  DISTRICT_CODE_RULE,
  isPdfLink,
  MAX_DISTRICT_NAME,
  MAX_DS_NAME,
  MAX_MATCH_NOTE,
  MAX_PARSE_ERROR,
  MAX_PDF_URL,
  MESSAGE_ID_RULE,
  PDF_URL_RULE,
} from '../../supabase/functions/landslide-refresh/logic.ts'

// These tests read the SQL files as text. They check what the files say, not how a database
// behaves: the behaviour is checked by hand with supabase/checks/0009_dry_run.sql.

const SUPABASE = join(__dirname, '..', '..', 'supabase')
const read = (...parts: string[]) => readFileSync(join(SUPABASE, ...parts), 'utf8').replace(/\r\n/g, '\n')

// The SQL without its -- comments
const code = (sql: string) => sql.split('\n').map((line) => line.replace(/--.*$/, '')).join('\n')
// Also without quoted text, for checks on which words a file uses
const bare = (sql: string) => code(sql).replace(/'(?:[^']|'')*'/g, "''")

const migrations = readdirSync(join(SUPABASE, 'migrations'))
  .filter((name) => /^\d{4}_.+\.sql$/.test(name))
  .sort()
  .map((name) => ({ name, sql: read('migrations', name) }))
const allCode = migrations.map((m) => code(m.sql)).join('\n')

function migration(prefix: string) {
  const found = migrations.find((m) => m.name.startsWith(prefix))
  if (!found) throw new Error(`No migration starting with ${prefix}`)
  return found
}

const m0009 = migration('0009').sql
const m0009Code = code(m0009)

// The text of a function as the latest migration that creates it defines it. Run in order, that is
// the version that is live.
function latestFunction(name: string): string {
  let start = -1
  for (const m of allCode.matchAll(new RegExp(`create (?:or replace )?function public\\.${name}\\(`, 'g'))) {
    start = m.index ?? start
  }
  if (start < 0) throw new Error(`No function ${name} in the migrations`)
  const rest = allCode.slice(start)
  const end = rest.search(/\n\$\$;/)
  return end < 0 ? rest : rest.slice(0, end + 4)
}

function functionNames(): string[] {
  const names = new Set<string>()
  for (const m of allCode.matchAll(/create (?:or replace )?function public\.(\w+)\(/g)) names.add(m[1])
  return [...names]
}

// Columns of reports: the create table in 0001, plus every column added later
function reportsColumns(): string[] {
  const create = code(migration('0001').sql)
  const block = /create table public\.reports \(([\s\S]*?)\n\);/.exec(create)?.[1] ?? ''
  const columns = [...block.matchAll(/^ {2}([a-z_]+) +\S/gm)].map((m) => m[1])
  for (const m of allCode.matchAll(/alter table public\.reports add column (\w+)/g)) columns.push(m[1])
  return columns
}

// The photo name pattern as the database spells it
function sqlPhotoPatterns(): string[] {
  return [...m0009Code.matchAll(/'(\^\[0-9a-f\]\{8\}[^']*)'/g)].map((m) => m[1])
}

describe('0009: created_by cannot be read', () => {
  it('takes away table-wide select on reports from anon and authenticated', () => {
    expect(m0009Code).toMatch(/revoke select on public\.reports from anon, authenticated;/)
  })

  it('grants select on named columns, and created_by is not one of them', () => {
    const list = /grant select \(([^)]*)\) on public\.reports to anon, authenticated;/.exec(m0009Code)?.[1]
    expect(list).toBeDefined()
    const granted = (list ?? '').split(',').map((c) => c.trim())
    expect(granted).not.toContain('created_by')
    expect(new Set(granted).size).toBe(granted.length)
  })

  it('grants every column that exists except created_by, so a new column is not forgotten', () => {
    const list = /grant select \(([^)]*)\) on public\.reports to anon, authenticated;/.exec(m0009Code)?.[1] ?? ''
    const granted = list.split(',').map((c) => c.trim()).sort()
    const expected = reportsColumns().filter((c) => c !== 'created_by').sort()
    expect(expected.length).toBeGreaterThan(8)
    expect(granted).toEqual(expected)
  })

  it('does not take anything from service_role (the cleanup function)', () => {
    expect(m0009Code).not.toMatch(/service_role/)
  })

  it('stops with an error when the table has a column it does not know, or when 0005 has not run', () => {
    expect(m0009Code).toContain("column_name not in (")
    expect(m0009Code).toContain('needs migration 0005 first')
  })

  it('checks its own grants before it commits, and reloads the API schema', () => {
    expect(m0009Code).toMatch(/has_column_privilege\('anon', 'public\.reports', 'created_by', 'select'\)/)
    expect(m0009Code).toMatch(/notify pgrst, 'reload schema';/)
    expect(m0009Code.trim().startsWith('begin;')).toBe(true)
    expect(m0009Code.trim().endsWith('commit;')).toBe(true)
  })
})

describe('no function hands out a user id', () => {
  const names = functionNames()

  it('finds the functions it should check', () => {
    for (const name of [
      'reports_in_view',
      'reports_along_route',
      'similar_reports_nearby',
      'report_confirmations',
      'my_reports',
      'owns_report_photo',
    ]) {
      expect(names, name).toContain(name)
    }
  })

  it('returns no created_by or user_id column from any function', () => {
    for (const name of names) {
      const def = latestFunction(name)
      const table = /returns table \(([\s\S]*?)\)\s*language/.exec(def)?.[1]
      if (table) expect(table, name).not.toMatch(/\b(created_by|user_id)\b/)
    }
  })

  it('never uses a star select or created_by in a function that runs as the caller', () => {
    const checked: string[] = []
    for (const name of names) {
      const def = latestFunction(name)
      if (/security definer/.test(def) || !/public\.reports/.test(def)) continue
      checked.push(name)
      const body = def.slice(def.indexOf('as $$'))
      expect(body, `${name} has a star select`).not.toMatch(/\b\w+\.\*|select\s+\*/i)
      expect(body, `${name} mentions created_by`).not.toMatch(/created_by/)
    }
    // Callers' rights apply to these, so these are the ones that would break
    expect(checked).toEqual(expect.arrayContaining(['reports_in_view', 'reports_along_route', 'similar_reports_nearby']))
  })

  it('has reports_along_route name its columns (it used r.* before 0009)', () => {
    const def = latestFunction('reports_along_route')
    expect(def).toContain('r.severity_updated_at')
    expect(def).not.toMatch(/\br\.\*/)
    expect(m0009Code).toMatch(/create or replace function public\.reports_along_route/)
    expect(m0009Code).toMatch(/grant execute on function public\.reports_along_route\(jsonb, double precision\) to anon, authenticated;/)
  })

  it('keeps the two log tables closed to the API', () => {
    for (const table of ['report_severity_updates', 'report_edits']) {
      expect(allCode, table).toMatch(new RegExp(`revoke all on public\\.${table} from public, anon, authenticated;`))
      expect(allCode, table).not.toMatch(new RegExp(`grant [^;]*on public\\.${table}`))
      expect(allCode, table).not.toMatch(new RegExp(`create policy [^;]*on public\\.${table}`))
    }
  })
})

describe('0009: photos', () => {
  it('uses one photo name pattern everywhere in the file', () => {
    const patterns = sqlPhotoPatterns()
    expect(patterns.length).toBeGreaterThanOrEqual(2)
    expect(new Set(patterns).size).toBe(1)
  })

  it('accepts what the app makes and refuses everything else', () => {
    const pattern = new RegExp(sqlPhotoPatterns()[0])
    const uuid = '9a1c3b52-7d44-4e0f-8a2b-61c5d9e0f3a7'
    for (let i = 0; i < 20; i++) expect(newPhotoPath()).toMatch(pattern)
    for (const bad of [
      `${uuid.toUpperCase()}.jpg`,
      `${uuid}.png`,
      `${uuid}.jpeg`,
      `${uuid}.jpg.exe`,
      `x/${uuid}.jpg`,
      `${uuid}/${uuid}.jpg`,
      `../${uuid}.jpg`,
      `${uuid}`,
      'photo.jpg',
      '',
    ]) {
      expect(bad).not.toMatch(pattern)
    }
  })

  it('lets a signed-in user upload a random name or (until the photo-path cleanup) the old own folder, and nothing else', () => {
    expect(m0009Code).toMatch(/create policy "Signed-in users upload photos"\s+on storage\.objects for insert\s+to authenticated/)
    expect(m0009Code).toContain("(storage.foldername(name))[1] = auth.uid()::text")
    expect(m0009Code).toMatch(/drop policy if exists "Users upload photos into their own folder" on storage\.objects;/)
    expect(m0009Code).toContain("bucket_id = 'report-photos'")
  })

  it('creates no way to list, replace or delete photos', () => {
    expect(allCode).not.toMatch(/create policy [^;]*on storage\.objects\s+for\s+(select|update|delete|all)/i)
  })

  it('keeps every condition of the reports insert policy and adds the new photo rule', () => {
    const policy = /alter policy "Signed-in users create their own reports"[\s\S]*?\n {2}\);/.exec(m0009Code)?.[0] ?? ''
    expect(policy).not.toBe('')
    // From 0001
    expect(policy).toContain('created_by = auth.uid()')
    expect(policy).toContain('public.recent_report_count() < 10')
    // From 0002: no photo, or the old own-folder pattern, character for character
    const oldRule = "'/[A-Za-z0-9_-]+\\.(jpg|jpeg|png|webp)$'"
    expect(policy).toContain('photo_path is null')
    expect(policy).toContain(oldRule)
    expect(code(migration('0002').sql)).toContain(oldRule)
    // New in 0009
    expect(policy).toContain('public.owns_report_photo(photo_path)')
  })

  it('leaves the Sri Lanka bounds check alone: it is a table constraint, not part of the policy', () => {
    expect(code(migration('0001').sql)).toContain('constraint reports_location_in_sri_lanka check')
    expect(m0009Code).not.toMatch(/constraint/i)
  })

  it('has owns_report_photo as a security definer with an empty search path, for signed-in users only', () => {
    const def = latestFunction('owns_report_photo')
    expect(def).toMatch(/security definer/)
    expect(def).toContain("set search_path = ''")
    expect(def).toContain('o.owner_id::text = auth.uid()::text')
    expect(m0009Code).toMatch(/revoke all on function public\.owns_report_photo\(text\) from public, anon;/)
    expect(m0009Code).toMatch(/grant execute on function public\.owns_report_photo\(text\) to authenticated;/)
  })
})

describe('the dry run file', () => {
  const dry = read('checks', '0009_dry_run.sql')
  const dryCode = code(dry)

  it('contains the whole body of 0009, word for word', () => {
    const body = /^begin;$([\s\S]*?)^commit;$/m.exec(m0009)?.[1]
    expect(body).toBeDefined()
    expect(dry).toContain((body ?? '').trim())
  })

  it('never commits: it starts a transaction and ends with a rollback', () => {
    expect(dryCode).not.toMatch(/\bcommit\b/i)
    expect(dryCode.trim().startsWith('begin;')).toBe(true)
    expect(dryCode.trim().endsWith('rollback;')).toBe(true)
    expect(dryCode).toContain('DRY RUN FINISHED')
  })

  it('tests the things 0009 is for', () => {
    for (const text of [
      'select created_by from public.reports',
      'select * from public.reports',
      'reports_along_route',
      'reports_in_view',
      'similar_reports_nearby',
      'owns_report_photo',
      'report_votes',
      'orphan_report_photos',
      'supabase_realtime',
      'the 11th report in an hour is refused',
    ]) {
      expect(dryCode, text).toContain(text)
    }
  })
})

describe('0010: news feed', () => {
  const m0010 = migration('0010_news_feed').sql
  const c0010 = code(m0010)
  const PUBLIC_COLUMNS = ['id', 'url', 'title', 'source', 'kind', 'channel', 'language', 'hazard', 'published_at', 'fetched_at', 'ended_at', 'place_name', 'location']

  function newsColumns(): string[] {
    const block = /create table public\.news_items \(([\s\S]*?)\n\);/.exec(c0010)?.[1] ?? ''
    return [...block.matchAll(/^ {2}([a-z_]+) +\S/gm)].map((m) => m[1]).filter((c) => c !== 'constraint')
  }

  it('is one transaction', () => {
    expect(c0010.trim().startsWith('begin;')).toBe(true)
    expect(c0010.trim().endsWith('commit;')).toBe(true)
  })

  it('lets the app read the public columns only: every column except item_key, score and matched', () => {
    const list = /grant select \(([^)]*)\)\s+on public\.news_items to anon, authenticated;/.exec(c0010)?.[1] ?? ''
    const granted = list.split(',').map((c) => c.trim())
    expect(granted).toEqual(PUBLIC_COLUMNS)
    expect(newsColumns().filter((c) => !['item_key', 'score', 'matched'].includes(c)).sort()).toEqual([...PUBLIC_COLUMNS].sort())
  })

  it('takes everything else away from the app, on both tables', () => {
    expect(c0010).toMatch(/revoke all on public\.news_items from public, anon, authenticated;/)
    expect(c0010).toMatch(/revoke all on public\.news_source_state from public, anon, authenticated;/)
    expect(c0010).not.toMatch(/grant [^;]*(insert|update|delete)[^;]*to [^;]*(anon|authenticated)/)
    expect(c0010).not.toMatch(/grant [^;]*on public\.news_source_state to [^;]*(anon|authenticated)/)
    expect(c0010).not.toMatch(/create policy [^;]*on public\.news_source_state/)
  })

  it('has one policy on news_items, and it only reads', () => {
    const policies = [...c0010.matchAll(/create policy [^;]*on public\.news_items[^;]*;/g)].map((m) => m[0])
    expect(policies).toHaveLength(1)
    expect(policies[0]).toMatch(/for select to anon, authenticated using \(true\)/)
  })

  it('turns on row level security for both tables', () => {
    expect(c0010).toContain('alter table public.news_items enable row level security;')
    expect(c0010).toContain('alter table public.news_source_state enable row level security;')
  })

  it('lets only the function (service_role) write', () => {
    expect(c0010).toContain('grant select, insert, update, delete on public.news_items to service_role;')
    expect(c0010).toContain('grant select, insert, update on public.news_source_state to service_role;')
  })

  it('keeps run_news_refresh() locked down, and sends the header the function checks', () => {
    const def = latestFunction('run_news_refresh')
    expect(def).toMatch(/security definer/)
    expect(def).toContain("set search_path = ''")
    expect(def).toContain("name = 'news_secret'")
    expect(def).toContain("'x-news-secret', secret")
    expect(c0010).toMatch(/revoke all on function public\.run_news_refresh\(\) from public, anon, authenticated;/)
    const index = readFileSync(join(SUPABASE, 'functions', 'news-refresh', 'index.ts'), 'utf8')
    expect(index).toContain("req.headers.get('x-news-secret')")
  })

  it('runs every 15 minutes, away from the cleanup (minute 0) and forecast (minute 23) jobs', () => {
    const schedule = /cron\.schedule\('news-refresh', '([^']+)'/.exec(c0010)?.[1] ?? ''
    const minutes = schedule.split(' ')[0].split(',').map(Number)
    expect(minutes).toEqual([4, 19, 34, 49])
    expect(minutes).not.toContain(0)
    expect(minutes).not.toContain(23)
  })

  it('deletes headlines after 7 days', () => {
    expect(c0010).toMatch(/cron\.schedule\('news-cleanup'[\s\S]*delete from public\.news_items where published_at < now\(\) - interval '7 days'/)
  })

  it('allows links as long as the function does, and the same Sri Lanka bounds as reports', () => {
    expect(c0010).toContain("url ~ '^https://' and char_length(url) <= 2048")
    expect(c0010).toContain('char_length(item_key) <= 2048')
    expect(c0010).toContain('extensions.st_x(location::extensions.geometry) between 79.4 and 82.1')
    expect(c0010).toContain('extensions.st_y(location::extensions.geometry) between 5.7 and 10.0')
  })

  it('does not add the table to Realtime (the app refetches instead)', () => {
    expect(c0010).not.toMatch(/supabase_realtime/)
  })
})

describe('the privacy checks know about the news feed', () => {
  const privacy = code(read('checks', 'privacy.sql'))

  it('lists news_items among the tables the API may read (check 6)', () => {
    expect(privacy).toMatch(/select 6,[\s\S]*?'island_forecast', 'news_items'/)
  })

  it('checks that news_items is read-only with score and matched private, and news_source_state closed (check 17)', () => {
    const check = /select 17,[\s\S]*?news_source_state'\)/.exec(privacy)?.[0] ?? ''
    for (const text of ["'score', 'select'", "'matched', 'select'", "'insert'", "'update'", "'delete'", 'relrowsecurity']) {
      expect(check, text).toContain(text)
    }
  })

  it('no longer says 0010 is the photo-path cleanup', () => {
    expect(read('checks', 'privacy.sql')).not.toMatch(/0010 can go ahead/)
    expect(read('migrations', '0009_hide_user_ids.sql')).not.toMatch(/Migration 0010 removes/)
  })
})

describe('0011: landslide areas', () => {
  const m0011 = migration('0011_landslide_areas').sql
  const c0011 = code(m0011)
  const WARNING_PUBLIC = ['id', 'message_id', 'update_number', 'issued_at', 'valid_from', 'valid_to', 'listed_at', 'pdf_url', 'parse_ok']
  const AREA_PUBLIC = ['warning_id', 'level', 'district_name', 'ds_name', 'area_code', 'district_code', 'shift', 'added', 'match_note']

  function columnsOf(table: string): string[] {
    const block = new RegExp(`create table public\\.${table} \\(([\\s\\S]*?)\\n\\);`).exec(c0011)?.[1] ?? ''
    return [...block.matchAll(/^ {2}([a-z_]+) +\S/gm)].map((m) => m[1]).filter((c) => c !== 'constraint')
  }
  const grantList = (table: string) =>
    (new RegExp(`grant select \\(([^)]*)\\)\\s+on public\\.${table} to anon, authenticated;`).exec(c0011)?.[1] ?? '').split(',').map((c) => c.trim())

  it('is one transaction, and stops with a message if 0010 has not been run', () => {
    expect(c0011.trim().startsWith('begin;')).toBe(true)
    expect(c0011.trim().endsWith('commit;')).toBe(true)
    expect(c0011).toContain("to_regclass('public.news_source_state') is null")
    expect(c0011).toContain('Migration 0011 needs migration 0010 first')
  })

  it('has the three tables, with the columns the function writes', () => {
    expect(columnsOf('landslide_warnings')).toEqual(['id', 'pdf_url', 'message_id', 'update_number', 'listed_at', 'issued_at', 'valid_from', 'valid_to', 'parse_ok', 'parse_error', 'fetched_at'])
    expect(columnsOf('landslide_areas')).toEqual(['id', ...AREA_PUBLIC])
    expect(columnsOf('landslide_seen_pdfs')).toEqual(['pdf_url', 'outcome', 'note', 'seen_at'])
  })

  it('lets the app read named columns only: everything except parse_error and fetched_at on warnings, and everything except the row id on areas', () => {
    expect(grantList('landslide_warnings')).toEqual(WARNING_PUBLIC)
    expect(columnsOf('landslide_warnings').filter((c) => !['parse_error', 'fetched_at'].includes(c)).sort()).toEqual([...WARNING_PUBLIC].sort())
    expect(grantList('landslide_areas')).toEqual(AREA_PUBLIC)
    expect(columnsOf('landslide_areas').filter((c) => c !== 'id').sort()).toEqual([...AREA_PUBLIC].sort())
    expect(grantList('landslide_areas')).not.toContain('id')
  })

  it('takes everything else away from the app, on all three tables, and gives the seen list no grant or policy at all', () => {
    for (const table of ['landslide_warnings', 'landslide_areas', 'landslide_seen_pdfs']) {
      expect(c0011, table).toMatch(new RegExp(`revoke all on public\\.${table} from public, anon, authenticated;`))
      expect(c0011, table).toContain(`alter table public.${table} enable row level security;`)
    }
    // (word boundaries: update_number is a column, not the update privilege)
    expect(c0011).not.toMatch(/grant [^;]*\b(insert|update|delete)\b[^;]*to [^;]*(anon|authenticated)/)
    expect(c0011).not.toMatch(/grant [^;]*on public\.landslide_seen_pdfs to [^;]*(anon|authenticated)/)
    expect(c0011).not.toMatch(/create policy [^;]*on public\.landslide_seen_pdfs/)
  })

  it('has one policy on each public table, and it only reads', () => {
    for (const table of ['landslide_warnings', 'landslide_areas']) {
      const policies = [...c0011.matchAll(new RegExp(`create policy [^;]*on public\\.${table}[^;]*;`, 'g'))].map((m) => m[0])
      expect(policies, table).toHaveLength(1)
      expect(policies[0]).toMatch(/for select to anon, authenticated using \(true\)/)
    }
  })

  it('lets the function (service_role) read and add rows, and nothing more: Supabase’s default privileges are taken away first', () => {
    for (const table of ['landslide_warnings', 'landslide_areas', 'landslide_seen_pdfs']) {
      const revoke = c0011.indexOf(`revoke all on public.${table} from service_role;`)
      const grant = c0011.indexOf(`grant select, insert on public.${table} to service_role;`)
      expect(revoke, table).toBeGreaterThan(-1)
      expect(grant, table).toBeGreaterThan(revoke)
    }
    expect(c0011).not.toMatch(/grant [^;]*\b(update|delete|truncate|all)\b[^;]*to service_role/)
  })

  it('checks before it commits that service_role can only read and add rows in all three tables', () => {
    const block = /do \$\$\ndeclare[\s\S]*?\n\$\$;/.exec(c0011)?.[0] ?? ''
    expect(block).toContain("array['public.landslide_warnings', 'public.landslide_areas', 'public.landslide_seen_pdfs']")
    for (const text of [
      "not has_table_privilege('service_role', t, 'select')",
      "not has_table_privilege('service_role', t, 'insert')",
      "has_any_column_privilege('service_role', t, 'update')",
      "has_table_privilege('service_role', t, 'delete')",
      "has_table_privilege('service_role', t, 'truncate')",
      'raise exception',
    ]) {
      expect(block, text).toContain(text)
    }
  })

  it('stores PDF links on DMC’s own site only, with the same rule as the function', () => {
    const rules = [...c0011.matchAll(/pdf_url ~ '([^']+)' and char_length\(pdf_url\) <= 2048/g)].map((m) => m[1])
    // landslide_warnings and landslide_seen_pdfs
    expect(rules).toHaveLength(2)
    expect(new Set(rules).size).toBe(1)
    expect(rules[0]).toBe(PDF_URL_RULE.source.replace(/\\\//g, '/'))
    expect(MAX_PDF_URL).toBe(2048)
    // the SQL pattern, read as a JS one, says yes and no to the same links as isPdfLink()
    const sql = new RegExp(rules[0])
    for (const url of [
      'https://www.dmc.gov.lk/images/dmcreports/LEWM_14-11-2026_16_00__1794660156.pdf',
      'https://dmc.gov.lk/images/dmcreports/a.pdf',
      'http://www.dmc.gov.lk/images/dmcreports/a.pdf',
      'https://evil.example/images/dmcreports/a.pdf',
      'https://www.dmc.gov.lk.evil.example/images/dmcreports/a.pdf',
      'https://wwwXdmc.gov.lk/images/dmcreports/a.pdf',
      'https://www.dmc.gov.lk/images/other/a.pdf',
    ]) {
      expect(sql.test(url), url).toBe(isPdfLink(url))
    }
  })

  it('has the same message ID and p-code patterns as the function checks before storing', () => {
    expect(c0011).toContain(`message_id ~ '${MESSAGE_ID_RULE.source}'`)
    expect(c0011).toContain(`area_code ~ '${AREA_CODE_RULE.source}'`)
    expect(c0011).toContain(`district_code ~ '${DISTRICT_CODE_RULE.source}'`)
    expect(c0011).toContain(`char_length(parse_error) between 1 and ${MAX_PARSE_ERROR}`)
    expect(c0011).toContain(`char_length(match_note) <= ${MAX_MATCH_NOTE}`)
    expect(c0011).toContain(`char_length(district_name) between 1 and ${MAX_DISTRICT_NAME}`)
    expect(c0011).toContain(`char_length(ds_name) between 1 and ${MAX_DS_NAME}`)
    expect(c0011).toContain('update_number between 0 and 999')
    expect(c0011).toContain('shift between -2 and 2')
  })

  it('every p-code in the boundary files and the names list fits those patterns', () => {
    const area = new RegExp(/area_code ~ '([^']+)'/.exec(c0011)![1])
    const district = new RegExp(/district_code ~ '([^']+)'/.exec(c0011)![1])
    const json = (...parts: string[]) => JSON.parse(readFileSync(join(__dirname, '..', '..', ...parts), 'utf8'))
    const ds = json('src', 'data', 'areas', 'ds.json').features.map((f: { properties: { code: string; district: string } }) => f.properties)
    const districts = json('src', 'data', 'areas', 'districts.json').features.map((f: { properties: { code: string } }) => f.properties)
    const names = json('supabase', 'functions', 'landslide-refresh', 'ds-names.json')
    const checks: [string, string, RegExp][] = [
      ...ds.map((p: { code: string }) => ['ds.json', p.code, area] as [string, string, RegExp]),
      ...ds.map((p: { district: string }) => ['ds.json district', p.district, district] as [string, string, RegExp]),
      ...districts.map((p: { code: string }) => ['districts.json', p.code, district] as [string, string, RegExp]),
      ...names.divisions.map((d: { code: string }) => ['ds-names.json', d.code, area] as [string, string, RegExp]),
      ...names.divisions.map((d: { district: string }) => ['ds-names.json district', d.district, district] as [string, string, RegExp]),
      ...names.districts.map((d: { code: string }) => ['ds-names.json', d.code, district] as [string, string, RegExp]),
    ]
    expect(ds).toHaveLength(339)
    expect(districts).toHaveLength(25)
    for (const [file, value, rule] of checks) expect(rule.test(value), `${file}: ${value}`).toBe(true)
    // and a division's code starts with its district's, as landslide_areas_matched_or_explained wants
    for (const d of [...ds, ...names.divisions] as { code: string; district: string }[]) expect(d.code.startsWith(d.district), d.code).toBe(true)
  })

  it('refuses a warning that is half-read: a read one is complete, an unread one has only its reason', () => {
    const rule = /constraint landslide_warnings_read_or_not check \(([\s\S]*?)\n {2}\)\n\);/.exec(c0011)?.[1] ?? ''
    expect(rule).not.toBe('')
    const [read, notRead] = rule.split(/\n {4}or\n/)
    for (const text of ['parse_ok', 'message_id is not null', 'update_number is not null', 'issued_at is not null', 'valid_from is not null', 'valid_to is not null', 'valid_to > valid_from', 'parse_error is null']) {
      expect(read, text).toContain(text)
    }
    for (const text of ['not parse_ok', 'parse_error is not null', 'message_id is null', 'update_number is null', 'issued_at is null', 'valid_from is null', 'valid_to is null']) {
      expect(notRead, text).toContain(text)
    }
  })

  it('keeps one warning per message and one per address, and a division at one level only', () => {
    expect(c0011).toMatch(/pdf_url\s+text not null unique/)
    expect(c0011).toMatch(/message_id\s+text unique/)
    expect(c0011).toContain("message_id ~ '^LEWM-[0-9]{2}-[0-9]{2}-[0-9]{4}-[0-9]{4}-[0-9]{1,3}$'")
    expect(c0011).toMatch(/create unique index landslide_areas_one_per_division on public\.landslide_areas \(warning_id, area_code\)\s+where area_code is not null;/)
  })

  it('never drops an unmatched name: a name is matched with its codes, or has a null code and a reason', () => {
    const rule = /constraint landslide_areas_matched_or_explained check \(([\s\S]*?)\n {2}\)\n\);/.exec(c0011)?.[1] ?? ''
    expect(rule).toContain("area_code is not null and district_code is not null and area_code like (district_code || '%') and match_note is null")
    expect(rule).toContain('area_code is null and match_note is not null')
    expect(c0011).toContain("area_code ~ '^LK[0-9]{4}$'")
    expect(c0011).toContain("district_code ~ '^LK[0-9]{2}$'")
    expect(c0011).toContain('level between 1 and 3')
  })

  it('removes a warning’s areas with it', () => {
    expect(c0011).toMatch(/warning_id\s+bigint not null references public\.landslide_warnings \(id\) on delete cascade/)
    expect(c0011).toContain('create index landslide_areas_warning on public.landslide_areas (warning_id);')
  })

  describe('store_landslide_warning()', () => {
    const def = latestFunction('store_landslide_warning')

    it('writes the warning and its areas in one function, so one transaction', () => {
      expect(def.match(/insert into public\.landslide_warnings/g)).toHaveLength(1)
      expect(def.match(/insert into public\.landslide_areas/g)).toHaveLength(1)
      expect(def).toContain('on conflict do nothing')
      expect(def).toContain('returning id into new_id')
      expect(def).toMatch(/if new_id is null then\s+return null;/)
    })

    it('refuses areas on a warning that could not be read', () => {
      expect(def).toContain('a warning that could not be read has no areas')
    })

    it('runs as the caller with an empty search path, and only service_role can run it', () => {
      expect(def).not.toMatch(/security definer/)
      expect(def).toContain("set search_path = ''")
      expect(c0011).toMatch(/revoke all on function public\.store_landslide_warning\(jsonb, jsonb\) from public, anon, authenticated;/)
      expect(c0011).toContain('grant execute on function public.store_landslide_warning(jsonb, jsonb) to service_role;')
      expect(c0011).not.toMatch(/grant execute on function public\.store_landslide_warning[^;]*(anon|authenticated)/)
    })

    it('writes every column of both tables that the function sends, and never fetched_at', () => {
      expect(def).toContain('(pdf_url, message_id, update_number, listed_at, issued_at, valid_from, valid_to, parse_ok, parse_error)')
      expect(def).toContain('(warning_id, level, district_name, ds_name, area_code, district_code, shift, added, match_note)')
      expect(def).not.toContain('fetched_at')
    })
  })

  describe('landslide_current()', () => {
    const def = latestFunction('landslide_current')
    const body = def.slice(def.indexOf('as $$'))

    it('runs as the caller, only reads, and the app can run it', () => {
      expect(def).not.toMatch(/security definer/)
      expect(def).toMatch(/language sql\s+stable/)
      expect(def).toContain("set search_path = ''")
      expect(c0011).toContain('grant execute on function public.landslide_current() to anon, authenticated;')
      expect(c0011).toMatch(/revoke all on function public\.landslide_current\(\) from public;/)
      // without the quoted words: 'update' is a key of the answer, not a statement
      expect(body.replace(/'(?:[^']|'')*'/g, "''")).not.toMatch(/\b(insert|update|delete)\b/i)
    })

    it('reads the NEWEST warning only, by when DMC listed it, and never another one', () => {
      expect(body.match(/from public\.landslide_warnings/g)).toHaveLength(1)
      expect(body).toMatch(/order by w\.listed_at desc, w\.id desc\s+limit 1/)
    })

    it('says whether the newest could be read, and gives no areas and no "valid" for one that could not', () => {
      expect(body).toContain("'parse_ok', n.parse_ok")
      expect(body).toContain("'valid', n.parse_ok and n.valid_to > now()")
      expect(body).toMatch(/when n\.parse_ok then coalesce\(\(/)
      expect(body).toMatch(/else '\[\]'::jsonb/)
      expect(body).toContain("jsonb_build_object('found', false)")
    })

    it('has no fallback to an older warning: the areas come from the warning it picked, by its id', () => {
      expect(body.match(/from public\.landslide_areas a/g)).toHaveLength(1)
      expect(body).toContain('where a.warning_id = n.id')
      expect(body).not.toMatch(/\bunion\b|\bfallback\b|\bparse_ok\s*=\s*true\b/i)
    })

    it('uses only columns the app is allowed to read (it runs with the caller’s rights), and no star select', () => {
      const warningCols = new Set(grantList('landslide_warnings'))
      const areaCols = new Set(grantList('landslide_areas'))
      for (const m of body.matchAll(/\b[wn]\.([a-z_]+)/g)) expect(warningCols.has(m[1]), `w.${m[1]}`).toBe(true)
      for (const m of body.matchAll(/\ba\.([a-z_]+)/g)) expect(areaCols.has(m[1]), `a.${m[1]}`).toBe(true)
      expect(body).not.toMatch(/\b\w+\.\*|select\s+\*/i)
      expect(body).not.toMatch(/parse_error|fetched_at/)
    })
  })

  it('keeps run_landslide_refresh() locked down, and sends the header the function checks', () => {
    const def = latestFunction('run_landslide_refresh')
    expect(def).toMatch(/security definer/)
    expect(def).toContain("set search_path = ''")
    expect(def).toContain("name = 'landslide_secret'")
    expect(def).toContain("name = 'project_url'")
    expect(def).toContain("'x-landslide-secret', secret")
    expect(def).toContain("base_url || '/functions/v1/landslide-refresh'")
    expect(def).toContain('timeout_milliseconds := 60000')
    expect(c0011).toMatch(/revoke all on function public\.run_landslide_refresh\(\) from public, anon, authenticated;/)
  })

  it('runs every 30 minutes at minutes no other job uses, and cleans up at one more of its own', () => {
    const schedule = /cron\.schedule\('landslide-refresh', '([^']+)'/.exec(c0011)?.[1] ?? ''
    const cleanup = /cron\.schedule\('landslide-cleanup', '([^']+)'/.exec(c0011)?.[1] ?? ''
    expect(schedule).toBe('9,39 * * * *')
    expect(cleanup).toBe('56 * * * *')
    const mine = [...schedule.split(' ')[0].split(',').map(Number), ...cleanup.split(' ')[0].split(',').map(Number)]
    expect(schedule.split(' ')[0].split(',').map(Number)[1] - Number(schedule.split(' ')[0].split(',')[0])).toBe(30)
    const others = migrations
      .filter((m) => !m.name.startsWith('0011'))
      .flatMap((m) => [...code(m.sql).matchAll(/cron\.schedule\('([^']+)',\s*'([^']+)'/g)].map((x) => ({ name: x[1], minutes: x[2].split(' ')[0].split(',').map(Number) })))
    // The jobs that exist: cleanup-expired, forecast-refresh, news-refresh, news-cleanup
    expect(others.map((o) => o.name).sort()).toEqual(['cleanup-expired', 'forecast-refresh', 'news-cleanup', 'news-refresh'])
    for (const o of others) for (const minute of o.minutes) expect(mine, `${o.name} runs at minute ${minute}`).not.toContain(minute)
  })

  it('deletes warnings (and with them their areas) and skipped PDFs after 14 days', () => {
    expect(c0011).toMatch(/cron\.schedule\('landslide-cleanup'[\s\S]*delete from public\.landslide_warnings where listed_at < now\(\) - interval '14 days';/)
    expect(c0011).toMatch(/delete from public\.landslide_seen_pdfs where seen_at < now\(\) - interval '14 days'/)
  })

  it('checks its own grants before it commits, and reloads the API schema', () => {
    for (const text of ["'parse_error', 'select'", "'fetched_at', 'select'", 'store_landslide_warning(jsonb, jsonb)', 'raise exception']) {
      expect(c0011, text).toContain(text)
    }
    expect(c0011).toContain("notify pgrst, 'reload schema';")
  })

  it('does not add the tables to Realtime (the app refetches instead)', () => {
    expect(c0011).not.toMatch(/supabase_realtime/)
  })

  it('takes the number after the news feed, and the photo-path cleanup waits for the next one', () => {
    expect(migrations.map((m) => m.name.slice(0, 4)).filter((n) => n >= '0010')).toEqual(['0010', '0011'])
    expect(m0011).toMatch(/takes the next free number after this one/)
  })
})

describe('the privacy checks know about the landslide tables', () => {
  const privacy = code(read('checks', 'privacy.sql'))

  it('lists them among the tables the API may read, and not the closed one (check 6)', () => {
    const list = /select 6,[\s\S]*?bool_and\(c\.relname in \(([^)]*)\)/.exec(privacy)?.[1] ?? ''
    expect(list).toContain("'landslide_warnings'")
    expect(list).toContain("'landslide_areas'")
    expect(list).not.toContain('landslide_seen_pdfs')
  })

  it('checks that they are read-only with parse_error and fetched_at private, the seen list closed, and storing for service_role only (check 18)', () => {
    const check = /select 18,[\s\S]*?'landslide_seen_pdfs'\)/.exec(privacy)?.[0] ?? ''
    for (const text of ["'parse_error', 'select'", "'fetched_at', 'select'", "'insert'", "'update'", "'delete'", 'relrowsecurity', 'store_landslide_warning']) {
      expect(check, text).toContain(text)
    }
    // by oid, so it says FAIL and not an error before 0011 has been run
    expect(check).toMatch(/has_function_privilege\('anon', p\.oid, 'execute'\)/)
    expect(check).not.toMatch(/has_function_privilege\('anon', 'public\./)
  })
})

describe('the 0011 check script', () => {
  const check = read('checks', '0011_check.sql')

  it('has one line per check with distinct column names, numbered in order', () => {
    expect(check).toMatch(/select ord, check_name, case when ok then 'PASS' else 'FAIL' end as result, detail/)
    const numbers = [...code(check).matchAll(/select (\d+)(?: as ord)?,/g)].map((m) => Number(m[1]))
    expect(numbers).toEqual(Array.from({ length: numbers.length }, (_, i) => i + 1))
    expect(numbers.length).toBeGreaterThanOrEqual(20)
  })

  it('checks that service_role can only read and add rows (check 8)', () => {
    const check8 = /select 8,[\s\S]*?\n {4}union all/.exec(code(check))?.[0] ?? ''
    for (const text of ["'service_role', c.oid, 'select'", "'service_role', c.oid, 'insert'", "not has_any_column_privilege('service_role', c.oid, 'update')", "not has_table_privilege('service_role', c.oid, 'delete')", "not has_table_privilege('service_role', c.oid, 'truncate')", 'count(*) = 3']) {
      expect(check8, text).toContain(text)
    }
  })

  it('covers what the migration promises', () => {
    for (const text of [
      'landslide_seen_pdfs',
      'parse_error',
      'store_landslide_warning',
      'landslide_current',
      'run_landslide_refresh',
      "'landslide_secret'",
      "'9,39 * * * *'",
      "'56 * * * *'",
      'supabase_realtime',
      'news_source_state',
    ]) {
      expect(check, text).toContain(text)
    }
  })

  it('says what the newest warning would tell the app, and never shows the secret', () => {
    expect(check).toContain('public.landslide_current()')
    expect(code(check)).not.toMatch(/decrypted_secret/)
    expect(code(check)).toMatch(/from vault\.secrets where name = 'landslide_secret'/)
  })
})

describe('the check scripts', () => {
  it('only read: the SQL checks change nothing', () => {
    for (const file of ['privacy.sql', '0009_live_definitions.sql', '0010_check.sql', '0011_check.sql']) {
      expect(bare(read('checks', file)), file).not.toMatch(/\b(insert|update|delete|drop|alter|grant|revoke|create|truncate)\b/i)
    }
  })

  it('never print the key', () => {
    const script = read('checks', 'privacy.ps1')
    expect(script).not.toMatch(/Write-Host[^\n]*\$key\b/)
    expect(script).not.toMatch(/service_role/)
  })
})
