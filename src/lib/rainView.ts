import type { GaugeRain } from './rainMeasured'
import { warningAreas } from './rainMap'
import type { RainSquare } from './rainSquares'

// Which rain the map shows. The two are never drawn together, because they cover different
// times: 'past' is what the satellite and the gauges measured in the last 3 hours, 'next' is what
// the forecast says for the next 3.
export type RainView = 'past' | 'next'

export const DEFAULT_RAIN_VIEW: RainView = 'next'

// Anything saved that isn't exactly 'past' (nothing yet, damaged, an old value) means the default
export function parseRainView(saved: string | null | undefined): RainView {
  return saved === 'past' || saved === 'next' ? saved : DEFAULT_RAIN_VIEW
}

export const otherView = (view: RainView): RainView => (view === 'past' ? 'next' : 'past')

export type RainSquareSets = { past: RainSquare[] | null; next: RainSquare[] | null }

// The squares of the chosen view, or null when that view's data isn't available
export const squaresOf = (sets: RainSquareSets, view: RainView): RainSquare[] | null => sets[view]

// How many serious things each view holds, so the half that isn't showing can still say so:
// warning areas (heavy, very heavy, thunderstorms) and gauges that measured heavy rain. Touching
// squares are one area, the same way the threats chip counts them.
export function rainViewCounts(sets: RainSquareSets, gauges: GaugeRain[]): Record<RainView, number> {
  return {
    past: warningAreas(sets.past ?? []).length + gauges.filter((g) => g.level !== null).length,
    next: warningAreas(sets.next ?? []).length,
  }
}
