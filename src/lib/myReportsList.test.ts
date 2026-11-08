import { describe, expect, it } from 'vitest'
import { fakeClearMyReport, fakeEditMyReport, fakeMyReportRows } from './fakeMyReports'
import type { HazardType, Severity } from './hazards'
import { dropMyReport, type MyReport } from './myReports'
import {
  canSaveEdit,
  cleanNote,
  myReportResultFor,
  NOTE_LIMIT,
  reportStatus,
  sortMyReports,
  syncMyReports,
  type MyReportRow,
} from './myReportsList'
import { timeAgo } from './time'

const NOW = Date.parse('2026-11-08T06:00:00Z')
const MIN = 60_000
const HOUR = 60 * MIN
const iso = (ms: number) => new Date(ms).toISOString()

function row(id: string, over: Partial<MyReportRow> = {}): MyReportRow {
  return {
    id,
    hazard_type: 'fallen_tree' as HazardType,
    severity: 'blocked' as Severity,
    note: null,
    lat: 7,
    lng: 80,
    photo_path: null,
    created_at: iso(NOW - HOUR),
    expires_at: iso(NOW + 5 * HOUR),
    status: 'active',
    confirmations: 0,
    ...over,
  }
}

describe('active or cleared', () => {
  it('is active while it is active and has time left', () => {
    expect(reportStatus(row('a'), NOW)).toBe('active')
  })

  it('is cleared once its time has run out, whether you cleared it or it ran out', () => {
    expect(reportStatus(row('a', { expires_at: iso(NOW - 1) }), NOW)).toBe('cleared')
    // Clearing sets the expiry to that very moment
    expect(reportStatus(row('a', { expires_at: iso(NOW) }), NOW)).toBe('cleared')
  })

  it('is cleared when enough people said it was gone, even with time left', () => {
    expect(reportStatus(row('a', { status: 'cleared' }), NOW)).toBe('cleared')
  })
})

describe('sorting the list', () => {
  it('puts active reports first, newest first, then cleared ones, newest first', () => {
    const list = [
      row('old-cleared', { created_at: iso(NOW - 30 * HOUR), expires_at: iso(NOW - 20 * HOUR) }),
      row('old-active', { created_at: iso(NOW - 3 * HOUR) }),
      row('new-cleared', { created_at: iso(NOW - 2 * HOUR), status: 'cleared' }),
      row('new-active', { created_at: iso(NOW - 10 * MIN) }),
    ]
    expect(sortMyReports(list, NOW).map((r) => r.id)).toEqual(['new-active', 'old-active', 'new-cleared', 'old-cleared'])
  })

  it('keeps a recent cleared report below an older active one', () => {
    const list = [row('cleared-new', { status: 'cleared', created_at: iso(NOW - MIN) }), row('active-old', { created_at: iso(NOW - 5 * HOUR) })]
    expect(sortMyReports(list, NOW).map((r) => r.id)).toEqual(['active-old', 'cleared-new'])
  })

  it('handles an empty list and leaves the original alone', () => {
    expect(sortMyReports([], NOW)).toEqual([])
    const list = [row('b', { created_at: iso(NOW - 2 * HOUR) }), row('a', { created_at: iso(NOW - HOUR) })]
    sortMyReports(list, NOW)
    expect(list.map((r) => r.id)).toEqual(['b', 'a'])
  })
})

describe('time ago in the list', () => {
  it('says how long ago a report was made', () => {
    expect(timeAgo(iso(NOW - 10_000), NOW)).toBe('just now')
    expect(timeAgo(iso(NOW - 20 * MIN), NOW)).toBe('20 min ago')
    expect(timeAgo(iso(NOW - 2 * HOUR), NOW)).toBe('2 h ago')
    expect(timeAgo(iso(NOW - 6.5 * 24 * HOUR), NOW)).toBe('7 d ago')
  })
})

