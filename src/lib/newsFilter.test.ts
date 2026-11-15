import { afterEach, describe, expect, it, vi } from 'vitest'
import { loadNewsFilter, NEWS_FILTER_KEY, saveNewsFilter } from './layerSettings'
import { DEFAULT_NEWS_FILTER, parseNewsFilter } from './newsFilter'

// A stand-in for the phone's storage
function stubStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial))
  const storage = {
    getItem: vi.fn((key: string) => data.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => void data.set(key, value)),
  }
  vi.stubGlobal('localStorage', storage)
  return { data, storage }
}

afterEach(() => vi.unstubAllGlobals())

describe('the news language filter', () => {
  it('is all languages unless the person chose one', () => {
    expect(DEFAULT_NEWS_FILTER).toBe('all')
    expect(parseNewsFilter(null)).toBe('all')
    expect(parseNewsFilter(undefined)).toBe('all')
  })

  it.each(['all', 'en', 'si', 'ta'] as const)('reads "%s"', (value) => {
    expect(parseNewsFilter(value)).toBe(value)
  })

  it.each(['', 'EN', 'fr', 'sinhala', ' en', 'en,si', 5, {}, []])('reads %j as all, so a damaged value is harmless', (value) => {
    expect(parseNewsFilter(value)).toBe('all')
  })

  it('is remembered, under its own key', () => {
    const { data } = stubStorage()
    expect(NEWS_FILTER_KEY).toBe('terrafend:newsLanguage')
    expect(loadNewsFilter()).toBe('all')
    saveNewsFilter('ta')
    expect(data.get(NEWS_FILTER_KEY)).toBe('ta')
    expect(loadNewsFilter()).toBe('ta')
    saveNewsFilter('all')
    expect(loadNewsFilter()).toBe('all')
  })

  it('reads an old or damaged saved value as all', () => {
    stubStorage({ [NEWS_FILTER_KEY]: 'klingon' })
    expect(loadNewsFilter()).toBe('all')
  })

  it('does not break when the phone blocks storage', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('blocked')
      },
      setItem: () => {
        throw new Error('blocked')
      },
    })
    expect(loadNewsFilter()).toBe('all')
    expect(() => saveNewsFilter('si')).not.toThrow()
  })

  it('does not touch the other saved choices', () => {
    const { data } = stubStorage({ 'terrafend:rainView': 'past', 'terrafend:language': 'si' })
    saveNewsFilter('en')
    expect(data.get('terrafend:rainView')).toBe('past')
    expect(data.get('terrafend:language')).toBe('si')
  })
})
