import { describe, expect, it } from 'vitest'
import { OVERLAP_PX, spreadMarkers, SPACING_PX, type Pixel } from './markerSpread'

const px = (id: string, x: number, y: number): Pixel => ({ id, x, y })
const apart = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y)

describe('spreading overlapping markers', () => {
  it('leaves markers that do not overlap where they are', () => {
    const moved = spreadMarkers([px('a', 0, 0), px('b', 60, 0), px('c', 0, 200)])
    expect(moved.size).toBe(0)
  })

  it('draws the line at the width of a marker', () => {
    expect(spreadMarkers([px('a', 0, 0), px('b', OVERLAP_PX - 1, 0)]).size).toBe(1)
    expect(spreadMarkers([px('a', 0, 0), px('b', OVERLAP_PX, 0)]).size).toBe(0)
  })

  it('leaves a lone marker alone, and an empty list too', () => {
    expect(spreadMarkers([px('a', 5, 5)]).size).toBe(0)
    expect(spreadMarkers([]).size).toBe(0)
  })

  it('keeps the first marker in place and moves the other off it', () => {
    const moved = spreadMarkers([px('a', 100, 100), px('b', 100, 100)])
    expect(moved.has('a')).toBe(false)
    const b = moved.get('b')!
    // Above the first, one spacing away
    expect(b.x).toBeCloseTo(100, 6)
    expect(b.y).toBeCloseTo(100 - SPACING_PX, 6)
  })

  it('moves markers on exactly the same spot far enough apart to tap', () => {
    const points = Array.from({ length: 5 }, (_, i) => px(`m${i}`, 300, 300))
    const moved = spreadMarkers(points)
    const places = points.map((p) => moved.get(p.id) ?? p)
    for (let i = 0; i < places.length; i++) {
      for (let j = i + 1; j < places.length; j++) {
        expect(apart(places[i], places[j])).toBeGreaterThanOrEqual(OVERLAP_PX)
      }
    }
  })

  it('stays compact and clear of overlaps for a big pile', () => {
    const points = Array.from({ length: 25 }, (_, i) => px(`m${String(i).padStart(2, '0')}`, 0, 0))
    const moved = spreadMarkers(points)
    const places = points.map((p) => moved.get(p.id) ?? p)
    let closest = Infinity
    for (let i = 0; i < places.length; i++) {
      for (let j = i + 1; j < places.length; j++) closest = Math.min(closest, apart(places[i], places[j]))
    }
    expect(closest).toBeGreaterThanOrEqual(OVERLAP_PX)
    // 25 markers fit inside two rings and a bit: nowhere near 25 spacings from the middle
    expect(Math.max(...places.map((p) => apart(p, points[0])))).toBeLessThanOrEqual(3 * SPACING_PX + 1e-6)
  })

  it('keeps a spread marker in its place whatever order the list comes in', () => {
    const list = [px('first', 0, 0), px('b', 10, 0), px('c', 0, 10), px('d', 5, 5)]
    const one = spreadMarkers(list)
    // Same anchor first, the rest shuffled
    const two = spreadMarkers([list[0], list[3], list[1], list[2]])
    for (const id of ['b', 'c', 'd']) expect(two.get(id)).toEqual(one.get(id))
  })

  it('spreads each pile on its own', () => {
    const moved = spreadMarkers([px('a1', 0, 0), px('a2', 1, 1), px('b1', 500, 500), px('b2', 501, 500), px('lone', 900, 0)])
    expect([...moved.keys()].sort()).toEqual(['a2', 'b2'])
    // Each moved marker went around its own anchor
    expect(apart(moved.get('a2')!, { x: 0, y: 0 })).toBeCloseTo(SPACING_PX, 6)
    expect(apart(moved.get('b2')!, { x: 500, y: 500 })).toBeCloseTo(SPACING_PX, 6)
  })

  it('does not change the list it is given', () => {
    const list = [px('a', 0, 0), px('b', 0, 0)]
    spreadMarkers(list)
    expect(list).toEqual([px('a', 0, 0), px('b', 0, 0)])
  })
})
