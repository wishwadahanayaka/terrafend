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

// What a report's map card offers underneath its details. A person can't vote on their own report
// (the database refuses it), so those get a way to manage it instead. Test reports from the dev
// switches (ids starting `fake-`) aren't in the database, so they offer neither.
export type CardAction = 'vote' | 'manage' | 'none'

export function cardAction(id: string, mine: ReadonlySet<string>): CardAction {
  if (id.startsWith('fake-')) return 'none'
  return mine.has(id) ? 'manage' : 'vote'
}

export function rememberMyReport(id: string, now = Date.now()) {
  try {
    const list = parseMyReports(localStorage.getItem(KEY), now)
    localStorage.setItem(KEY, JSON.stringify(addMyReport(list, id, now)))
  } catch {
    // not kept, the report is still sent
  }
}

export const dropMyReport = (list: MyReport[], id: string): MyReport[] => list.filter((r) => r.id !== id)

// Forget one report, after it was cleared
export function forgetMyReport(id: string, now = Date.now()) {
  try {
    const list = parseMyReports(localStorage.getItem(KEY), now)
    localStorage.setItem(KEY, JSON.stringify(dropMyReport(list, id)))
  } catch {
    // not changed, the report is off the map anyway
  }
}

// Brings the remembered list in line with what the database says (see syncMyReports)
export function updateMyReports(change: (list: MyReport[]) => MyReport[], now = Date.now()) {
  try {
    const list = parseMyReports(localStorage.getItem(KEY), now)
    const next = change(list)
    if (next.length !== list.length || next.some((r, i) => r.id !== list[i].id)) {
      localStorage.setItem(KEY, JSON.stringify(next))
    }
  } catch {
    // storage is blocked, the layer rules apply as usual
  }
}
