import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { newPhotoPath } from './photoName'

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

  it('lets a signed-in user upload a random name or (until 0010) the old own folder, and nothing else', () => {
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

describe('the check scripts', () => {
  it('only read: the SQL checks change nothing', () => {
    for (const file of ['privacy.sql', '0009_live_definitions.sql']) {
      expect(bare(read('checks', file)), file).not.toMatch(/\b(insert|update|delete|drop|alter|grant|revoke|create|truncate)\b/i)
    }
  })

  it('never print the key', () => {
    const script = read('checks', 'privacy.ps1')
    expect(script).not.toMatch(/Write-Host[^\n]*\$key\b/)
    expect(script).not.toMatch(/service_role/)
  })
})