describe('keeping the phone\'s list in step with the database', () => {
  const kept = (ids: string[]): MyReport[] => ids.map((id) => ({ id, at: NOW - HOUR }))

  it('adds active reports it did not know about, with the time they were made', () => {
    const made = NOW - 3 * HOUR
    const next = syncMyReports([], [row('a', { created_at: iso(made) })], NOW)
    expect(next).toEqual([{ id: 'a', at: made }])
  })

  it('drops reports that are no longer active', () => {
    const rows = [row('gone', { expires_at: iso(NOW - HOUR) }), row('still')]
    expect(syncMyReports(kept(['gone', 'still']), rows, NOW).map((r) => r.id)).toEqual(['still'])
  })

  it('leaves what the database did not mention alone', () => {
    expect(syncMyReports(kept(['unknown']), [row('a')], NOW).map((r) => r.id)).toEqual(['unknown', 'a'])
  })

  it('does not repeat a report or change when its time was already kept', () => {
    const list = kept(['a'])
    const next = syncMyReports(list, [row('a')], NOW)
    expect(next).toEqual(list)
  })

  it('does not add a report that is already over', () => {
    expect(syncMyReports([], [row('x', { status: 'cleared' })], NOW)).toEqual([])
  })

  it('forgets a report that was cleared', () => {
    expect(dropMyReport(kept(['a', 'b']), 'a').map((r) => r.id)).toEqual(['b'])
    expect(dropMyReport([], 'a')).toEqual([])
  })
})

describe('the edit form', () => {
  const report = { severity: 'blocked' as Severity, note: 'Tree on the road' }

  it('has nothing to save until something changes', () => {
    expect(canSaveEdit(report, 'blocked', 'Tree on the road')).toBe(false)
  })

  it('can save a new severity, or a new note', () => {
    expect(canSaveEdit(report, 'passable', 'Tree on the road')).toBe(true)
    expect(canSaveEdit(report, 'blocked', 'Tree cut, one lane open')).toBe(true)
  })

  it('ignores spaces around the note, as sending does', () => {
    expect(canSaveEdit(report, 'blocked', '  Tree on the road  ')).toBe(false)
    expect(cleanNote('  hi  ')).toBe('hi')
  })

  it('treats no note and a blank note as the same', () => {
    expect(canSaveEdit({ severity: 'passable', note: null }, 'passable', '   ')).toBe(false)
    expect(canSaveEdit(report, 'blocked', '')).toBe(true) // removing the note is a change
  })

  it('refuses a note over the limit', () => {
    expect(canSaveEdit(report, 'passable', 'x'.repeat(NOTE_LIMIT))).toBe(true)
    expect(canSaveEdit(report, 'passable', 'x'.repeat(NOTE_LIMIT + 1))).toBe(false)
    expect(NOTE_LIMIT).toBe(280)
  })
})

describe('what the database functions answer', () => {
  it('reads their error words', () => {
    expect(myReportResultFor('report_not_active')).toBe('inactive')
    expect(myReportResultFor('too_many_edits')).toBe('too_many')
  })

  it('treats anything else as a failure', () => {
    expect(myReportResultFor('not_signed_in')).toBe('failed')
    expect(myReportResultFor('note_too_long')).toBe('failed')
    expect(myReportResultFor('')).toBe('failed')
  })
})

describe('the ?fakeMyReports=1 samples', () => {
  it('has three reports, two active and one cleared, active first', () => {
    const rows = fakeMyReportRows()
    expect(rows).toHaveLength(3)
    expect(rows.map((r) => reportStatus(r, Date.now()))).toEqual(['active', 'active', 'cleared'])
  })

  it('changes in memory when edited or cleared', () => {
    fakeEditMyReport('fake-my-1', 'passable', '  new note ')
    const edited = fakeMyReportRows().find((r) => r.id === 'fake-my-1')!
    expect(edited.severity).toBe('passable')
    expect(edited.note).toBe('new note')

    fakeClearMyReport('fake-my-2')
    expect(fakeMyReportRows().map((r) => reportStatus(r, Date.now()))).toEqual(['active', 'cleared', 'cleared'])
  })
})
