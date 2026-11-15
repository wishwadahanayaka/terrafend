import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// Migration 0009 takes created_by away from the API. These tests read the app's own source and
// fail if some code starts to ask for it again, or reads a table in a way that would now be refused.

const SRC = join(__dirname, '..')

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return sourceFiles(path)
    return /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : []
  })
}

// Source without whole-line comments (a comment may explain why something is NOT read)
function codeOf(file: string): string {
  return readFileSync(file, 'utf8')
    .replace(/\r\n/g, '\n')
    .split('\n')
    .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
    .join('\n')
}

const files = sourceFiles(SRC).map((file) => ({ name: file.split('src')[1], code: codeOf(file) }))
const everything = files.map((f) => f.code).join('\n')

describe('what the app asks the database for', () => {
  it('finds the source files', () => {
    expect(files.length).toBeGreaterThan(50)
  })

  it('never mentions created_by or user_id', () => {
    const found = files.filter((f) => /\b(created_by|user_id)\b/.test(f.code)).map((f) => f.name)
    expect(found).toEqual([])
  })

  it('only sends reports in: insert, then read back just the id', () => {
    const uses = [...everything.matchAll(/\.from\('reports'\)([\s\S]{0,400})/g)]
    expect(uses.length).toBeGreaterThan(0)
    for (const use of uses) {
      expect(use[1].trimStart().startsWith('.insert(')).toBe(true)
      expect(use[1]).toContain(".select('id')")
    }
  })

  it('only reads the vote itself from report_votes, and otherwise inserts', () => {
    const uses = [...everything.matchAll(/\.from\('report_votes'\)\s*(\.\w+\([^)]*\))/g)]
    expect(uses.length).toBeGreaterThan(0)
    for (const use of uses) {
      expect([".select('vote')"].includes(use[1]) || use[1].startsWith('.insert(')).toBe(true)
    }
  })

  it('touches no other table through the client', () => {
    const tables = new Set([...everything.matchAll(/\.from\('([a-z_]+)'\)/g)].map((m) => m[1]))
    // 'report-photos' is a storage bucket and is written with a dash, so it is not in this list
    expect([...tables].sort()).toEqual(['report_votes', 'reports'])
  })

  it('never selects everything', () => {
    expect(everything).not.toMatch(/\.select\(\s*\)/)
    expect(everything).not.toMatch(/\.select\(\s*['"`]\s*\*/)
    expect(everything).not.toMatch(/select=\*/)
  })

  it('reads the REST API directly only for the forecast cache and the news headlines', () => {
    const paths = [...everything.matchAll(/\/rest\/v1\/([a-z_]+)/g)].map((m) => m[1])
    expect(paths.length).toBeGreaterThan(0)
    expect(new Set(paths)).toEqual(new Set(['island_forecast', 'news_items']))
  })

  it('only reads the news table, and never asks for the private columns of it', () => {
    const news = files.find((f) => f.name.endsWith('newsFetch.ts'))
    expect(news?.code).toContain('/rest/v1/news_items')
    expect(news?.code).not.toMatch(/method:\s*'(POST|PUT|PATCH|DELETE)'|\.insert\(|\.upsert\(|\.update\(|\.delete\(/)
    expect(news?.code).not.toMatch(/item_key|\bscore\b|\bmatched\b/)
  })

  it('only calls functions that exist in the migrations', () => {
    const migrations = readdirSync(join(SRC, '..', 'supabase', 'migrations'))
      .filter((name) => name.endsWith('.sql'))
      .map((name) => readFileSync(join(SRC, '..', 'supabase', 'migrations', name), 'utf8'))
      .join('\n')
    const called = new Set([...everything.matchAll(/\.rpc\('([a-z_]+)'/g)].map((m) => m[1]))
    expect(called.size).toBeGreaterThan(5)
    for (const name of called) {
      expect(migrations, name).toMatch(new RegExp(`create (or replace )?function public\\.${name}\\(`))
    }
  })

  it('does not put anything about the user in a photo name', () => {
    const photos = files.find((f) => f.name.endsWith('photos.ts'))
    expect(photos?.code).not.toMatch(/getSession|user\.id|userId/)
  })
})
