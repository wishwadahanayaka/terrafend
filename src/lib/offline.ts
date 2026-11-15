import type { PersistedClient } from '@tanstack/react-query-persist-client'
import { NEWS_KEY, REPORTS_KEY } from './queryKeys'
import { t } from '../i18n'
import { sriLankaWhen } from './time'

const HOUR_MS = 3_600_000

// Saved data older than this is thrown away when the app opens. Six hours matches how
// long a report lives and how long a gauge reading counts as current.
export const SAVED_MAX_AGE_MS = 6 * HOUR_MS
// A saved forecast is dropped sooner than the rest: the map shows the next 3 hours, and the
// older a forecast is, the less it can be trusted for them
export const FORECAST_SAVED_MAX_AGE_MS = 3 * HOUR_MS
// Saved news headlines are kept longer: they are from the last 48 hours, and a headline from this
// morning is still worth reading tonight, with its time beside it
export const NEWS_SAVED_MAX_AGE_MS = 24 * HOUR_MS
// The saved file as a whole is thrown away when it is older than this. It has to be the longest of
// the above, since the library checks the file's age, not each query's. dropOldQueries then applies
// each query's own limit.
export const SAVED_FILE_MAX_AGE_MS = NEWS_SAVED_MAX_AGE_MS

export type Source = 'rivers' | 'measured-rain' | 'forecast' | 'alerts' | 'reports' | 'news'

// Which of the data sources a query belongs to. Only these are saved on the phone, and
// anything else (votes, place searches, routes, the reports for one map view) is not.
// Reports are saved only as the island-wide list: the map shows the part in view from it
// when it is offline, and the number of saved copies can't grow as the map is panned.
export function sourceOf(key: readonly unknown[]): Source | null {
  switch (key[0]) {
    case 'river-gauges':
      return 'rivers'
    case 'rain-measured':
      return 'measured-rain'
    case 'rain-map':
      return 'forecast'
    case 'gdacs':
      return key[1] === 'core' || key[1] === 'green' ? 'alerts' : null
    case REPORTS_KEY:
      return key[1] === 'island' ? 'reports' : null
    case NEWS_KEY:
      return 'news'
    default:
      return null
  }
}

// With the dev test switches on (?fakeRiver= and so on) only the forecast is kept. The
// switches change the other data as it loads, and test data must never be saved. The forecast
// is safe because the fake rain is put on top of it when it is drawn, not into what is saved.
export function shouldSave(key: readonly unknown[], forecastOnly = false): boolean {
  const source = sourceOf(key)
  return forecastOnly ? source === 'forecast' : source !== null
}

// Whether a query goes into the saved file right now. Only answers that loaded, except the
// forecast and the news: after a failed refresh their older data is still good for a while
// and must stay in the file, or a reload during an outage would lose it.
export function shouldSaveQuery(
  key: readonly unknown[],
  state: { status: string; data: unknown },
  forecastOnly = false,
): boolean {
  if (!shouldSave(key, forecastOnly)) return false
  const keepsOldData = sourceOf(key) === 'forecast' || sourceOf(key) === 'news'
  return state.status === 'success' || (keepsOldData && state.data !== undefined)
}

// How long a saved query is still good for, by source
export function savedMaxAge(source: Source): number {
  if (source === 'forecast') return FORECAST_SAVED_MAX_AGE_MS
  if (source === 'news') return NEWS_SAVED_MAX_AGE_MS
  return SAVED_MAX_AGE_MS
}

export function isSavedDataUsable(key: readonly unknown[], updatedAt: number, now: number, forecastOnly = false): boolean {
  const source = sourceOf(key)
  if (!source || !shouldSave(key, forecastOnly)) return false
  return now - updatedAt <= savedMaxAge(source)
}

// Run on what was saved, when the app opens. The library only checks the age of the whole
// file, which is renewed every time anything is saved, so each query's own age is checked here.
export function dropOldQueries(client: PersistedClient, now: number, forecastOnly = false): PersistedClient {
  const queries = client.clientState.queries.filter((q) => isSavedDataUsable(q.queryKey, q.state.dataUpdatedAt, now, forecastOnly))
  return { ...client, clientState: { ...client.clientState, queries } }
}

export type CacheEntry = { queryKey: readonly unknown[]; dataUpdatedAt: number }

// When the data on screen was loaded. Each source counts from its newest load, and the
// oldest of those is returned, so the banner never sounds fresher than its oldest part.
// Null when nothing has ever loaded. The news headlines are saved but not counted here: the banner
// is about the map's data, and the news sheet shows its own time.
export function dataFrom(entries: CacheEntry[]): number | null {
  const newest = new Map<Source, number>()
  for (const { queryKey, dataUpdatedAt } of entries) {
    const source = sourceOf(queryKey)
    if (!source || source === 'news' || dataUpdatedAt <= 0) continue
    newest.set(source, Math.max(newest.get(source) ?? 0, dataUpdatedAt))
  }
  return newest.size === 0 ? null : Math.min(...newest.values())
}

export function offlineMessage(from: number | null, now = Date.now()): string {
  if (from === null) return t('offline.bannerNoData')
  return t('offline.banner', { when: sriLankaWhen(from, now) })
}

type Timed = { expires_at: string }

// Reports that have run out are dropped from saved data, since the server would have
// dropped them too. A report someone has since confirmed can't be known about while offline.
export function liveReports<T extends Timed>(reports: T[], now: number): T[] {
  return reports.filter((r) => new Date(r.expires_at).getTime() > now)
}

type Located = { lat: number; lng: number }
type Box = { minLng: number; minLat: number; maxLng: number; maxLat: number }

// The saved island-wide reports, cut down to the part of the map in view. Used while
// the reports for this view have not loaded, which offline is all the time.
export function reportsInBox<T extends Located>(reports: T[] | undefined, box: Box): T[] | undefined {
  return reports?.filter((r) => r.lat >= box.minLat && r.lat <= box.maxLat && r.lng >= box.minLng && r.lng <= box.maxLng)
}
