import { describe, expect, it } from 'vitest'
import { gaugeWhen, measuredText, parseGauge } from './rainMeasured'

const NOW = Date.parse('2026-11-04T06:00:00Z')
const MIN = 60_000

function gauge(measured: Record<string, unknown>, extra: Record<string, unknown> = {}) {
  return {
    station: 'Kandy',
    basin: 'Mahaweli Ganga',
    lat: 7.29,
    lon: 80.63,
    measured: { mm24h: 30, at: NOW - 10 * MIN, ...measured },
    ...extra,
  }
}

describe('gauge rain rate', () => {
  it('uses the last hour when it is the worse of the two', () => {
    const g = parseGauge(gauge({ mm1h: 25, mm3h: 27.9 }), NOW)!
    expect(g.rate).toBe(25)
    expect(g.level).toBe('veryHeavy')
    expect(g.lastHour).toBe(true)
    expect(gaugeWhen(g)).toBe('in the last hour')
  })

  // Heavy rain that has just eased off still counts
  it('uses the 3-hour average when it is worse than the last hour', () => {
    const g = parseGauge(gauge({ mm1h: 2, mm3h: 30 }), NOW)!
    expect(g.rate).toBe(10)
    expect(g.level).toBe('heavy')
    expect(g.lastHour).toBe(false)
    expect(gaugeWhen(g)).toBe('in the past 3 hours')
  })

  it('says "last hour" only when the last hour reached the level by itself', () => {
    expect(parseGauge(gauge({ mm1h: 8, mm3h: 27 }), NOW)!.lastHour).toBe(true)
    expect(parseGauge(gauge({ mm1h: 3, mm3h: 24 }), NOW)!.lastHour).toBe(false)
  })

  it('gives light and moderate rain as mild, not as a warning', () => {
    const g = parseGauge(gauge({ mm1h: 3, mm3h: 3 }), NOW)!
    expect(g.level).toBeNull()
    expect(g.mild).toBe('moderate')
  })
})

describe('unknown is never zero', () => {
  it('keeps a missing last hour as null and rates from the 3 hours', () => {
    const g = parseGauge(gauge({ mm1h: null, mm3h: 9 }), NOW)!
    expect(g.mm1h).toBeNull()
    expect(g.rate).toBe(3)
    expect(measuredText(g)).toBe('9 mm in 3 hours · 30 mm in 24 hours')
  })

  it('treats a negative number as unknown', () => {
    expect(parseGauge(gauge({ mm1h: -1, mm3h: 6 }), NOW)!.mm1h).toBeNull()
  })

  it('keeps a real 0 as a dry reading', () => {
    const g = parseGauge(gauge({ mm1h: 0, mm3h: null }), NOW)!
    expect(g.rate).toBe(0)
    expect(g.level).toBeNull()
    expect(g.mild).toBeNull()
    expect(g.mm3h).toBeNull()
  })

  it('skips a gauge with no rain numbers at all, instead of calling it dry', () => {
    expect(parseGauge(gauge({ mm1h: null, mm3h: null }), NOW)).toBeNull()
    expect(parseGauge(gauge({ mm1h: undefined, mm3h: 'n/a' }), NOW)).toBeNull()
  })
})

describe('bad and old readings', () => {
  it('ignores readings older than 6 hours, or from the future', () => {
    expect(parseGauge(gauge({ mm1h: 10, at: NOW - 6 * 60 * MIN - 1 }), NOW)).toBeNull()
    expect(parseGauge(gauge({ mm1h: 10, at: NOW + 2 * 60 * MIN }), NOW)).toBeNull()
  })

  it('skips gauges without a name or with a position off the island', () => {
    expect(parseGauge(gauge({ mm1h: 10 }, { station: ' ' }), NOW)).toBeNull()
    expect(parseGauge(gauge({ mm1h: 10 }, { lat: 13.1, lon: 80.3 }), NOW)).toBeNull()
    expect(parseGauge(null, NOW)).toBeNull()
    expect(parseGauge({ station: 'Kandy', lat: 7.29, lon: 80.63 }, NOW)).toBeNull()
  })
})

it('formats the measured amounts for the card', () => {
  const g = parseGauge(gauge({ mm1h: 25, mm3h: 27.94, mm24h: 29.4 }), NOW)!
  expect(measuredText(g)).toBe('25 mm in the last hour · 27.9 mm in 3 hours · 29.4 mm in 24 hours')
})
