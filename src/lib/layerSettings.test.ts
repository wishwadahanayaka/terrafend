import { afterEach, describe, expect, it, vi } from 'vitest'
import { LAYER_DEFAULTS, loadLayerSettings, saveLayerSetting } from './layerSettings'

// What the Layers switches start as, and what is remembered. No browser: a small stand-in for
// localStorage.

function stubStorage(initial: Record<string, string> = {}) {
  const store = new Map(Object.entries(initial))
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
  })
  return store
}

afterEach(() => vi.unstubAllGlobals())

describe('the layer switches', () => {
  it('start off, except the landslide warnings, which start on', () => {
    stubStorage()
    expect(loadLayerSettings()).toEqual({ passableReports: false, normalRivers: false, mildRain: false, greenAlerts: false, landslides: true })
    expect(LAYER_DEFAULTS.landslides).toBe(true)
  })

  it('remember a choice, on or off, under their own names', () => {
    const store = stubStorage()
    saveLayerSetting('landslides', false)
    expect(store.get('terrafend:showLandslides')).toBe('0')
    expect(loadLayerSettings().landslides).toBe(false)
    saveLayerSetting('landslides', true)
    expect(store.get('terrafend:showLandslides')).toBe('1')
    expect(loadLayerSettings().landslides).toBe(true)
    saveLayerSetting('mildRain', true)
    expect(loadLayerSettings().mildRain).toBe(true)
  })

  it('keep the choices made before the landslide switch existed', () => {
    stubStorage({ 'terrafend:showAllRivers': '1', 'terrafend:showMildRain': '0' })
    expect(loadLayerSettings()).toMatchObject({ normalRivers: true, mildRain: false, landslides: true })
  })

  it('use the starting choice when storage is blocked, and keep working when it can’t save', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('blocked')
      },
      setItem: () => {
        throw new Error('blocked')
      },
    })
    expect(loadLayerSettings()).toEqual(LAYER_DEFAULTS)
    expect(() => saveLayerSetting('landslides', false)).not.toThrow()
  })

  it('treat any other saved text as "not chosen"', () => {
    stubStorage({ 'terrafend:showLandslides': 'maybe' })
    expect(loadLayerSettings().landslides).toBe(true)
  })
})
