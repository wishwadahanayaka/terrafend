import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fakeNewsModes } from './fakeNews'
import { NEWS_MAX_ITEMS, NEWS_WINDOW_MS, type NewsItem } from './news'
import {
  fetchNews,
  loadNews,
  NEWS_COLUMNS,
  NEWS_REFRESH_MS,
  NEWS_REFRESH_OPEN_MS,
  NEWS_RETRY_DELAY_MS,
  NEWS_STALE_MS,
  newsQueryOptions,
  newsUrl,
  READ_TIMEOUT_MS,
} from './newsFetch'
import { NEWS_SAVED_MAX_AGE_MS } from './offline'

// Nothing here reaches Supabase or the news sites: every request is answered by a stand-in. All
// headlines are made-up wording.

const NOW = Date.parse('2026-11-15T10:30:00Z')
const MIN = 60_000
const BASE = 'https://example-project.supabase.co'
const KEY = 'sb_publishable_not_a_real_key'

const dbRow = (id: number, over: Record<string, unknown> = {}) => ({
  id,
  url: `https://adaderana.lk/news/${id}`,
  title: `w${id}a w${id}b`,
  source: 'adaderana_en',
  kind: 'media',
  channel: null,
  language: 'en',
  hazard: 'rain',
  published_at: new Date(NOW - 30 * MIN).toISOString(),
  fetched_at: new Date(NOW - 28 * MIN).toISOString(),
  ended_at: null,
  ...over,
})

const answer = (body: unknown, status = 200) =>
  ({ ok: status >= 200 && status < 300, status, json: async () => body }) as unknown as Response
const reader = (reply: () => Promise<Response>) => vi.fn<typeof fetch>(async () => reply())

describe('the request', () => {
  const url = newsUrl(BASE, NOW)

  it('goes to the news_items table of the project and nowhere else', () => {
    expect(url.startsWith(`${BASE}/rest/v1/news_items?`)).toBe(true)
  })

  it('names its columns, which are only the ones the app may read', () => {
    expect(url).toContain(`select=${NEWS_COLUMNS}`)
    expect(url).not.toContain('select=*')
    const columns = NEWS_COLUMNS.split(',')
    for (const private_ of ['item_key', 'score', 'matched', 'location', 'place_name']) expect(columns).not.toContain(private_)
    // every one is in the column grant of migration 0010
    const sql = readFileSync(join(__dirname, '..', '..', 'supabase', 'migrations', '0010_news_feed.sql'), 'utf8')
    const granted = /grant select \(([^)]*)\)\s+on public\.news_items to anon, authenticated;/.exec(sql)?.[1] ?? ''
    const allowed = granted.split(',').map((c) => c.trim())
    for (const column of columns) expect(allowed, column).toContain(column)
  })

  it('asks for the last 48 hours only', () => {
    const since = new URL(url).searchParams.get('published_at')
    expect(since).toBe(`gte.${new Date(NOW - NEWS_WINDOW_MS).toISOString()}`)
    expect(NEWS_WINDOW_MS).toBe(48 * 60 * MIN)
  })

  it('asks for at most 100 rows, official ones first and then the newest', () => {
    const params = new URL(url).searchParams
    expect(params.get('limit')).toBe('100')
    expect(NEWS_MAX_ITEMS).toBe(100)
    expect(params.get('order')).toBe('kind.desc,published_at.desc,id.desc')
  })
})

