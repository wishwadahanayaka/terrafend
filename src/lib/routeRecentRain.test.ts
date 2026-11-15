import { describe, expect, it } from 'vitest'
import { HOUR_MS } from './openMeteo'
import { satelliteCentre, satelliteIndexAt, SATELLITE_GRID, type GaugeRain, type MeasuredRain, type SatelliteRain } from './rainMeasured'
import { pastSquares } from './rainSquares'
import { recentRainAlongRoute } from './routeRecentRain'
import type { RouteResult } from './routing'

const { nx, ny } = SATELLITE_GRID
const CELLS = nx * ny // (ny only sizes the grid)
const NOW = Date.parse('2026-11-15T15:00:00Z')
const KM_PER_DEG = 111.32

// A short route inside one satellite cell near Kandy, so every point on it reads the same cell
const CELL = satelliteIndexAt(7.45, 80.64) as number
const [CELL_LAT, CELL_LNG] = satelliteCentre(CELL)
const route: RouteResult = {
  id: 1,
  coordinates: [
    [80.64, 7.43],
    [80.64, 7.47],
  ],
  distance_m: 4400,
  duration_s: 600,
  start: { lat: 7.43, lng: 80.64 },
  end: { lat: 7.47, lng: 80.64 },
}

function satellite(rain: Record<number, [mm: number, hours: number]> = {}): SatelliteRain {
  const mm: (number | null)[] = Array.from({ length: CELLS }, () => 0)
  const lightHours = Array.from({ length: CELLS }, () => 0)
  for (const [cell, [value, hours]] of Object.entries(rain)) {
    mm[Number(cell)] = value
    lightHours[Number(cell)] = hours
  }
  return { mm, lightHours, from: NOW - 4 * HOUR_MS, to: NOW - HOUR_MS }
}

// A gauge `km` due north of the middle of the cell, with readings that are too small to be a
// gauge line of their own (so only the light-rain rule can see it)
function gauge(km: number, mm1h: number | null, mm3h: number | null): GaugeRain {
  return {
    id: 'test/gauge',
    station: 'Test',
    river: 'Test',
    lat: CELL_LAT + km / KM_PER_DEG,
    lng: CELL_LNG,
    mm1h,
    mm3h,
    mm24h: null,
    at: NOW - 10 * 60_000,
    rate: 0,
    level: null,
    mild: null,
    lastHour: false,
  }
}

const measured = (sat: SatelliteRain, gauges: GaugeRain[] = []): MeasuredRain => ({ gauges, satellite: sat })
const lines = (sat: SatelliteRain, gauges: GaugeRain[] = []) => recentRainAlongRoute(route, measured(sat, gauges), NOW)

describe('a lone light patch on the route', () => {
  it('is not mentioned, because the map does not draw it', () => {
    const recent = lines(satellite({ [CELL]: [1, 1] }))
    expect(recent.quiet).toEqual([])
    expect(recent.satellite).toEqual([])
  })

  it('still counts as checked, so "nothing recently measured" can be said', () => {
    expect(lines(satellite({ [CELL]: [1, 1] })).checked).toBe(true)
  })

  it('is not mentioned when a gauge close by measured nothing, even if it lasted', () => {
    expect(lines(satellite({ [CELL]: [1, 3] }), [gauge(6, 0, 0)]).quiet).toEqual([])
  })
})

describe('light rain that something confirms', () => {
  it('is mentioned when it lasted 2 of the 3 hours', () => {
    const { quiet } = lines(satellite({ [CELL]: [1, 2] }))
    expect(quiet).toHaveLength(1)
    expect(quiet[0]).toMatch(/^Light rain fell along much of the route/)
  })

  it('is mentioned when a cell beside it also reads rain', () => {
    const { quiet } = lines(satellite({ [CELL]: [1, 1], [CELL + 1]: [0.8, 1] }))
    expect(quiet).toHaveLength(1)
    expect(quiet[0]).toMatch(/^Light rain fell/)
  })

  it('is mentioned when a gauge within 15 km measured rain', () => {
    const { quiet } = lines(satellite({ [CELL]: [1, 1] }), [gauge(8, 0.2, 1)])
    expect(quiet).toHaveLength(1)
    expect(quiet[0]).toMatch(/^Light rain fell/)
  })

  it('is not mentioned when the gauge that measured rain is more than 15 km away', () => {
    expect(lines(satellite({ [CELL]: [1, 1] }), [gauge(16, 0.2, 1)]).quiet).toEqual([])
  })
})

describe('what the rule leaves alone', () => {
  it('keeps moderate satellite rain, even with a dry gauge beside the route', () => {
    const { quiet } = lines(satellite({ [CELL]: [3, 1] }), [gauge(4, 0, 0)])
    expect(quiet).toHaveLength(1)
    expect(quiet[0]).toMatch(/^Moderate rain fell/)
  })

  it('keeps heavy satellite rain as a warning stretch', () => {
    const { satellite: stretches, quiet } = lines(satellite({ [CELL]: [9, 1] }), [gauge(4, 0, 0)])
    expect(stretches).toHaveLength(1)
    expect(stretches[0].level).toBe('heavy')
    expect(quiet).toEqual([])
  })

  it('says nothing when there is no satellite data', () => {
    const recent = recentRainAlongRoute(route, { gauges: [], satellite: null }, NOW)
    expect(recent.quiet).toEqual([])
    expect(recent.checked).toBe(true)
  })

  it('still reads a gauge near the route that measured light rain, which has its own line', () => {
    const wet = { ...gauge(1, 1, 3), mild: 'light' as const, rate: 1 }
    const { quiet } = lines(satellite(), [wet])
    expect(quiet).toHaveLength(1)
    expect(quiet[0]).toMatch(/^Light rain measured/)
  })
})

describe('the route and the map agree', () => {
  const scenarios: { name: string; rain: Record<number, [number, number]>; gauges: GaugeRain[] }[] = [
    { name: 'lone, nothing else', rain: { [CELL]: [1, 1] }, gauges: [] },
    { name: 'lasted', rain: { [CELL]: [1, 3] }, gauges: [] },
    { name: 'a neighbour reads rain', rain: { [CELL]: [1, 1], [CELL - nx]: [2, 1] }, gauges: [] },
    { name: 'a gauge measured rain', rain: { [CELL]: [1, 1] }, gauges: [gauge(9, 0, 2)] },
    { name: 'a dry gauge hides it', rain: { [CELL]: [1, 3], [CELL + 1]: [1, 3] }, gauges: [gauge(8, 0, 0)] },
    { name: 'a dry gauge, but far away', rain: { [CELL]: [1, 3] }, gauges: [gauge(12, 0, 0)] },
    { name: 'a dry gauge and a wet one', rain: { [CELL]: [1, 1] }, gauges: [gauge(7, 0, 0), gauge(9, 0, 3)] },
  ]

  it.each(scenarios)('light rain is on the map exactly when the route mentions it: $name', ({ rain, gauges }) => {
    const sat = satellite(rain)
    const onMap = (pastSquares(sat, gauges, NOW) ?? []).some((s) => satelliteIndexAt(s.lat, s.lng) === CELL)
    const mentioned = lines(sat, gauges).quiet.some((line) => line.startsWith('Light rain fell'))
    expect(mentioned).toBe(onMap)
  })
})
