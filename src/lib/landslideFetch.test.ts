import { describe, expect, it, vi } from 'vitest'
import { fetchLandslide, landslideQueryOptions, landslideUrl, loadLandslide, READ_TIMEOUT_MS } from './landslideFetch'
import { LANDSLIDE_SAVED_MAX_AGE_MS } from './offline'

// Reading landslide_current() from the phone. No network: fetch is a stand-in.

const OPTIONS = { url: 'https://project.example.co', key: 'sb_publishable_test' }
const good = {
  found: true,
  message_id: 'LEWM-14-11-2026-1600-09',
  update: 9,
  issued_at: '2026-11-14T10:30:00Z',
  valid_from: '2026-11-14T10:30:00Z',
  valid_to: '2026-11-15T10:30:00Z',
  listed_at: '2026-11-14T10:35:00Z',
  pdf_url: 'https://www.dmc.gov.lk/images/dmcreports/a.pdf',
  parse_ok: true,
  areas: [{ level: 3, district: 'Kegalle', name: 'Aranayake', code: 'LK9209', district_code: 'LK92', shift: 0, added: false, note: null }],
}
const reply = (body: unknown, ok = true) => vi.fn(async () => ({ ok, json: async () => body }) as Response)

describe('asking for the warning', () => {
  it('calls the one function over REST, with only the public key and no body of substance', async () => {
    const fetchFn = reply(good)
    const answer = await fetchLandslide({ ...OPTIONS, fetchFn: fetchFn as unknown as typeof fetch })
    expect(answer).toMatchObject({ found: true, parseOk: true, messageId: 'LEWM-14-11-2026-1600-09' })
    expect(fetchFn).toHaveBeenCalledTimes(1)
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://project.example.co/rest/v1/rpc/landslide_current')
    expect(url).toBe(landslideUrl(OPTIONS.url))
    expect(init.method).toBe('POST')
    expect(init.body).toBe('{}')
    // the new publishable keys are not JWTs, so they go in apikey only
    expect(Object.keys(init.headers as Record<string, string>).sort()).toEqual(['Accept', 'Content-Type', 'apikey'])
    expect((init.headers as Record<string, string>).apikey).toBe(OPTIONS.key)
    expect(init.signal).toBeInstanceOf(AbortSignal)
    expect(READ_TIMEOUT_MS).toBe(8000)
  })

  it('gives null for anything wrong, which is not the same as "no warning"', async () => {
    expect(await fetchLandslide({ ...OPTIONS, fetchFn: reply(good, false) as unknown as typeof fetch })).toBeNull()
    expect(await fetchLandslide({ ...OPTIONS, fetchFn: reply({ message: 'nope' }) as unknown as typeof fetch })).toBeNull()
    expect(await fetchLandslide({ ...OPTIONS, fetchFn: reply('<html>') as unknown as typeof fetch })).toBeNull()
    const throws = vi.fn(async () => {
      throw new Error('offline')
    })
    expect(await fetchLandslide({ ...OPTIONS, fetchFn: throws as unknown as typeof fetch })).toBeNull()
    const badJson = vi.fn(async () => ({ ok: true, json: async () => Promise.reject(new Error('bad json')) }) as unknown as Response)
    expect(await fetchLandslide({ ...OPTIONS, fetchFn: badJson })).toBeNull()
    expect(await fetchLandslide({ url: '', key: 'x' })).toBeNull()
    expect(await fetchLandslide({ url: 'https://x.example', key: '' })).toBeNull()
  })

  it('"no warning stored" is an answer', async () => {
    expect(await fetchLandslide({ ...OPTIONS, fetchFn: reply({ found: false }) as unknown as typeof fetch })).toEqual({ found: false })
  })
})

describe('what the query runs', () => {
  it('returns an answer, and throws on a failed read so the warning already held is kept', async () => {
    expect(await loadLandslide(async () => ({ found: false }))).toEqual({ found: false })
    await expect(loadLandslide(async () => null)).rejects.toThrow('Landslide warnings unavailable')
  })

  it('asks every 10 minutes, keeps the answer for the 24 hours it is saved, and tries again once', () => {
    expect(landslideQueryOptions.refetchInterval).toBe(10 * 60_000)
    expect(landslideQueryOptions.refetchIntervalInBackground).toBe(false)
    expect(landslideQueryOptions.refetchOnWindowFocus).toBe(true)
    expect(landslideQueryOptions.refetchOnReconnect).toBe(true)
    expect(landslideQueryOptions.gcTime).toBe(LANDSLIDE_SAVED_MAX_AGE_MS)
    expect(landslideQueryOptions.retry).toBe(1)
    // the server stores a warning every 30 minutes at most
    expect(landslideQueryOptions.refetchInterval).toBeLessThan(30 * 60_000)
  })
})
