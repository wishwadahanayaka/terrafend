import type { HazardType, Severity } from './hazards'
import { addMyReport, type MyReport } from './myReports'

// One of this browser's own reports, as my_reports() returns it (migration 0006). It also
// returns reports that have run out or been cleared, which the map no longer shows.
export type MyReportRow = {
  id: string
  hazard_type: HazardType
  severity: Severity
  note: string | null
  lat: number
  lng: number
  photo_path: string | null
  created_at: string
  expires_at: string
  status: 'active' | 'cleared'
  confirmations: number
}

export type MyReportStatus = 'active' | 'cleared'

// "Cleared" means gone from the map, whichever way it went: you cleared it, enough people said
// it was gone, or it ran out of time. The database doesn't keep apart which one it was, and
// from the map's point of view they are the same.
export function reportStatus(row: Pick<MyReportRow, 'status' | 'expires_at'>, now: number): MyReportStatus {
  return row.status === 'active' && new Date(row.expires_at).getTime() > now ? 'active' : 'cleared'
}

// Active reports first, since those are the ones that can still be edited or cleared, then
// the rest. Newest first inside each group.
export function sortMyReports<T extends Pick<MyReportRow, 'status' | 'expires_at' | 'created_at'>>(
  rows: T[],
  now: number,
): T[] {
  const rank = (r: T) => (reportStatus(r, now) === 'active' ? 0 : 1)
  return [...rows].sort(
    (a, b) => rank(a) - rank(b) || new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
  )
}

// Keeps the list this browser remembers (so its reports always show on the map, see
// myReports.ts) in step with what the database says is the browser's own:
//  - an active report that isn't in the list yet is added, which also covers reports sent
//    before the list existed
//  - a report that is no longer active is dropped, since it isn't on the map anyway
//  - anything the database didn't mention is left alone
export function syncMyReports(list: MyReport[], rows: MyReportRow[], now: number): MyReport[] {
  const gone = new Set(rows.filter((r) => reportStatus(r, now) === 'cleared').map((r) => r.id))
  let next = list.filter((m) => !gone.has(m.id))
  const known = new Set(next.map((m) => m.id))
  for (const row of rows) {
    if (reportStatus(row, now) === 'active' && !known.has(row.id)) {
      next = addMyReport(next, row.id, new Date(row.created_at).getTime())
    }
  }
  return next
}

export const NOTE_LIMIT = 280

// What the edit form can send: a severity, and a note that is trimmed, blank meaning none
export function cleanNote(note: string): string {
  return note.trim()
}

// Whether the edit form has something to save and nothing wrong with it
export function canSaveEdit(
  row: Pick<MyReportRow, 'severity' | 'note'>,
  severity: Severity,
  note: string,
): boolean {
  const clean = cleanNote(note)
  if (clean.length > NOTE_LIMIT) return false
  return severity !== row.severity || clean !== (row.note ?? '')
}

export type MyReportResult = 'ok' | 'inactive' | 'too_many' | 'failed'

// The database functions answer with one of these words as their error message
export function myReportResultFor(message: string): MyReportResult {
  if (message.includes('report_not_active')) return 'inactive'
  if (message.includes('too_many_edits')) return 'too_many'
  return 'failed'
}
