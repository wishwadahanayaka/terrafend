import { describe, expect, it } from 'vitest'
import { fitParts, GAP_PX, MAX_LINES } from './chipFit'

// Widths are in px. A line holds `capacity`, and parts are separated by GAP_PX.
const CAPACITY = 260
const MORE = 60 // the "+N more" link
const NEWS = 80 // the News part

describe('fitting the chip into two lines', () => {
  it('is two lines with a 6 px gap', () => {
    expect(GAP_PX).toBe(6)
    expect(MAX_LINES).toBe(2)
  })

  it('shows everything when it fits in two lines', () => {
    expect(fitParts([100, 100, 100], MORE, CAPACITY)).toBe(3)
    expect(fitParts([120], MORE, CAPACITY)).toBe(1)
    // two per line: 120 + 6 + 120 = 246
    expect(fitParts([120, 120, 120, 120], MORE, CAPACITY)).toBe(4)
  })

  it('drops parts from the end and makes room for "+N more" when it does not', () => {
    // five would need three lines. Four plus "+N more" is also three. Three plus "+N more" is two.
    expect(fitParts([120, 120, 120, 120, 120], MORE, CAPACITY)).toBe(3)
  })

  it('counts the gap between parts', () => {
    // 128 + 128 = 256 would share a line, but 128 + 6 + 128 = 262 does not. So each is on its own
    // line, and the third has to go: two parts and "+N more" is two lines.
    expect(fitParts([128, 128, 128], MORE, CAPACITY)).toBe(2)
  })

  it('always shows at least one part', () => {
    expect(fitParts([400, 400, 400], MORE, CAPACITY)).toBe(1)
    expect(fitParts([], MORE, CAPACITY)).toBe(1)
  })

  describe('with a part that is always shown at the end (the News part)', () => {
    it('is the same as before when there is none', () => {
      for (const widths of [[100, 100, 100], [120, 120, 120, 120, 120], [400, 400], [128, 128, 128]]) {
        expect(fitParts(widths, MORE, CAPACITY, 0)).toBe(fitParts(widths, MORE, CAPACITY))
      }
    })

    it('keeps its room, so fewer of the other parts fit beside it', () => {
      // four parts fit alone, but not with an 80 px part after them: two parts, "+N more" and the News part
      expect(fitParts([120, 120, 120, 120], MORE, CAPACITY)).toBe(4)
      expect(fitParts([120, 120, 120, 120], MORE, CAPACITY, NEWS)).toBe(2)
    })

    it('is never one of the parts that goes under "+N more": five parts and it still leaves room', () => {
      expect(fitParts([120, 120, 120, 120, 120], MORE, CAPACITY, NEWS)).toBe(2)
    })

    it('fits beside a single part', () => {
      // 150 + 6 + 80 = 236
      expect(fitParts([150], MORE, CAPACITY, NEWS)).toBe(1)
    })

    it('lets the News part go onto the second line when the parts are on the first', () => {
      // 100 + 6 + 100 + 6 + 80 = 292 is over a line, so the News part wraps: still two lines
      expect(fitParts([100, 100], MORE, CAPACITY, NEWS)).toBe(2)
    })

    it('still shows one part when nothing fits', () => {
      expect(fitParts([300, 300], MORE, CAPACITY, 200)).toBe(1)
    })
  })
})
