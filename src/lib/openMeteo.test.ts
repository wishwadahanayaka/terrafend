import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fetchHourly } from './openMeteo'
import { forgetRateLimit, isRateLimit, OpenMeteoError, rateLimitedUntil } from './openMeteoLimit'

// fetch is replaced by a stand-in in every test: nothing here reaches Open-Meteo

const place = [{ lat: 7, lng: 80 }]

function answer(status: number, body: unknown, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), { status, headers })
}

describe('asking Open-Meteo', () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock)
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    fetchMock.mockReset()
    forgetRateLimit()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('on a 429 reads the reason, logs it and waits at least 10 minutes', async () => {
    const reason = 'Hourly API request limit exceeded. Please try again in the next hour.'
    fetchMock.mockResolvedValueOnce(answer(429, { error: true, reason }))
    const before = Date.now()

    const error = await fetchHourly(place).catch((e: unknown) => e)

    expect(isRateLimit(error)).toBe(true)
    const failure = error as OpenMeteoError
    expect(failure.reason).toBe(reason)
    expect(failure.retryAt).toBeGreaterThanOrEqual(before + 10 * 60_000)
    expect(console.warn).toHaveBeenCalledOnce()
    expect(vi.mocked(console.warn).mock.calls[0][0]).toContain(reason)
    expect(rateLimitedUntil()).toBe(failure.retryAt)
  })

  it('sends nothing at all while the wait lasts', async () => {
    fetchMock.mockResolvedValueOnce(answer(429, { error: true, reason: 'Minutely API request limit exceeded.' }))
    await fetchHourly(place).catch(() => {})
    expect(fetchMock).toHaveBeenCalledTimes(1)

    const again = await fetchHourly(place).catch((e: unknown) => e)
    expect(isRateLimit(again)).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('still fails properly when a 429 has no readable body', async () => {
    fetchMock.mockResolvedValueOnce(new Response('too many', { status: 429 }))
    const error = (await fetchHourly(place).catch((e: unknown) => e)) as OpenMeteoError
    expect(isRateLimit(error)).toBe(true)
    expect(error.reason).toBeNull()
    expect(error.retryAt).toBeGreaterThan(Date.now())
  })

  it('does not start a wait for other failures', async () => {
    fetchMock.mockResolvedValueOnce(answer(500, { error: true, reason: 'Server trouble' }))
    const error = (await fetchHourly(place).catch((e: unknown) => e)) as OpenMeteoError
    expect(isRateLimit(error)).toBe(false)
    expect(error.status).toBe(500)
    expect(rateLimitedUntil()).toBeNull()
  })
})
