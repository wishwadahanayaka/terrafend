import { describe, expect, it } from 'vitest'
import {
  DUPLICATE_RADIUS_M,
  findSimilar,
  GROUP_RADIUS_M,
  groupReports,
  reportTotal,
  severityChoices,
  severityResultFor,
} from './duplicates'
import type { HazardType, Severity } from './hazards'

const NOW = Date.parse('2026-11-04T06:30:00Z')
const M_PER_DEG_LAT = 110_574

// A report `metres` due north of 7.0, 80.0. The route in these tests runs the same way, so
// the distance along it is the same number of metres.
function report(
  id: string,
  metres: number,
  extra: Partial<{ hazard_type: HazardType; severity: Severity; created_at: string; expires_at: string }> = {},
) {
  return {
    id,
    hazard_type: 'fallen_tree' as HazardType,
    severity: 'blocked' as Severity,
    lat: 7 + metres / M_PER_DEG_LAT,
    lng: 80,
    created_at: '2026-11-04T05:00:00Z',
    expires_at: '2026-11-04T11:00:00Z',
    distance_along_m: metres,
    ...extra,
  }
}

const SPOT = { lat: 7, lng: 80 }

describe('is it the same report? (100 m)', () => {
  it('uses 100 m and 150 m', () => {
    expect(DUPLICATE_RADIUS_M).toBe(100)
    expect(GROUP_RADIUS_M).toBe(150)
  })

  it('finds the same type within 100 m, nearest first', () => {
    const found = findSimilar([report('far', 80), report('near', 20)], SPOT, 'fallen_tree', NOW)
    expect(found.map((r) => r.id)).toEqual(['near', 'far'])
    expect(found[0].distance_m).toBeCloseTo(20, 0)
  })

  it('draws the line at 100 m', () => {
    expect(findSimilar([report('in', 99)], SPOT, 'fallen_tree', NOW)).toHaveLength(1)
    expect(findSimilar([report('out', 101)], SPOT, 'fallen_tree', NOW)).toHaveLength(0)
  })

  it('measures in every direction, not just north', () => {
    // 0.0009 degrees of longitude at 7 degrees north is about 99 m
    const east = { ...report('east', 0), lat: 7, lng: 80.0009 }
    expect(findSimilar([east], SPOT, 'fallen_tree', NOW)).toHaveLength(1)
    expect(findSimilar([{ ...east, lng: 80.0011 }], SPOT, 'fallen_tree', NOW)).toHaveLength(0)
  })

  it('does not match a different hazard type in the same spot', () => {
    expect(findSimilar([report('flood', 0, { hazard_type: 'flood' })], SPOT, 'fallen_tree', NOW)).toEqual([])
  })

  it('does not match the same type further than 100 m', () => {
    expect(findSimilar([report('a', 150), report('b', 400)], SPOT, 'fallen_tree', NOW)).toEqual([])
  })

  it('ignores reports that have expired', () => {
    const old = report('old', 10, { expires_at: '2026-11-04T06:29:59Z' })
    expect(findSimilar([old], SPOT, 'fallen_tree', NOW)).toEqual([])
  })

  it('finds nothing when there are no reports', () => {
    expect(findSimilar([], SPOT, 'fallen_tree', NOW)).toEqual([])
  })
})

describe('worse or better choices', () => {
  it('offers the two other severities, worse first', () => {
    expect(severityChoices('large_vehicles_only')).toEqual([
      { severity: 'blocked', direction: 'worse' },
      { severity: 'passable', direction: 'better' },
    ])
  })

  it('has nothing worse than blocked and nothing better than passable', () => {
    expect(severityChoices('blocked').map((c) => c.direction)).toEqual(['better', 'better'])
    expect(severityChoices('passable').map((c) => c.direction)).toEqual(['worse', 'worse'])
  })

  it('never offers the severity it already has', () => {
    for (const s of ['passable', 'large_vehicles_only', 'blocked'] as const) {
      expect(severityChoices(s).map((c) => c.severity)).not.toContain(s)
    }
  })
})

