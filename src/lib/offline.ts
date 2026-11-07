import type { PersistedClient } from '@tanstack/react-query-persist-client'
import { REPORTS_KEY } from './queryKeys'
import { sriLankaClock } from './time'

const HOUR_MS = 3_600_000

// Saved data older than this is thrown away when the app opens. Six hours matches how
// long a report lives and how long a gauge reading counts as current.
export const SAVED_MAX_AGE_MS = 6 * HOUR_MS
// A rain forecast only covers the next 3 hours, so an older one describes weather that has passed
export const FORECAST_SAVED_MAX_AGE_MS = 3 * HOUR_MS

export type Source = 'rivers' | 'measured-rain' | 'forecast' | 'alerts' | 'reports'

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
    default:
      return null
  }
}

export const shouldSave = (key: readonly unknown[]) => sourceOf(key) !== null

export function isSavedDataUsable(key: readonly unknown[], updatedAt: number, now: number): boolean {
  const source = sourceOf(key)
  if (!source) return false
  const maxAge = source === 'forecast' ? FORECAST_SAVED_MAX_AGE_MS : SAVED_MAX_AGE_MS
  return now - updatedAt <= maxAge
}

// Run on what was saved, when the app opens. The library only checks the age of the whole
// file, which is renewed every time anything is saved, so each query's own age is checked here.
export function dropOldQueries(client: PersistedClient, now: number): PersistedClient {
  const queries = client.clientState.queries.filter((q) => isSavedDataUsable(q.queryKey, q.state.dataUpdatedAt, now))
  return { ...client, clientState: { ...client.clientState, queries } }
}

export type CacheEntry = { queryKey: readonly unknown[]; dataUpdatedAt: number }

// When the data on screen was loaded. Each source counts from its newest load, and the
// oldest of those is returned, so the banner never sounds fresher than its oldest part.
// Null when nothing has ever loaded.
export function dataFrom(entries: CacheEntry[]): number | null {
  const newest = new Map<Source, number>()
  for (const { queryKey, dataUpdatedAt } of entries) {
    const source = sourceOf(queryKey)
    if (!source || dataUpdatedAt <= 0) continue
    newest.set(source, Math.max(newest.get(source) ?? 0, dataUpdatedAt))
  }
  return newest.size === 0 ? null : Math.min(...newest.values())
}

const colomboDay = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Colombo', day: 'numeric', month: 'short' })

export function offlineMessage(from: number | null, now = Date.now()): string {
  if (from === null) return 'Offline: no saved data yet. Reports, rivers and rain will load when you are back online.'
  // The time of day alone would be misleading for data from another day
  const day = colomboDay.format(new Date(from))
  const when = day === colomboDay.format(new Date(now)) ? sriLankaClock(from) : `${day}, ${sriLankaClock(from)}`
  return `Offline: showing data from ${when}. It may be out of date.`
}

export const OFFLINE_REPORT_NOTICE = 'You are offline. Reporting needs a connection.'
export const OFFLINE_ROUTE_NOTICE = 'You are offline. Route checks need a connection.'
export const OFFLINE_VOTE_NOTICE = 'You are offline. Voting needs a connection.'

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
export const OFFLINE_REROUTE_NOTICE = 'You are offline. Finding another route needs a connection.'