describe('fetchNews', () => {
  it('sends only the apikey header, never an Authorization header or a cookie', async () => {
    const fetchFn = reader(async () => answer([dbRow(1)]))
    await fetchNews({ url: BASE, key: KEY, fetchFn, now: NOW })
    expect(fetchFn).toHaveBeenCalledOnce()
    const [calledUrl, init] = fetchFn.mock.calls[0]
    expect(String(calledUrl)).toBe(newsUrl(BASE, NOW))
    expect(init?.headers).toEqual({ apikey: KEY, Accept: 'application/json' })
    expect(Object.keys(init?.headers ?? {}).map((h) => h.toLowerCase())).not.toContain('authorization')
    expect(init?.method).toBeUndefined()
    expect(init?.credentials).toBeUndefined()
  })

  it('gives up after a few seconds', async () => {
    const fetchFn = reader(async () => answer([]))
    await fetchNews({ url: BASE, key: KEY, fetchFn, now: NOW })
    expect(fetchFn.mock.calls[0][1]?.signal).toBeInstanceOf(AbortSignal)
    expect(READ_TIMEOUT_MS).toBeLessThanOrEqual(10_000)
  })

  it('returns the headlines it was given, read and checked', async () => {
    const fetchFn = reader(async () => answer([dbRow(1), dbRow(2, { url: 'https://evil.example/x' }), dbRow(3)]))
    const items = await fetchNews({ url: BASE, key: KEY, fetchFn, now: NOW })
    expect(items?.map((i) => i.id)).toEqual([1, 3])
    expect(items?.[0]).toMatchObject({ source: 'adaderana_en', publishedAt: NOW - 30 * MIN })
  })

  it('treats an empty list as an answer, not a failure', async () => {
    expect(await fetchNews({ url: BASE, key: KEY, fetchFn: reader(async () => answer([])), now: NOW })).toEqual([])
  })

  describe('never throws: any problem gives null', () => {
    const attempt = (fetchFn: typeof fetch) => fetchNews({ url: BASE, key: KEY, fetchFn, now: NOW })

    it.each([
      ['no connection', async () => Promise.reject(new TypeError('Failed to fetch'))],
      ['a timeout', async () => Promise.reject(Object.assign(new Error('The operation timed out.'), { name: 'TimeoutError' }))],
      ['an error answer', async () => answer({ message: 'permission denied' }, 401)],
      ['a server error', async () => answer(null, 503)],
      ['an answer that is not JSON', async () => ({ ok: true, status: 200, json: async () => Promise.reject(new SyntaxError('Unexpected token')) }) as unknown as Response],
      ['an answer that is not a list', async () => answer({ rows: [] })],
      ['a list where no row can be read (the table changed)', async () => answer([{ x: 1 }, { y: 2 }])],
    ])('%s', async (_name, reply) => {
      await expect(attempt(vi.fn<typeof fetch>(reply))).resolves.toBeNull()
    })

    it('without a project address or key, and then sends nothing', async () => {
      const fetchFn = reader(async () => answer([]))
      expect(await fetchNews({ url: '', key: KEY, fetchFn })).toBeNull()
      expect(await fetchNews({ url: BASE, key: '', fetchFn })).toBeNull()
      expect(fetchFn).not.toHaveBeenCalled()
    })

    it('even when fetch itself throws at once', async () => {
      const fetchFn = vi.fn<typeof fetch>(() => {
        throw new Error('sync boom')
      })
      await expect(attempt(fetchFn)).resolves.toBeNull()
    })
  })
})

describe('the query function', () => {
  afterEach(() => vi.unstubAllGlobals())
  const items: NewsItem[] = []

  it('gives the headlines', async () => {
    const read = vi.fn(async () => items)
    await expect(loadNews(read)).resolves.toBe(items)
  })

  it('treats an empty list as a good answer', async () => {
    await expect(loadNews(async () => [])).resolves.toEqual([])
  })

  it('throws when the read failed, so the headlines already on hand are kept', async () => {
    await expect(loadNews(async () => null)).rejects.toThrow('News unavailable')
  })

  it('uses the sample headlines instead with ?fakeNews= in the dev server, without reading', async () => {
    vi.stubGlobal('location', { search: '?fakeNews=media' })
    const read = vi.fn(async () => items)
    const got = await loadNews(read)
    expect(read).not.toHaveBeenCalled()
    expect(got.length).toBeGreaterThan(0)
    expect(got.every((i) => i.title.startsWith('TEST ·'))).toBe(true)
  })

  it('fails the way ?fakeNews=fail asks', async () => {
    vi.stubGlobal('location', { search: '?fakeNews=fail' })
    await expect(loadNews(async () => items)).rejects.toThrow('fakeNews=fail')
  })

  it('reads normally when no fake switch is in the address', async () => {
    vi.stubGlobal('location', { search: '?fakeRiver=x:alert' })
    expect(fakeNewsModes()).toBeNull()
    const read = vi.fn(async () => items)
    await loadNews(read)
    expect(read).toHaveBeenCalledOnce()
  })
})

