import { describe, expect, it } from 'vitest'
import { HOUR_MS } from './openMeteo'
import { landGrid, WINDOW_HOURS, type RainCell, type RainMap } from './rainMap'
import { satelliteCentre, satelliteIndexAt, SATELLITE_GRID, type GaugeRain, type SatelliteRain } from './rainMeasured'
import { nextSquares, pastSquares } from './rainSquares'

const { nx, ny } = SATELLITE_GRID
const CELLS = nx * ny
const NOW = Date.parse('2026-11-15T15:00:00Z')

// Kandy, which is well inland
const KANDY = satelliteIndexAt(7.29, 80.64) as number
const [KANDY_LAT, KANDY_LNG] = satelliteCentre(KANDY)

function satellite(rain: Record<number, [mm: number, hours: number]> = {}): SatelliteRain {
  const mm: (number | null)[] = Array.from({ length: CELLS }, () => 0)
  const lightHours = Array.from({ length: CELLS }, () => 0)
  for (const [cell, [value, hours]] of Object.entries(rain)) {
    mm[Number(cell)] = value
    lightHours[Number(cell)] = hours
  }
  return { mm, lightHours, from: NOW - 4 * HOUR_MS, to: NOW - HOUR_MS }
}

function dryGauge(km: number): GaugeRain {
  return {
    id: 'test/dry',
    station: 'Dry',
    river: 'Test',
    lat: KANDY_LAT + km / 111.32,
    lng: KANDY_LNG,
    mm1h: 0,
    mm3h: 0,
    mm24h: 0,
    at: NOW - 10 * 60_000,
    rate: 0,
    level: null,
    mild: null,
    lastHour: false,
  }
}

// A forecast with every cell dry, except what a test changes
function forecast(change: Partial<RainCell> = {}, to = NOW + 2 * HOUR_MS): RainMap {
  const cells: RainCell[] = landGrid().cells.map((c) => ({
    ...c,
    level: null,
    mild: null,
    mm: null,
    possible: null,
    probability: null,
    hourStart: NOW,
    ...change,
  }))
  return { cells, from: NOW - 30 * 60_000, to }
}

const at = (squares: ReturnType<typeof pastSquares>, index: number) =>
  squares?.find((s) => satelliteIndexAt(s.lat, s.lng) === index)

describe('pastSquares', () => {
  it('is null when there is no satellite data, which is not the same as no rain', () => {
    expect(pastSquares(null, [], NOW)).toBeNull()
    expect(pastSquares(satellite(), [], NOW)).toEqual([])
  })

  it('draws heavy and moderate rain as it is, even alone', () => {
    const squares = pastSquares(satellite({ [KANDY]: [9, 1], [KANDY + 5]: [3, 1] }), [], NOW)
    expect(at(squares, KANDY)).toMatchObject({ level: 'heavy', mild: null, source: 'satellite', mm: 9 })
    expect(at(squares, KANDY + 5)).toMatchObject({ level: null, mild: 'moderate', source: 'satellite' })
  })

  it('draws very heavy rain as very heavy', () => {
    expect(at(pastSquares(satellite({ [KANDY]: [18, 1] }), [], NOW), KANDY)?.level).toBe('veryHeavy')
  })

  it('hides a lone light square', () => {
    expect(at(pastSquares(satellite({ [KANDY]: [1, 1] }), [], NOW), KANDY)).toBeUndefined()
  })

  it('draws light rain that lasted, or has light rain beside it', () => {
    expect(at(pastSquares(satellite({ [KANDY]: [1, 2] }), [], NOW), KANDY)).toMatchObject({ mild: 'light' })
    const beside = pastSquares(satellite({ [KANDY]: [1, 1], [KANDY + 1]: [1, 1] }), [], NOW)
    expect(at(beside, KANDY)).toBeDefined()
    expect(at(beside, KANDY + 1)).toBeDefined()
  })

  it('lets a gauge that measured nothing hide light rain, but not moderate rain', () => {
    const sat = satellite({ [KANDY]: [1, 3], [KANDY + 1]: [3, 3] })
    const squares = pastSquares(sat, [dryGauge(4)], NOW)
    expect(at(squares, KANDY)).toBeUndefined()
    expect(at(squares, KANDY + 1)?.mild).toBe('moderate')
  })

  it('keeps heavy rain too when a dry gauge is close', () => {
    expect(at(pastSquares(satellite({ [KANDY]: [9, 1] }), [dryGauge(2)], NOW), KANDY)?.level).toBe('heavy')
  })

  it('says which time it covers: the satellite window', () => {
    const sat = satellite({ [KANDY]: [3, 1] })
    expect(at(pastSquares(sat, [], NOW), KANDY)).toMatchObject({
      from: sat.from,
      to: sat.to,
      windowFrom: sat.from,
      windowTo: sat.to,
      probability: null,
    })
  })

  it('has no squares from the forecast in it', () => {
    const squares = pastSquares(satellite({ [KANDY]: [9, 1] }), [], NOW) ?? []
    expect(squares.every((s) => s.source === 'satellite')).toBe(true)
  })
})

