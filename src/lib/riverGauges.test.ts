import { describe, expect, it } from 'vitest'
import { isAlertOrAbove, parseGauges, worstStep, type RiverGauge } from './riverGauges'

function station(extra: Record<string, unknown> = {}) {
  return {
    id: 'kelani/nagalagam',
    river: 'Kelani Ganga',
    station: 'Nagalagam Street',
    latitude: 6.96,
    longitude: 79.88,
    status: 'normal',
    level: 4.2,
    unit: 'ft',
    marks: { alert: 5, minor: 7, major: 9 },
    observedAt: '2026-11-04T05:30:00Z',
    url: 'https://waterlevels.lk/station/nagalagam',
    ...extra,
  }
}

const one = (extra: Record<string, unknown>) => parseGauges({ stations: [station(extra)] })[0]

describe('parseGauges', () => {
  it('reads a normal station', () => {
    const g = one({})
    expect(g.step).toBe('normal')
    expect(g.level).toBe(4.2)
    expect(g.marks).toEqual({ alert: 5, minor: 7, major: 9 })
    expect(g.url).toBe('https://waterlevels.lk/station/nagalagam')
  })

  it('shows "watch" as Normal, keeping the note', () => {
    const g = one({ status: 'watch', statusNote: 'Near alert' })
    expect(g.step).toBe('normal')
    expect(g.note).toBe('Near alert')
  })

  it('reads the flood steps', () => {
    expect(one({ status: 'alert' }).step).toBe('alert')
    expect(one({ status: 'minor' }).step).toBe('minor')
    expect(one({ status: 'major' }).step).toBe('major')
  })

  it('keeps "none" (no official flood levels) and "stale" (not reporting)', () => {
    expect(one({ status: 'none' }).step).toBe('none')
    expect(one({ status: 'stale' }).step).toBe('stale')
  })

  it('never shows a level for a stale gauge', () => {
    expect(one({ status: 'stale', level: 3 }).level).toBeNull()
  })

  it('treats a 0 with no unit as a placeholder, not a real level', () => {
    expect(one({ status: 'none', level: 0, unit: undefined }).level).toBeNull()
    expect(one({ status: 'none', level: 0, unit: '' }).level).toBeNull()
  })

  it('keeps a real 0 ft reading', () => {
    expect(one({ level: 0 }).level).toBe(0)
  })

  it('drops links that are not https', () => {
    expect(one({ url: 'javascript:alert(1)' }).url).toBeNull()
    expect(one({ url: 'http://waterlevels.lk/x' }).url).toBeNull()
    expect(one({ url: 'not a url' }).url).toBeNull()
  })

  it('skips bad stations and keeps the good ones', () => {
    const gauges = parseGauges({
      stations: [
        station({ id: 'good' }),
        station({ id: 'unknown status', status: 'flooding' }),
        station({ id: 'no position', latitude: undefined }),
        station({ id: 'off the island', latitude: 13.08, longitude: 80.27 }),
        station({ id: 'no river', river: '' }),
        'not a station',
        null,
      ],
    })
    expect(gauges.map((g) => g.id)).toEqual(['good'])
  })

  it('throws when the answer is not the expected shape, so the layer can hide itself', () => {
    expect(() => parseGauges(null)).toThrow()
    expect(() => parseGauges({ stations: 'nope' })).toThrow()
    expect(() => parseGauges({ stations: [station({ status: 'flooding' })] })).toThrow()
  })
})

describe('worstStep', () => {
  const g = (step: RiverGauge['step']) => ({ ...one({}), step })

  it('finds the most serious step at Alert or above', () => {
    expect(worstStep([g('alert'), g('major'), g('minor')])).toBe('major')
    expect(worstStep([g('normal'), g('alert')])).toBe('alert')
  })

  it('is null when nothing is at Alert or above', () => {
    expect(worstStep([g('normal'), g('none'), g('stale')])).toBeNull()
    expect(worstStep([])).toBeNull()
  })

  it('counts only alert, minor and major as warnings', () => {
    expect(['normal', 'alert', 'minor', 'major', 'none', 'stale'].filter((s) => isAlertOrAbove(s as RiverGauge['step']))).toEqual([
      'alert',
      'minor',
      'major',
    ])
  })
})