describe('how often it asks again', () => {
  it('every 10 minutes while the app is open', () => {
    expect(NEWS_REFRESH_MS).toBe(10 * MIN)
    expect(newsQueryOptions(false).refetchInterval).toBe(10 * MIN)
  })

  it('every 5 minutes while the news sheet is open', () => {
    expect(NEWS_REFRESH_OPEN_MS).toBe(5 * MIN)
    expect(newsQueryOptions(true).refetchInterval).toBe(5 * MIN)
  })

  it('also when the app comes back to the foreground, or the connection returns', () => {
    const options = newsQueryOptions(false)
    expect(options.refetchOnWindowFocus).toBe(true)
    expect(options.refetchOnReconnect).toBe(true)
    // but not so soon after the last answer that flicking between apps asks every time
    expect(options.staleTime).toBe(NEWS_STALE_MS)
    expect(NEWS_STALE_MS).toBeGreaterThanOrEqual(30_000)
  })

  it('not while the tab is hidden', () => {
    expect(newsQueryOptions(true).refetchIntervalInBackground).toBe(false)
  })

  it('keeps the headlines in memory as long as they are saved on the phone, and retries once', () => {
    const options = newsQueryOptions(false)
    expect(options.gcTime).toBe(NEWS_SAVED_MAX_AGE_MS)
    expect(options.gcTime).toBe(24 * 60 * MIN)
    expect(options.retry).toBe(1)
  })

  it('retries soon, because until it has failed twice the sheet says "Loading"', () => {
    expect(newsQueryOptions(false).retryDelay).toBe(NEWS_RETRY_DELAY_MS)
    expect(NEWS_RETRY_DELAY_MS).toBeLessThanOrEqual(10_000)
  })
})

describe('the wiring', () => {
  const lib = join(__dirname)
  const read = (name: string) => readFileSync(join(lib, name), 'utf8')

  it('has one hook for the chip and the sheet, taking whether the sheet is open', () => {
    const hook = read('useNews.ts')
    expect(hook).toContain('export function useNews(sheetOpen = false, enabled = true)')
    expect(hook).toContain('queryKey: [NEWS_KEY]')
    expect(hook).toContain('...newsQueryOptions(sheetOpen)')
  })

  // The code without its // comments (some of them say "no Realtime")
  const code = (name: string) => read(name).split('\n').map((line) => line.replace(/\/\/.*$/, '')).join('\n')

  it('uses a plain request, not the Supabase client, and no Realtime', () => {
    for (const name of ['newsFetch.ts', 'useNews.ts', 'news.ts']) {
      const source = code(name)
      expect(source, name).not.toMatch(/from '\.\/supabase'|@supabase\/supabase-js|createClient/)
      expect(source, name).not.toMatch(/realtime|\.channel\(|\.subscribe\(|WebSocket/i)
    }
  })

  it('loads the sample headlines only inside a dev-server check, and nothing else imports them', () => {
    expect(read('newsFetch.ts')).toMatch(/if \(import\.meta\.env\.DEV\) \{\s+const fake = await import\('\.\/fakeNews'\)/)
    const src = join(__dirname, '..')
    const importers: string[] = []
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name)
        if (entry.isDirectory()) walk(full)
        else if (/\.tsx?$/.test(entry.name) && !entry.name.endsWith('.test.ts') && /from '\.\/fakeNews'|import\('\.\/fakeNews'\)/.test(readFileSync(full, 'utf8'))) importers.push(entry.name)
      }
    }
    walk(src)
    expect(importers).toEqual(['newsFetch.ts'])
  })
})
