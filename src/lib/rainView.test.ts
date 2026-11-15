import { afterEach, describe, expect, it, vi } from 'vitest'
import { loadRainView, RAIN_VIEW_KEY, saveRainView } from './layerSettings'
import type { GaugeRain } from './rainMeasured'
import type { RainSquare } from './rainSquares'
import { DEFAULT_RAIN_VIEW, otherView, parseRainView, rainViewCounts, squaresOf } from './rainView'

function square(lat: number, lng: number, extra: Partial<RainSquare> = {}): RainSquare {
  return {
    lat,
    lng,
    halfLat: 0.05,
    halfLng: 0.05,
    level: 'heavy',
    mild: null,
    mm: 9,
    probability: null,
    source: 'satellite',
    from: 0,
    to: 1,
    windowFrom: 0,
    windowTo: 1,
    ...extra,
  }
}

const gauge = (level: GaugeRain['level']): GaugeRain => ({
  id: 'a/b',
  station: 'b',
  river: 'a',
  lat: 7,
  lng: 80,
  mm1h: 9,
  mm3h: 9,
  mm24h: null,
  at: 0,
  rate: 9,
  level,
  mild: null,
  lastHour: true,
})

describe('parseRainView', () => {
  it('defaults to the next 3 hours', () => {
    expect(DEFAULT_RAIN_VIEW).toBe('next')
    expect(parseRainView(null)).toBe('next')
    expect(parseRainView(undefined)).toBe('next')
    expect(parseRainView('')).toBe('next')
  })

  it('reads a saved choice', () => {
    expect(parseRainView('past')).toBe('past')
    expect(parseRainView('next')).toBe('next')
  })

  it('ignores anything else', () => {
    expect(parseRainView('Past')).toBe('next')
    expect(parseRainView('both')).toBe('next')
    expect(parseRainView('1')).toBe('next')
  })
})

describe('otherView and squaresOf', () => {
  it('flips the view', () => {
    expect(otherView('past')).toBe('next')
    expect(otherView('next')).toBe('past')
  })

  it('gives the squares of the view that is on, and nothing from the other one', () => {
    const past = [square(7, 80)]
    const next = [square(8, 81, { source: 'forecast' })]
    expect(squaresOf({ past, next }, 'past')).toBe(past)
    expect(squaresOf({ past, next }, 'next')).toBe(next)
    expect(squaresOf({ past: null, next }, 'past')).toBeNull()
  })
})

describe('rainViewCounts', () => {
  it('counts touching squares as one area, like the threats chip does', () => {
    const past = [square(7, 80), square(7, 80.1), square(9, 81.5)]
    expect(rainViewCounts({ past, next: [] }, [])).toEqual({ past: 2, next: 0 })
  })

  it('adds the gauges that measured heavy rain to the past', () => {
    const past = [square(7, 80)]
    expect(rainViewCounts({ past, next: [] }, [gauge('heavy'), gauge('veryHeavy'), gauge(null)])).toEqual({
      past: 3,
      next: 0,
    })
  })

  it('counts the next 3 hours from the forecast squares alone', () => {
    const next = [square(7, 80, { source: 'forecast', level: 'thunder' }), square(5.9, 80.5, { source: 'forecast' })]
    expect(rainViewCounts({ past: [], next }, [gauge('heavy')])).toEqual({ past: 1, next: 2 })
  })

  it('does not count light or moderate squares as serious', () => {
    const past = [square(7, 80, { level: null, mild: 'moderate', mm: 3 }), square(8, 81, { level: null, mild: 'light', mm: 1 })]
    expect(rainViewCounts({ past, next: null }, [])).toEqual({ past: 0, next: 0 })
  })

  it('copes with a view that has no data', () => {
    expect(rainViewCounts({ past: null, next: null }, [])).toEqual({ past: 0, next: 0 })
  })
})

describe('remembering the view', () => {
  afterEach(() => vi.unstubAllGlobals())

  function fakeStorage(initial: Record<string, string> = {}) {
    const data = new Map(Object.entries(initial))
    return {
      data,
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => void data.set(key, value),
    }
  }

  it('starts on the next 3 hours when nothing is saved', () => {
    vi.stubGlobal('localStorage', fakeStorage())
    expect(loadRainView()).toBe('next')
  })

  it('saves a choice and reads it back', () => {
    const storage = fakeStorage()
    vi.stubGlobal('localStorage', storage)
    saveRainView('past')
    expect(storage.data.get(RAIN_VIEW_KEY)).toBe('past')
    expect(loadRainView()).toBe('past')
    saveRainView('next')
    expect(loadRainView()).toBe('next')
  })

  it('ignores a damaged saved value', () => {
    vi.stubGlobal('localStorage', fakeStorage({ [RAIN_VIEW_KEY]: '{"view":' }))
    expect(loadRainView()).toBe('next')
  })

  it('still works when storage is blocked', () => {
    const blocked = {
      getItem: () => {
        throw new Error('blocked')
      },
      setItem: () => {
        throw new Error('blocked')
      },
    }
    vi.stubGlobal('localStorage', blocked)
    expect(loadRainView()).toBe('next')
    expect(() => saveRainView('past')).not.toThrow()
  })

  it('uses its own key, apart from the yes/no switches', () => {
    expect(RAIN_VIEW_KEY).toBe('terrafend:rainView')
  })
})
