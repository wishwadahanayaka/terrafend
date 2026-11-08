import { sortMyReports, type MyReportRow } from './myReportsList'
import type { Severity } from './hazards'

// For testing only, used when the dev server is opened with ?fakeMyReports=1. It stands in for
// the database so the My reports panel can be tried without touching real reports: three
// samples (two active, one cleared). Edit and Clear change them here in memory, so the list
// updates as it would for real, and a reload puts everything back. Only loaded inside
// import.meta.env.DEV checks, so a production build leaves it out.
//
// Their ids start with "fake-", which is how the rest of the app knows not to send them anywhere.
// They aren't drawn on the map, so tapping one flies to its place but opens no card.
// ?fakeMyReports=empty gives no reports at all, to see the empty state.

function samples(now: number): MyReportRow[] {
  const ago = (minutes: number) => new Date(now - minutes * 60_000).toISOString()
  const ahead = (minutes: number) => new Date(now + minutes * 60_000).toISOString()
  return [
    {
      id: 'fake-my-1',
      hazard_type: 'fallen_tree',
      severity: 'large_vehicles_only',
      note: 'Test report: big tree across the left lane',
      lat: 6.9271,
      lng: 79.8612,
      photo_path: null,
      created_at: ago(20),
      expires_at: ahead(340),
      status: 'active',
      confirmations: 4,
    },
    {
      id: 'fake-my-2',
      hazard_type: 'flood',
      severity: 'passable',
      note: null,
      lat: 7.2906,
      lng: 80.6337,
      photo_path: null,
      created_at: ago(150),
      expires_at: ahead(210),
      status: 'active',
      confirmations: 0,
    },
    {
      id: 'fake-my-3',
      hazard_type: 'road_closed',
      severity: 'blocked',
      note: 'Test report: cleared one',
      lat: 6.0535,
      lng: 80.221,
      photo_path: null,
      created_at: ago(26 * 60),
      expires_at: ago(20 * 60),
      status: 'active',
      confirmations: 2,
    },
  ]
}

let rows: MyReportRow[] | null = null
// (the tests have no window, so the address is read carefully)
const wantsEmpty = () => new URLSearchParams(globalThis.location?.search ?? '').get('fakeMyReports') === 'empty'
const current = () => (rows ??= wantsEmpty() ? [] : samples(Date.now()))

export const fakeMyReportRows = (): MyReportRow[] => sortMyReports(current(), Date.now()).map((r) => ({ ...r }))

export function fakeEditMyReport(id: string, severity: Severity, note: string) {
  current().forEach((r) => {
    if (r.id === id) {
      r.severity = severity
      r.note = note.trim() || null
    }
  })
}

export function fakeClearMyReport(id: string) {
  current().forEach((r) => {
    if (r.id === id) r.expires_at = new Date().toISOString()
  })
}
