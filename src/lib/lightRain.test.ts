import { describe, expect, it } from 'vitest'
import {
  GAUGE_FRESH_MS,
  LIGHT_CONFIRM_HOURS,
  LIGHT_CONFIRM_KM,
  LIGHT_VETO_KM,
  lightRainVerdict,
  neighbourIndexes,
} from './lightRain'
import { satelliteCentre, SATELLITE_GRID, type GaugeRain, type SatelliteRain } from './rainMeasured'

const { nx, ny } = SATELLITE_GRID
const CELLS = nx * ny
const NOW = Date.parse('2026-11-15T15:00:00Z')
const KM_PER_DEG = 111.32

// A cell in the middle of the grid, so all 8 neighbours exist
const CENTRE = 20 * nx + 10
const [CENTRE_LAT, CENTRE_LNG] = satelliteCentre(CENTRE)

// A satellite answer that is dry everywhere except where the test puts rain: cell -> [mm, hours]
function satellite(rain: Record<number, [mm: number, hours: number]> = {}): SatelliteRain {
  const mm: (number | null)[] = Array.from({ length: CELLS }, () => 0)
  const lightHours = Array.from({ length: CELLS }, () => 0)
  for (const [cell, [value, hours]] of Object.entries(rain)) {
    mm[Number(cell)] = value
    lightHours[Number(cell)] = hours
  }
  return { mm, lightHours, from: NOW - 4 * 3_600_000, to: NOW - 3_600_000 }
}

type GaugeBits = Partial<Pick<GaugeRain, 'mm1h' | 'mm3h' | 'at'>> & { km?: number }

// A gauge `km` due north of the square's middle
function gauge({ km = 5, mm1h = null, mm3h = null, at = NOW - 10 * 60_000 }: GaugeBits): GaugeRain {
  return {
    id: 'test/gauge',
    station: 'Test',
    river: 'Test',
    lat: CENTRE_LAT + km / KM_PER_DEG,
    lng: CENTRE_LNG,
    mm1h,
    mm3h,
    mm24h: null,
    at,
    rate: 0,
    level: null,
    mild: null,
    lastHour: false,
  }
}

const verdict = (sat: SatelliteRain, gauges: GaugeRain[] = []) =>
  lightRainVerdict(CENTRE, CENTRE_LAT, CENTRE_LNG, sat, gauges, NOW)

describe('neighbourIndexes', () => {
  it('gives all 8 cells around one in the middle of the grid', () => {
    expect(neighbourIndexes(CENTRE).sort((a, b) => a - b)).toEqual(
      [CENTRE - nx - 1, CENTRE - nx, CENTRE - nx + 1, CENTRE - 1, CENTRE + 1, CENTRE + nx - 1, CENTRE + nx, CENTRE + nx + 1].sort(
        (a, b) => a - b,
      ),
    )
  })

  it('gives 3 at a corner and 5 along an edge', () => {
    expect(neighbourIndexes(0).sort((a, b) => a - b)).toEqual([1, nx, nx + 1])
    expect(neighbourIndexes(CELLS - 1)).toHaveLength(3)
    expect(neighbourIndexes(10)).toHaveLength(5)
  })

  it('does not wrap round from the last column to the first column of the next row', () => {
    // Row 0, last column: the cell "after" it in the list is row 1, column 0, which is on the far side
    const last = nx - 1
    expect(neighbourIndexes(last).sort((a, b) => a - b)).toEqual([last - 1, last + nx - 1, last + nx])
    // Row 1, first column: the cell "before" it is row 0, last column
    expect(neighbourIndexes(nx)).not.toContain(nx - 1)
    expect(neighbourIndexes(nx)).toHaveLength(5)
  })
})

describe('light rain on its own', () => {
  it('is hidden when it is one cell, one hour, with nothing next to it and no gauge', () => {
    expect(verdict(satellite({ [CENTRE]: [1, 1] }))).toEqual({ show: false, reason: 'alone' })
  })

  it('is hidden when the satellite has no number for the cell', () => {
    const sat = satellite()
    sat.mm[CENTRE] = null
    expect(verdict(sat).show).toBe(false)
  })
})

describe('light rain that lasted', () => {
  it('shows when it read light rain or more in 2 of the 3 hours', () => {
    expect(LIGHT_CONFIRM_HOURS).toBe(2)
    expect(verdict(satellite({ [CENTRE]: [1, 2] }))).toEqual({ show: true, reason: 'lasted' })
    expect(verdict(satellite({ [CENTRE]: [1, 3] })).show).toBe(true)
  })

  it('does not show for just 1 hour', () => {
    expect(verdict(satellite({ [CENTRE]: [1, 1] })).show).toBe(false)
  })
})

