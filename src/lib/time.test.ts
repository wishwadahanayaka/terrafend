import { describe, expect, it } from 'vitest'
import { expiresIn, routeDuration, sriLankaClock, sriLankaTime, timeAgo } from './time'

const NOW = Date.parse('2026-11-04T06:00:00Z')
const MIN = 60_000
const iso = (ms: number) => new Date(ms).toISOString()

describe('timeAgo', () => {
  it('says "just now" under a minute', () => {
    expect(timeAgo(iso(NOW - 30_000), NOW)).toBe('just now')
  })

  it('counts minutes, hours and days', () => {
    expect(timeAgo(iso(NOW - 20 * MIN), NOW)).toBe('20 min ago')
    expect(timeAgo(iso(NOW - 3 * 60 * MIN), NOW)).toBe('3 h ago')
    expect(timeAgo(iso(NOW - 2 * 24 * 60 * MIN), NOW)).toBe('2 d ago')
  })
})

describe('expiresIn', () => {
  it('counts down to the expiry', () => {
    expect(expiresIn(iso(NOW + 5 * 60 * MIN), NOW)).toBe('expires in 5 h')
    expect(expiresIn(iso(NOW + 45 * MIN), NOW)).toBe('expires in 45 min')
  })

  it('says "expiring now" once the time has passed', () => {
    expect(expiresIn(iso(NOW - MIN), NOW)).toBe('expiring now')
  })
})

describe('Sri Lanka time', () => {
  // Sri Lanka is UTC+5:30 all year, whatever the computer's own time zone is
  it('shows the date and time in Sri Lanka', () => {
    expect(sriLankaTime('2026-11-04T06:32:00Z')).toBe('4 Nov 2026, 12:02 pm (Sri Lanka time)')
    expect(sriLankaTime('2026-11-04T19:00:00Z')).toBe('5 Nov 2026, 12:30 am (Sri Lanka time)')
  })

  it('shows just the clock time', () => {
    expect(sriLankaClock(Date.parse('2026-11-04T08:40:00Z'))).toBe('2:10 pm')
  })
})

describe('routeDuration', () => {
  it('rounds to whole minutes, at least 1', () => {
    expect(routeDuration(10)).toBe('about 1 min')
    expect(routeDuration(59 * 60)).toBe('about 59 min')
    expect(routeDuration(2 * 3600)).toBe('about 2 h')
    expect(routeDuration(2 * 3600 + 24 * 60)).toBe('about 2 h 24 min')
  })
})
