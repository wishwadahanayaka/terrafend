// The reports this browser has sent, so they always show on the map, even when the Reports
// layer would hide them (a passable report, with the layer off). Without this, a person who
// has just reported a passable flood sees nothing happen and thinks it failed.
//
// The map's data doesn't say who made a report, so the ids are kept here, on this phone.
// A report that has run out simply never comes back from the server, so an old id does no harm.

const KEY = 'terrafend:my-reports'
// Reports last hours, or a few days if people keep confirming them. A week covers that.
const KEEP_MS = 7 * 24 * 3_600_000
const MAX_KEPT = 100

export type MyReport = { id: string; at: number }

// Anything unreadable (empty, damaged, from some other version) counts as nothing saved
export function parseMyReports(raw: string | null, now: number): MyReport[] {
  if (!raw) return []
  try {
    const data: unknown = JSON.parse(raw)
    if (!Array.isArray(data)) return []
    return data.filter(
      (item): item is MyReport =>
        typeof item?.id === 'string' && typeof item?.at === 'number' && now - item.at <= KEEP_MS,
    )
  } catch {
    return []
  }
}

// Newest last, and never more than MAX_KEPT
export function addMyReport(list: MyReport[], id: string, now: number): MyReport[] {
  return [...list.filter((r) => r.id !== id), { id, at: now }].slice(-MAX_KEPT)
}

// Storage can be missing or blocked, so it is only a bonus: without it the layer rules apply as usual
export function loadMyReportIds(now = Date.now()): Set<string> {
  try {
    return new Set(parseMyReports(localStorage.getItem(KEY), now).map((r) => r.id))
  } catch {
    return new Set()
  }
}

export function rememberMyReport(id: string, now = Date.now()) {
  try {
    const list = parseMyReports(localStorage.getItem(KEY), now)
    localStorage.setItem(KEY, JSON.stringify(addMyReport(list, id, now)))
  } catch {
    // not kept, the report is still sent
  }
}
