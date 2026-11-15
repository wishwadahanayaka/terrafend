import { NEWS_MAX_ITEMS, NEWS_WINDOW_MS, parseNewsRows, type NewsItem } from './news'
import { NEWS_SAVED_MAX_AGE_MS } from './offline'

// Reading the news_items table (migration 0010), and how often to ask again. The table is public
// data, so the publishable key is all it needs. Like forecastCache.ts this is a plain request: the
// Supabase client is a big download, and the news shouldn't wait for it.

export const READ_TIMEOUT_MS = 8000

// Only the columns the app is allowed to read. select=* is refused by the column grant, and
// item_key, score and matched are private.
export const NEWS_COLUMNS = 'id,url,title,source,kind,channel,language,hazard,published_at,fetched_at,ended_at'

export function newsUrl(base: string, now: number): string {
  const since = encodeURIComponent(new Date(now - NEWS_WINDOW_MS).toISOString())
  // Official items first ("official" sorts after "media", so descending puts it first), then newest
  // first. With at most 100 rows, a busy day of news reports can't push the official notices out:
  // they are few, and they are the ones that matter most.
  return (
    `${base}/rest/v1/news_items?select=${NEWS_COLUMNS}&published_at=gte.${since}` +
    `&order=kind.desc,published_at.desc,id.desc&limit=${NEWS_MAX_ITEMS}`
  )
}

type ReadOptions = { url?: string; key?: string; fetchFn?: typeof fetch; now?: number }

// The last 48 hours of headlines, at most 100. Never throws: anything wrong (no connection, a
// timeout, an error answer, a list that makes no sense) gives null, which is not the same as an
// empty list. The caller decides what to show.
export async function fetchNews(options: ReadOptions = {}): Promise<NewsItem[] | null> {
  const base = options.url ?? import.meta.env.VITE_SUPABASE_URL
  const key = options.key ?? import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY
  if (!base || !key) return null
  try {
    const res = await (options.fetchFn ?? fetch)(newsUrl(base, options.now ?? Date.now()), {
      // Only the apikey header: the new publishable keys are not JWTs, so they can't go in Authorization
      headers: { apikey: key, Accept: 'application/json' },
      signal: AbortSignal.timeout(READ_TIMEOUT_MS),
    })
    if (!res.ok) return null
    return parseNewsRows(await res.json())
  } catch {
    return null
  }
}

// What the query runs. A failed read throws here, so TanStack Query keeps the headlines it already
// has and the sheet can say "News unavailable right now"; an empty list is a good answer.
export async function loadNews(read: () => Promise<NewsItem[] | null> = fetchNews): Promise<NewsItem[]> {
  if (import.meta.env.DEV) {
    const fake = await import('./fakeNews')
    const modes = fake.fakeNewsModes()
    if (modes) return fake.fakeNews(modes, Date.now())
  }
  const items = await read()
  if (items === null) throw new Error('News unavailable')
  return items
}

// How often to ask again. The data changes every 15 minutes at most, so this is gentle: every 10
// minutes while the app is open, every 5 while the news sheet is on screen, and when the app comes
// back to the foreground (once the last answer is a minute old). Nothing is pushed: no Realtime.
export const NEWS_REFRESH_MS = 10 * 60_000
export const NEWS_REFRESH_OPEN_MS = 5 * 60_000
export const NEWS_STALE_MS = 60_000

export function newsQueryOptions(sheetOpen: boolean) {
  return {
    refetchInterval: sheetOpen ? NEWS_REFRESH_OPEN_MS : NEWS_REFRESH_MS,
    // Not while the tab is hidden
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
    staleTime: NEWS_STALE_MS,
    // Kept as long as it is saved on the phone (24 hours), so it is there to show when offline
    gcTime: NEWS_SAVED_MAX_AGE_MS,
    retry: 1,
    retryDelay: 30_000,
  } as const
}