describe('light rain with rain beside it', () => {
  it('shows when any of the 8 cells around it reads light rain', () => {
    for (const neighbour of neighbourIndexes(CENTRE)) {
      expect(verdict(satellite({ [CENTRE]: [1, 1], [neighbour]: [0.5, 1] })), `cell ${neighbour}`).toEqual({
        show: true,
        reason: 'neighbour',
      })
    }
  })

  it('counts a neighbour with heavier rain too', () => {
    expect(verdict(satellite({ [CENTRE]: [1, 1], [CENTRE + 1]: [12, 1] })).show).toBe(true)
  })

  it('does not count a neighbour below the light level', () => {
    expect(verdict(satellite({ [CENTRE]: [1, 1], [CENTRE + 1]: [0.4, 0] })).show).toBe(false)
  })

  it('does not count a cell two away', () => {
    expect(verdict(satellite({ [CENTRE]: [1, 1], [CENTRE + 2]: [3, 3] })).show).toBe(false)
  })

  it('does not count the cell on the other edge of the grid', () => {
    // First cell of row 1 is not a neighbour of the last cell of row 0
    const last = nx - 1
    const [lat, lng] = satelliteCentre(last)
    const sat = satellite({ [last]: [1, 1], [nx]: [3, 3] })
    expect(lightRainVerdict(last, lat, lng, sat, [], NOW).show).toBe(false)
  })
})

describe('a gauge that measured rain nearby', () => {
  it('shows light rain when a gauge within 15 km measured at least 0.5 mm in 3 hours', () => {
    expect(LIGHT_CONFIRM_KM).toBe(15)
    const sat = satellite({ [CENTRE]: [1, 1] })
    expect(verdict(sat, [gauge({ km: 14, mm3h: 0.5 })])).toEqual({ show: true, reason: 'gauge' })
    expect(verdict(sat, [gauge({ km: 3, mm3h: 4 })]).show).toBe(true)
  })

  it('does not count a gauge more than 15 km away', () => {
    expect(verdict(satellite({ [CENTRE]: [1, 1] }), [gauge({ km: 16, mm3h: 5 })]).show).toBe(false)
  })

  it('does not count a gauge that measured less than 0.5 mm', () => {
    expect(verdict(satellite({ [CENTRE]: [1, 1] }), [gauge({ km: 3, mm3h: 0.4 })]).show).toBe(false)
  })

  it('uses the last hour when the 3-hour number is missing', () => {
    expect(verdict(satellite({ [CENTRE]: [1, 1] }), [gauge({ km: 3, mm1h: 0.8, mm3h: null })]).show).toBe(true)
  })

  it('ignores a gauge that said nothing (null is unknown, not rain)', () => {
    expect(verdict(satellite({ [CENTRE]: [1, 1] }), [gauge({ km: 3 })]).show).toBe(false)
  })

  it('ignores a stale reading', () => {
    const sat = satellite({ [CENTRE]: [1, 1] })
    expect(GAUGE_FRESH_MS).toBe(90 * 60_000)
    expect(verdict(sat, [gauge({ km: 3, mm3h: 5, at: NOW - GAUGE_FRESH_MS })]).show).toBe(true)
    expect(verdict(sat, [gauge({ km: 3, mm3h: 5, at: NOW - GAUGE_FRESH_MS - 1 })]).show).toBe(false)
  })
})

describe('the gauge veto', () => {
  const lasting = () => satellite({ [CENTRE]: [1, 3], [CENTRE + 1]: [1, 3] })

  it('hides light rain when a gauge within 10 km measured exactly 0 mm', () => {
    expect(LIGHT_VETO_KM).toBe(10)
    expect(verdict(lasting(), [gauge({ km: 9, mm1h: 0, mm3h: 0 })])).toEqual({ show: false, reason: 'vetoed' })
  })

  it('wins over rain that lasted, rain beside it and another gauge that measured rain', () => {
    const wet = gauge({ km: 12, mm3h: 6 })
    expect(verdict(lasting(), [wet]).show).toBe(true)
    expect(verdict(lasting(), [wet, gauge({ km: 8, mm3h: 0 })]).show).toBe(false)
  })

  it('works when only the 3-hour number is 0 and the last hour is missing', () => {
    expect(verdict(lasting(), [gauge({ km: 5, mm1h: null, mm3h: 0 })]).reason).toBe('vetoed')
  })

  it('does not apply to a gauge more than 10 km away', () => {
    expect(verdict(lasting(), [gauge({ km: 11, mm1h: 0, mm3h: 0 })]).show).toBe(true)
  })

  it('does not apply when the 3-hour number is missing (unknown is not dry)', () => {
    expect(verdict(lasting(), [gauge({ km: 5, mm1h: 0, mm3h: null })]).show).toBe(true)
  })

  it('does not apply when the last hour had any rain', () => {
    expect(verdict(lasting(), [gauge({ km: 5, mm1h: 0.2, mm3h: 0 })]).show).toBe(true)
  })

  it('does not apply to a stale reading', () => {
    expect(verdict(lasting(), [gauge({ km: 5, mm1h: 0, mm3h: 0, at: NOW - GAUGE_FRESH_MS - 1 })]).show).toBe(true)
  })
})
