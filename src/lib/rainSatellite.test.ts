import { describe, expect, it } from 'vitest'
import { HOUR_MS } from './openMeteo'
import { parseSatellite, SATELLITE_GRID } from './rainMeasured'

const CELLS = SATELLITE_GRID.nx * SATELLITE_GRID.ny
const GRID = { lat0: SATELLITE_GRID.lat0, lon0: SATELLITE_GRID.lng0, step: SATELLITE_GRID.step, nx: SATELLITE_GRID.nx, ny: SATELLITE_GRID.ny }
const T0 = Date.parse('2026-11-15T06:00:00Z')

// An hour of satellite text: tenths of a millimetre per cell, a blank for no report
function hour(start: number, cells: Record<number, string> = {}) {
  const values = Array.from({ length: CELLS }, (_, i) => cells[i] ?? '0')
  return { start, v: values.join(',') }
}

function answer(hours: ReturnType<typeof hour>[]) {
  return { grid: GRID, satellite: { hours } }
}

// Three hours in a row, then a clock a little after the last one ended
const NOW = T0 + 3 * HOUR_MS + 20 * 60_000

describe('parseSatellite: in how many hours a cell read light rain or more', () => {
  it('counts the hours at 0.5 mm or more', () => {
    const sat = parseSatellite(
      answer([
        hour(T0, { 100: '5', 101: '4', 102: '30' }),
        hour(T0 + HOUR_MS, { 100: '4', 101: '4', 102: '0' }),
        hour(T0 + 2 * HOUR_MS, { 100: '12', 101: '4', 102: '0' }),
      ]),
      NOW,
    )
    // 100: 0.5, 0.4, 1.2 mm -> 2 hours. 101: 0.4 every hour -> none. 102: 3 mm once -> 1 hour.
    expect(sat?.lightHours[100]).toBe(2)
    expect(sat?.lightHours[101]).toBe(0)
    expect(sat?.lightHours[102]).toBe(1)
    expect(sat?.lightHours[0]).toBe(0)
  })

  it('keeps the heaviest hour in mm, as before', () => {
    const sat = parseSatellite(
      answer([hour(T0, { 100: '5' }), hour(T0 + HOUR_MS, { 100: '4' }), hour(T0 + 2 * HOUR_MS, { 100: '12' })]),
      NOW,
    )
    expect(sat?.mm[100]).toBeCloseTo(1.2)
  })

  it('counts a blank cell as no rain, not as a light hour', () => {
    const sat = parseSatellite(
      answer([hour(T0, { 100: '' }), hour(T0 + HOUR_MS, { 100: '' }), hour(T0 + 2 * HOUR_MS, { 100: '6' })]),
      NOW,
    )
    expect(sat?.lightHours[100]).toBe(1)
    expect(sat?.mm[100]).toBeCloseTo(0.6)
  })

  it('only looks at the last 3 hours it has', () => {
    const sat = parseSatellite(
      answer([
        hour(T0 - 2 * HOUR_MS, { 100: '50' }),
        hour(T0, { 100: '5' }),
        hour(T0 + HOUR_MS, { 100: '0' }),
        hour(T0 + 2 * HOUR_MS, { 100: '0' }),
      ]),
      NOW,
    )
    expect(sat?.lightHours[100]).toBe(1)
  })

  it('has one number for every cell', () => {
    const sat = parseSatellite(answer([hour(T0)]), T0 + 2 * HOUR_MS)
    expect(sat?.lightHours).toHaveLength(CELLS)
    expect(sat?.mm).toHaveLength(CELLS)
  })
})