describe('nextSquares', () => {
  it('is null when there is no forecast, which is not the same as no rain', () => {
    expect(nextSquares(null)).toBeNull()
    expect(nextSquares(forecast())).toEqual([])
  })

  it('draws the squares the forecast has rain for, with its chance of rain', () => {
    const squares = nextSquares(forecast({ level: 'heavy', mm: 9, probability: 80 })) ?? []
    expect(squares.length).toBeGreaterThan(100)
    expect(squares[0]).toMatchObject({ level: 'heavy', mm: 9, probability: 80, source: 'forecast' })
  })

  it('keeps light and moderate forecasts, for the Rain switch to add', () => {
    expect(nextSquares(forecast({ mild: 'light', mm: 1 }))?.every((s) => s.mild === 'light')).toBe(true)
    expect(nextSquares(forecast({ mild: 'moderate', mm: 3 }))?.every((s) => s.mild === 'moderate')).toBe(true)
  })

  it('leaves out a "possible" note, which is never drawn', () => {
    expect(nextSquares(forecast({ possible: 'thunderPossible' }))).toEqual([])
  })

  it('says which time it covers: the hour of the worst rain, and the 3 hours the view looks ahead', () => {
    const to = NOW + 2 * HOUR_MS
    const [square] = nextSquares(forecast({ level: 'thunder', mm: 20, probability: 90, hourStart: NOW + HOUR_MS }, to)) ?? []
    expect(square).toMatchObject({
      from: NOW + HOUR_MS,
      to: NOW + 2 * HOUR_MS,
      windowFrom: to - WINDOW_HOURS * HOUR_MS,
      windowTo: to,
    })
  })

  it('has no squares from the satellite in it', () => {
    const squares = nextSquares(forecast({ level: 'heavy', mm: 9, probability: 80 })) ?? []
    expect(squares.every((s) => s.source === 'forecast')).toBe(true)
  })
})

describe('past and next are never mixed', () => {
  it('give each its own value for the same patch of ground', () => {
    // Moderate rain fell at Kandy, and the forecast says heavy rain is likely there
    const past = pastSquares(satellite({ [KANDY]: [3, 3] }), [], NOW)
    const next = nextSquares(forecast({ level: 'heavy', mm: 9, probability: 80 }))
    expect(at(past, KANDY)).toMatchObject({ mild: 'moderate', level: null, source: 'satellite' })
    expect(at(next, KANDY)).toMatchObject({ level: 'heavy', mild: null, source: 'forecast' })
  })

  it('show the satellite alone in the past even when the forecast says it is dry', () => {
    const past = pastSquares(satellite({ [KANDY]: [9, 1] }), [], NOW)
    const next = nextSquares(forecast())
    expect(at(past, KANDY)?.level).toBe('heavy')
    expect(next).toEqual([])
  })

  it('show the forecast alone in the next hours even when the satellite saw nothing', () => {
    const past = pastSquares(satellite(), [], NOW)
    const next = nextSquares(forecast({ level: 'heavy', mm: 9, probability: 80 }))
    expect(past).toEqual([])
    expect((next ?? []).length).toBeGreaterThan(0)
  })

  it('draw one square per grid cell at most', () => {
    const squares = nextSquares(forecast({ level: 'heavy', mm: 9, probability: 80 })) ?? []
    const cells = squares.map((s) => satelliteIndexAt(s.lat, s.lng))
    expect(new Set(cells).size).toBe(cells.length)
  })
})