describe('grouping reports in the route check (150 m)', () => {
  it('counts reports of one type close together as one', () => {
    const groups = groupReports([report('a', 1000), report('b', 1040), report('c', 1080)])
    expect(groups).toHaveLength(1)
    expect(groups[0].members.map((m) => m.id)).toEqual(['a', 'b', 'c'])
    expect(reportTotal(groups)).toBe(3)
  })

  it('leaves a lone report as a group of one', () => {
    const [group] = groupReports([report('a', 500)])
    expect(group.members).toHaveLength(1)
    expect(group.id).toBe('a')
    expect(group.distance_along_m).toBe(500)
  })

  it('draws the line at 150 m', () => {
    expect(groupReports([report('a', 1000), report('b', 1149)])).toHaveLength(1)
    expect(groupReports([report('a', 1000), report('b', 1151)])).toHaveLength(2)
  })

  it('keeps different hazard types in the same spot apart', () => {
    const groups = groupReports([report('tree', 1000), report('flood', 1000, { hazard_type: 'flood' })])
    expect(groups.map((g) => g.hazard_type).sort()).toEqual(['fallen_tree', 'flood'])
  })

  it('keeps the same type apart when more than 150 m apart', () => {
    expect(groupReports([report('a', 1000), report('b', 1500)])).toHaveLength(2)
  })

  it('does not stretch a group along the road one report at a time', () => {
    // Each is 100 m from the next, but the first and third are 200 m apart
    const groups = groupReports([report('a', 0), report('b', 100), report('c', 200)])
    expect(groups.map((g) => g.members.map((m) => m.id))).toEqual([['a', 'b'], ['c']])
  })

  it('gives the same groups whatever order the reports arrive in', () => {
    const list = [report('a', 0), report('b', 60), report('c', 5000), report('d', 5100)]
    const names = (groups: ReturnType<typeof groupReports>) => groups.map((g) => g.members.map((m) => m.id))
    expect(names(groupReports(list))).toEqual(names(groupReports([...list].reverse())))
  })

  it('takes the most serious severity, and the newest report of that severity', () => {
    const groups = groupReports([
      report('ok', 1000, { severity: 'passable', created_at: '2026-11-04T05:50:00Z' }),
      report('old', 1020, { severity: 'blocked', created_at: '2026-11-04T05:00:00Z' }),
      report('new', 1040, { severity: 'blocked', created_at: '2026-11-04T05:30:00Z' }),
    ])
    expect(groups).toHaveLength(1)
    expect(groups[0].severity).toBe('blocked')
    expect(groups[0].id).toBe('new')
    expect(groups[0].members).toHaveLength(3)
  })

  it('puts the group in the middle of its reports along the route', () => {
    const [group] = groupReports([report('a', 1000), report('b', 1100)])
    expect(group.distance_along_m).toBe(1050)
  })

  it('lists groups in route order', () => {
    const groups = groupReports([report('late', 9000), report('early', 100), report('mid', 4000)])
    expect(groups.map((g) => g.id)).toEqual(['early', 'mid', 'late'])
  })

  it('does not change the reports it is given', () => {
    const list = [report('b', 1040), report('a', 1000)]
    groupReports(list)
    expect(list.map((r) => r.id)).toEqual(['b', 'a'])
  })

  it('handles an empty list', () => {
    expect(groupReports([])).toEqual([])
    expect(reportTotal([])).toBe(0)
  })
})

describe('what the severity function answers', () => {
  it('reads the database error words', () => {
    expect(severityResultFor('already_updated')).toBe('already_updated')
    expect(severityResultFor('needs_still_there')).toBe('needs_still_there')
    expect(severityResultFor('too_many_updates')).toBe('too_many')
    expect(severityResultFor('report_not_active')).toBe('inactive')
  })

  it('treats anything else as a failure', () => {
    expect(severityResultFor('not_signed_in')).toBe('failed')
    expect(severityResultFor('')).toBe('failed')
  })
})
