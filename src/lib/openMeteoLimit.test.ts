import { afterEach, describe, expect, it } from 'vitest'
import {
  forgetRateLimit,
  isRateLimit,
  isWaitActive,
  limitReason,
  OpenMeteoError,
  parseRetryAfter,
  RATE_LIMIT_WAIT_MS,
  rateLimitedUntil,
  rateLimitWait,
  refreshDelay,
  rememberRateLimit,
  retryAtOf,
  shouldRetry,
} from './openMeteoLimit'

const NOW = Date.parse('2026-11-08T08:00:00Z')
const MIN = 60_000
const HOUR = 60 * MIN

const tooMany = (retryAt: number | null = NOW + 10 * MIN) => new OpenMeteoError('429', 429, 'limit', retryAt)

describe('the wait after a 429', () => {
  it('is 10 minutes when Open-Meteo says nothing more', () => {
    expect(RATE_LIMIT_WAIT_MS).toBe(10 * MIN)
    expect(rateLimitWait(null, null)).toBe(10 * MIN)
    expect(rateLimitWait('Minutely API request limit exceeded. Please try again in one minute.', null)).toBe(10 * MIN)
  })

  it('is never shorter than 10 minutes, even if Retry-After asks for less', () => {
    expect(rateLimitWait(null, 5_000)).toBe(10 * MIN)
    expect(rateLimitWait(null, 0)).toBe(10 * MIN)
  })

  it('follows Retry-After when it asks for longer', () => {
    expect(rateLimitWait(null, 25 * MIN)).toBe(25 * MIN)
  })

  it('waits longer when the hourly or daily allowance is the one that is used up', () => {
    expect(rateLimitWait('Hourly API request limit exceeded. Please try again in the next hour.', null)).toBe(30 * MIN)
    expect(rateLimitWait('Daily API request limit exceeded. Please try again tomorrow.', null)).toBe(HOUR)
  })

  it('does not believe an absurdly long wait', () => {
    expect(rateLimitWait(null, 40 * HOUR)).toBe(6 * HOUR)
  })
})

describe('reading the answer', () => {
  it('takes the reason from the error body', () => {
    expect(limitReason({ error: true, reason: ' Daily API request limit exceeded. ' })).toBe('Daily API request limit exceeded.')
  })

  it('gives null when there is no usable reason', () => {
    expect(limitReason(null)).toBeNull()
    expect(limitReason('text')).toBeNull()
    expect(limitReason({ error: true })).toBeNull()
    expect(limitReason({ reason: 5 })).toBeNull()
    expect(limitReason({ reason: '   ' })).toBeNull()
  })

  it('reads Retry-After as seconds or as a date', () => {
    expect(parseRetryAfter('120', NOW)).toBe(120_000)
    expect(parseRetryAfter(new Date(NOW + 15 * MIN).toUTCString(), NOW)).toBe(15 * MIN)
    // A date in the past is no wait at all
    expect(parseRetryAfter(new Date(NOW - MIN).toUTCString(), NOW)).toBe(0)
  })

  it('ignores a missing or silly Retry-After', () => {
    expect(parseRetryAfter(null, NOW)).toBeNull()
    expect(parseRetryAfter('', NOW)).toBeNull()
    expect(parseRetryAfter('soon', NOW)).toBeNull()
    expect(parseRetryAfter('-5', NOW)).toBeNull()
  })
})

describe('retrying and refreshing', () => {
  it('retries an ordinary failure once, and a 429 never', () => {
    const other = new Error('network')
    expect(shouldRetry(0, other)).toBe(true)
    expect(shouldRetry(1, other)).toBe(false)
    expect(shouldRetry(0, tooMany())).toBe(false)
    expect(shouldRetry(0, new OpenMeteoError('500', 500, null, null))).toBe(true)
  })

  it('knows a rate limit from other errors', () => {
    expect(isRateLimit(tooMany())).toBe(true)
    expect(isRateLimit(new OpenMeteoError('500', 500, null, null))).toBe(false)
    expect(isRateLimit(new Error('429'))).toBe(false)
    expect(retryAtOf(tooMany(NOW + 5))).toBe(NOW + 5)
    expect(retryAtOf(new Error('x'))).toBeNull()
  })

  it('refreshes on the normal schedule when nothing is wrong, or something else is', () => {
    expect(refreshDelay(null, NOW, HOUR)).toBe(HOUR)
    expect(refreshDelay(new Error('network'), NOW, HOUR)).toBe(HOUR)
  })

  it('waits out the rest of the 429 wait, and a second more', () => {
    expect(refreshDelay(tooMany(NOW + 10 * MIN), NOW, HOUR)).toBe(10 * MIN + 1000)
    expect(refreshDelay(tooMany(NOW + 4 * MIN), NOW, HOUR)).toBe(4 * MIN + 1000)
  })

  it('does not go negative when the wait is already over', () => {
    expect(refreshDelay(tooMany(NOW - MIN), NOW, HOUR)).toBe(1000)
  })
})

describe('remembering the wait', () => {
  afterEach(() => forgetRateLimit())

  it('counts as waiting until the time has come', () => {
    rememberRateLimit(NOW + 10 * MIN, false)
    expect(rateLimitedUntil(NOW)).toBe(NOW + 10 * MIN)
    expect(rateLimitedUntil(NOW + 9 * MIN)).toBe(NOW + 10 * MIN)
    expect(rateLimitedUntil(NOW + 10 * MIN)).toBeNull()
    expect(rateLimitedUntil(NOW + 11 * MIN)).toBeNull()
  })

  it('is not waiting when nothing was remembered', () => {
    expect(rateLimitedUntil(NOW)).toBeNull()
  })

  it('only believes a stored time that is sensible', () => {
    expect(isWaitActive(String(NOW + MIN), NOW)).toBe(true)
    expect(isWaitActive(String(NOW - MIN), NOW)).toBe(false)
    expect(isWaitActive(String(NOW + 7 * HOUR), NOW)).toBe(false)
    expect(isWaitActive('soon', NOW)).toBe(false)
    expect(isWaitActive('', NOW)).toBe(false)
    expect(isWaitActive(null, NOW)).toBe(false)
  })
})
