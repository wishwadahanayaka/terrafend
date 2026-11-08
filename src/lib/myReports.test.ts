import { describe, expect, it } from 'vitest'
import { hiddenByLayers, isShownOnMap, type Severity } from './hazards'
import { addMyReport, parseMyReports } from './myReports'

const NOW = Date.parse('2026-11-08T06:00:00Z')
const DAY = 24 * 3_600_000

const report = (id: string, severity: Severity) => ({ id, severity })
const nobody = new Set<string>()

describe('which reports the map shows', () => {
  it('always shows serious reports, whatever the Reports layer says', () => {
    for (const showPassable of [true, false]) {
      expect(isShownOnMap(report('a', 'blocked'), showPassable, nobody)).toBe(true)
      expect(isShownOnMap(report('b', 'large_vehicles_only'), showPassable, nobody)).toBe(true)
    }
  })

  it('shows other people\'s passable reports only with the Reports layer on', () => {
    expect(isShownOnMap(report('p', 'passable'), true, nobody)).toBe(true)
    expect(isShownOnMap(report('p', 'passable'), false, nobody)).toBe(false)
    expect(isShownOnMap(report('p', 'passable'), false, new Set(['someone-else']))).toBe(false)
  })

  it('always shows my own passable report, even with the layer off', () => {
    expect(isShownOnMap(report('mine', 'passable'), false, new Set(['mine']))).toBe(true)
    expect(isShownOnMap(report('mine', 'passable'), true, new Set(['mine']))).toBe(true)
  })

  it('knows when the layer settings alone would hide a new report', () => {
    expect(hiddenByLayers('passable', false)).toBe(true)
    expect(hiddenByLayers('passable', true)).toBe(false)
    expect(hiddenByLayers('blocked', false)).toBe(false)
    expect(hiddenByLayers('large_vehicles_only', false)).toBe(false)
  })
})

describe('remembering my reports', () => {
  it('adds a report, newest last, without repeating it', () => {
    let list = addMyReport([], 'a', NOW)
    list = addMyReport(list, 'b', NOW + 1)
    list = addMyReport(list, 'a', NOW + 2)
    expect(list.map((r) => r.id)).toEqual(['b', 'a'])
  })

  it('keeps at most 100', () => {
    let list = addMyReport([], 'first', NOW)
    for (let i = 0; i < 100; i++) list = addMyReport(list, `r${i}`, NOW)
    expect(list).toHaveLength(100)
    expect(list.some((r) => r.id === 'first')).toBe(false)
    expect(list[99].id).toBe('r99')
  })

  it('reads what was saved, and drops anything older than a week', () => {
    const saved = JSON.stringify([
      { id: 'new', at: NOW - DAY },
      { id: 'old', at: NOW - 8 * DAY },
    ])
    expect(parseMyReports(saved, NOW).map((r) => r.id)).toEqual(['new'])
  })

  it('treats empty, damaged or unexpected storage as nothing saved', () => {
    expect(parseMyReports(null, NOW)).toEqual([])
    expect(parseMyReports('', NOW)).toEqual([])
    expect(parseMyReports('{not json', NOW)).toEqual([])
    expect(parseMyReports('{"id":"a"}', NOW)).toEqual([])
    expect(parseMyReports(JSON.stringify([{ id: 5, at: NOW }, null, { id: 'ok', at: NOW }]), NOW).map((r) => r.id)).toEqual(['ok'])
  })
})
