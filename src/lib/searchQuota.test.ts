import { afterEach, describe, expect, it } from 'vitest'
import {
  forgetSearchQuota,
  isQuotaActive,
  isQuotaMessage,
  quotaUntil,
  rememberSearchQuota,
  searchQuotaActive,
  UNKNOWN_RESET_MS,
} from './searchQuota'

const NOW = Date.parse('2026-11-08T06:00:00Z')
const HOUR = 3_600_000

describe('when to try the main search again', () => {
  it('waits for the reset time when the service gives one', () => {
    const reset = NOW + 5 * HOUR
    expect(quotaUntil(NOW, new Date(reset).toISOString())).toBe(reset)
    expect(quotaUntil(NOW, reset)).toBe(reset)
  })

  it('waits an hour when the reset time is unknown', () => {
    expect(quotaUntil(NOW, null)).toBe(NOW + UNKNOWN_RESET_MS)
    expect(quotaUntil(NOW, undefined)).toBe(NOW + HOUR)
  })

  it('waits an hour when the reset time makes no sense', () => {
    expect(quotaUntil(NOW, 'tomorrow-ish')).toBe(NOW + HOUR)
    expect(quotaUntil(NOW, NOW - HOUR)).toBe(NOW + HOUR) // already past
    expect(quotaUntil(NOW, NOW)).toBe(NOW + HOUR)
    expect(quotaUntil(NOW, NOW + 3 * 24 * HOUR)).toBe(NOW + HOUR) // too far away to believe
  })
})

describe('reading what is remembered', () => {
  it('is active until the time has passed', () => {
    expect(isQuotaActive(String(NOW + HOUR), NOW)).toBe(true)
    expect(isQuotaActive(String(NOW + HOUR), NOW + HOUR - 1)).toBe(true)
    expect(isQuotaActive(String(NOW + HOUR), NOW + HOUR)).toBe(false)
    expect(isQuotaActive(String(NOW + HOUR), NOW + 2 * HOUR)).toBe(false)
  })

  it('counts nothing, damaged or silly values as not remembered', () => {
    expect(isQuotaActive(null, NOW)).toBe(false)
    expect(isQuotaActive('', NOW)).toBe(false)
    expect(isQuotaActive('soon', NOW)).toBe(false)
    expect(isQuotaActive('NaN', NOW)).toBe(false)
    // a time far in the future can't be right, so it can't lock search out for good
    expect(isQuotaActive(String(NOW + 30 * 24 * HOUR), NOW)).toBe(false)
  })
})

describe('remembering that the quota is used up', () => {
  afterEach(() => forgetSearchQuota())

  it('is remembered until the time, then forgotten', () => {
    expect(searchQuotaActive(NOW)).toBe(false)
    rememberSearchQuota(NOW + HOUR, false)
    expect(searchQuotaActive(NOW)).toBe(true)
    expect(searchQuotaActive(NOW + HOUR - 1)).toBe(true)
    expect(searchQuotaActive(NOW + HOUR)).toBe(false)
  })

  it('can be cleared', () => {
    rememberSearchQuota(NOW + HOUR, false)
    forgetSearchQuota()
    expect(searchQuotaActive(NOW)).toBe(false)
  })

  it('works when storage is blocked or missing (these tests have none)', () => {
    expect(() => rememberSearchQuota(NOW + HOUR)).not.toThrow()
    expect(searchQuotaActive(NOW)).toBe(true)
  })
})

describe('telling a used-up quota from other errors', () => {
  it('knows the wording the routing function uses', () => {
    expect(isQuotaMessage('The daily limit for searches and routes has been reached. Please try again tomorrow.')).toBe(true)
    expect(
      isQuotaMessage('The daily limit for searches and routes has been reached. It resets around 5:30 am (Sri Lanka time).'),
    ).toBe(true)
  })

  it('does not take other errors for it', () => {
    expect(isQuotaMessage('Too many requests right now. Please wait a moment and try again.')).toBe(false)
    expect(isQuotaMessage('Search and routes aren’t available right now. Please try again later.')).toBe(false)
    expect(isQuotaMessage('')).toBe(false)
  })
})
