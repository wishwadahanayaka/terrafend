import { describe, expect, it } from 'vitest'
import { roundOutward } from './mapBounds'

describe('roundOutward', () => {
  it('rounds min down and max up to 2 decimals', () => {
    expect(roundOutward({ minLng: 79.8612, minLat: 6.9271, maxLng: 79.8655, maxLat: 6.9299 })).toEqual({
      minLng: 79.86,
      minLat: 6.92,
      maxLng: 79.87,
      maxLat: 6.93,
    })
  })

  // The old bug: a zoomed-in view inside one 0.01 degree step rounded to a box with no
  // width, so the database found nothing in it
  it('never collapses a small view into a zero-width box', () => {
    const tiny = { minLng: 80.6331, minLat: 7.2902, maxLng: 80.6338, maxLat: 7.2907 }
    const box = roundOutward(tiny)
    expect(box.minLng).toBeLessThan(box.maxLng)
    expect(box.minLat).toBeLessThan(box.maxLat)
  })

  it('always contains the view it was given', () => {
    for (let i = 0; i < 500; i++) {
      const lng = 79.6 + i * 0.00437
      const lat = 5.9 + i * 0.00791
      const view = { minLng: lng, minLat: lat, maxLng: lng + 0.0003, maxLat: lat + 0.0002 }
      const box = roundOutward(view)
      expect(box.minLng).toBeLessThanOrEqual(view.minLng)
      expect(box.minLat).toBeLessThanOrEqual(view.minLat)
      expect(box.maxLng).toBeGreaterThanOrEqual(view.maxLng)
      expect(box.maxLat).toBeGreaterThanOrEqual(view.maxLat)
      expect(box.minLng).toBeLessThan(box.maxLng)
      expect(box.minLat).toBeLessThan(box.maxLat)
    }
  })
})
