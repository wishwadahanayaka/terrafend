import { currentHourEnd, fetchHourly, HOUR_MS, labelForHourEnd, type Hourly } from './openMeteo'
import { kmFrom, readFakeRainMap } from './fakeRainMap'
import { forecastTooOld } from './forecastAge'
import { forecastHour, RAIN_RANK, type MildLevel, type PossibleLevel, type RainLevel } from './rainForecast'

// How many hours ahead the map looks. Each grid cell shows the worst of them.
const WINDOW_HOURS = 3

// The grid starts at this spacing and widens until it fits in MAX_POINTS. Sri Lanka
// is about 65,000 km², so 150 points ends up roughly 21 km apart.
const START_SPACING_KM = 15
const MAX_POINTS = 150
const KM_PER_DEG = 111.32

// A rough coastline, only used to leave out grid points that fall in the sea.
// [lng, lat] pairs, simplified to about 2 km from geoBoundaries (CC BY 4.0).
// The big ring is the main island, the small one is Mannar island.
const OUTLINE: [number, number][][] = [
  [[79.8,9.1],[79.71,9.1],[79.68,9.08],[79.79,9.05],[79.89,8.96],[79.93,8.98],[79.85,9.06],[79.93,9.01],[79.89,9.05],[79.8,9.1]],
  [[80.21,9.84],[80.03,9.82],[79.91,9.77],[79.94,9.69],[79.97,9.73],[79.97,9.7],[80.02,9.65],[80.13,9.61],[80.08,9.66],[80.21,9.58],[80.16,9.65],[80.17,9.66],[80.41,9.52],[80.31,9.44],[80.24,9.47],[80.28,9.48],[80.25,9.51],[80.28,9.5],[80.22,9.53],[80.05,9.6],[80.19,9.49],[80.05,9.39],[80.06,9.33],[80.12,9.3],[80.12,9.21],[80.05,9.03],[79.91,8.94],[79.94,8.9],[79.92,8.81],[79.96,8.72],[79.92,8.55],[79.87,8.54],[79.84,8.31],[79.79,8.23],[79.84,8.14],[79.79,8.08],[79.84,8.01],[79.82,7.91],[79.82,7.98],[79.74,8.01],[79.76,8.06],[79.73,8.12],[79.74,8.2],[79.77,8.22],[79.78,8.26],[79.73,8.23],[79.79,8.38],[79.73,8.24],[79.69,8.21],[79.71,8.06],[79.8,7.7],[79.83,7.21],[79.87,7.11],[79.84,7.11],[79.82,7.21],[79.87,6.98],[79.85,6.94],[79.83,6.97],[79.82,6.94],[80.06,6.19],[80.24,6.01],[80.59,5.92],[80.72,5.96],[80.81,6.04],[81.32,6.2],[81.69,6.49],[81.83,6.76],[81.88,7.02],[81.87,7.32],[81.76,7.66],[81.7,7.75],[81.58,7.85],[81.58,7.92],[81.56,7.94],[81.51,7.91],[81.55,7.99],[81.47,8.04],[81.35,8.5],[81.32,8.53],[81.24,8.45],[81.18,8.51],[81.13,8.5],[81.15,8.55],[81.21,8.51],[81.2,8.58],[81.24,8.54],[81.23,8.65],[80.97,8.98],[80.95,8.93],[80.91,8.95],[80.93,8.97],[80.92,9.01],[80.88,9.03],[80.89,9.05],[80.96,8.99],[80.81,9.29],[80.36,9.66],[80.25,9.82],[80.21,9.84]],
]

export function onLand(lat: number, lng: number): boolean {
  // Ray casting: count the coastline edges a line going east crosses
  return OUTLINE.some((ring) => {
    let inside = false
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [x1, y1] = ring[i]
      const [x2, y2] = ring[j]
      if (y1 > lat !== y2 > lat && lng < ((x2 - x1) * (lat - y1)) / (y2 - y1) + x1) inside = !inside
    }
    return inside
  })
}

export type GridCell = {
  lat: number
  lng: number
  // Half the cell's height and width, in degrees
  halfLat: number
  halfLng: number
}

export type GridInfo = { cells: GridCell[]; spacingKm: number }

let grid: GridInfo | null = null

// Land points on an even grid, only the ones on land. It never changes, so it's built once.
export function landGrid(): GridInfo {
  if (grid) return grid
  const south = 5.85
  const north = 9.9
  const west = 79.6
  const east = 81.95
  // One width for every row, so the cells line up in columns. The island is narrow
  // enough that the difference between rows is about 1%.
  const midLat = (south + north) / 2
  const degPerKmLng = 1 / (KM_PER_DEG * Math.cos((midLat * Math.PI) / 180))

  for (let spacingKm = START_SPACING_KM; ; spacingKm += 1) {
    const halfLat = spacingKm / KM_PER_DEG / 2
    const halfLng = (spacingKm * degPerKmLng) / 2
    const cells: GridCell[] = []
    for (let lat = south + halfLat; lat < north; lat += halfLat * 2) {
      for (let lng = west + halfLng; lng < east; lng += halfLng * 2) {
        if (onLand(lat, lng)) cells.push({ lat, lng, halfLat, halfLng })
      }
    }
    if (cells.length <= MAX_POINTS) {
      grid = { cells, spacingKm }
      return grid
    }
  }
}

export type RainCell = GridCell & {
  // A heavy warning, or a quieter level (only one of the two is ever set)
  level: RainLevel | null
  mild: MildLevel | null
  mm: number | null
  // A storm or heavy showers the forecast only thinks possible in these 3 hours. Kept apart
  // from the level and the amount above, so it never hides them, and never drawn.
  possible: PossibleLevel | null
  // Chance of rain in that hour, in percent. null means the model didn't say.
  probability: number | null
  // The start of the hour with the worst rain
  hourStart: number
}

export type RainMap = {
  // Every grid cell in the same order as landGrid(), dry ones included. Which cell is
  // nearest to a place can only be worked out if the dry ones are there too.
  cells: RainCell[]
  // When the forecast behind it was loaded, and the end of the 3 hours it shows
  from: number
  to: number
}

// What the one island request brings back, kept as it is: the hourly numbers for every cell,
// from the hour it was loaded until the end of tomorrow. The "next 3 hours" are picked from
// it when the map is drawn, so an older forecast stays right as the hours go by.
export type ForecastGrid = {
  fetchedAt: number
  // Sri Lanka hour labels like "2026-11-03T14:00", the same for every cell
  times: string[]
  // In the same order as landGrid()
  cells: { mm: (number | null)[]; code: (number | null)[]; chance: (number | null)[] }[]
  // Set when this came from the shared cache after it had got too old to trust as current and the
  // direct request failed: it is shown with its time ("Forecast from ...") and retried sooner
  staleCache?: boolean
}

// Higher is worse. Any warning beats any quieter level.
export function rainScore(level: RainLevel | null, mild: MildLevel | null): number {
  if (level) return 10 + RAIN_RANK[level]
  return mild === 'moderate' ? 2 : mild === 'light' ? 1 : 0
}

// Keeps the hours from the current one onward (earlier ones are of no use to anyone). Used for a
// forecast just fetched and for one read from the shared cache, which can be an hour or more old,
// so the hours are counted from `now`, not from when it was fetched.
export function trimGrid(times: string[], cells: ForecastGrid['cells'], fetchedAt: number, now: number): ForecastGrid {
  const first = times.indexOf(labelForHourEnd(currentHourEnd(now)))
  const from = first === -1 ? 0 : first
  return {
    fetchedAt,
    times: times.slice(from),
    cells: cells.map((c) => ({ mm: c.mm.slice(from), code: c.code.slice(from), chance: c.chance.slice(from) })),
  }
}

// Checks every cell came back with the same hours, since they are stored once for all of them
export function buildGrid(forecasts: Hourly[], now: number): ForecastGrid {
  const times = forecasts[0]?.time
  if (!times || forecasts.some((f) => f.time.length !== times.length || f.time.some((t, i) => t !== times[i]))) {
    throw new Error('Rain forecast: unexpected answer')
  }
  const cells = forecasts.map((f) => ({ mm: f.precipitation, code: f.weather_code, chance: f.probability }))
  return trimGrid(times, cells, now, now)
}

// One request straight to Open-Meteo for the whole island. The app asks the shared cache first
// (forecastCache.ts) and comes here when that has nothing good enough.
export async function fetchForecastGrid(): Promise<ForecastGrid> {
  const forecasts = await fetchHourly(landGrid().cells)
  const grid = buildGrid(forecasts, Date.now())
  if (pickWindow(grid, grid.fetchedAt) === null) throw new Error('Rain forecast: no hours covered')
  return grid
}

// The next 3 hours as they are at `now`: each cell gets the worst of them. Null when the
// forecast doesn't reach all 3 hours any more, or was fetched more than 6 hours ago (forecastAge.ts).
// The screens redraw this once an hour, so useRainMap also checks the age on its own timer.
export function pickWindow(grid: ForecastGrid, now: number): RainMap | null {
  if (forecastTooOld(grid.fetchedAt, now)) return null
  const firstEnd = currentHourEnd(now)
  const ends = Array.from({ length: WINDOW_HOURS }, (_, i) => firstEnd + i * HOUR_MS)
  const at = ends.map((end) => grid.times.indexOf(labelForHourEnd(end)))
  if (at.includes(-1)) return null

  const points = landGrid().cells
  if (grid.cells.length !== points.length) return null

  const cells: RainCell[] = points.map((point, i) => {
    const hours = grid.cells[i]
    const cell: RainCell = {
      ...point,
      level: null,
      mild: null,
      mm: null,
      possible: null,
      probability: null,
      hourStart: ends[0] - HOUR_MS,
    }
    let best = 0
    for (const [h, index] of at.entries()) {
      const mm = hours.mm[index]
      const probability = hours.chance[index]
      const { level, mild, possible } = forecastHour(mm, hours.code[index], probability)
      // A thunderstorm note beats a heavy showers one
      if (possible && (!cell.possible || possible === 'thunderPossible')) cell.possible = possible
      // Strictly worse only, so a tie keeps the earlier hour
      if (rainScore(level, mild) > best) {
        best = rainScore(level, mild)
        Object.assign(cell, { level, mild, mm, probability, hourStart: ends[h] - HOUR_MS })
      }
    }
    return cell
  })

  return { cells, from: grid.fetchedAt, to: ends[ends.length - 1] }
}

// Which translation key the one "possible" line in the Layers panel uses, or null for none.
// When the map already shows thunderstorm areas (forecast cells at 'thunder'; the satellite can
// never produce one, and thunder outranks everything, so those are exactly the ones drawn), the
// line says storms may also develop in OTHER parts, so it doesn't read as if the drawn areas were
// the only guess. The key is for t('layers.<key>').
export type PossibleNoteKey = 'possibleStorms' | 'possibleStormsAlso' | 'possibleShowers' | 'possibleBoth' | 'possibleBothAlso'

export function possibleNoteKey(cells: { level: RainLevel | null; possible: PossibleLevel | null }[]): PossibleNoteKey | null {
  const storms = cells.some((c) => c.possible === 'thunderPossible')
  const showers = cells.some((c) => c.possible === 'heavyShowers')
  const shown = cells.some((c) => c.level === 'thunder')
  if (storms && showers) return shown ? 'possibleBothAlso' : 'possibleBoth'
  if (storms) return shown ? 'possibleStormsAlso' : 'possibleStorms'
  return showers ? 'possibleShowers' : null
}

export type RainMapState =
  | { status: 'pending' | 'error'; data: null; olderFrom: null }
  // olderFrom: when the forecast on show was loaded, set only when the latest refresh failed
  // and this is the last one that worked
  | { status: 'success'; data: RainMap; olderFrom: number | null }

// What the screens are told. The forecast is 'success' as long as it still reaches the next
// 3 hours, even if the latest refresh failed (then olderFrom says when it is from). Only with
// nothing usable left is it 'error', or 'pending' while a try is under way.
export function rainMapState(
  grid: ForecastGrid | undefined,
  map: RainMap | null,
  query: { isError: boolean; isFetching: boolean; isPending: boolean },
): RainMapState {
  // Older numbers are labelled with their time after a failed refresh, and when they came from a
  // cache that had got too old (staleCache)
  if (grid && map) return { status: 'success', data: map, olderFrom: query.isError || grid.staleCache ? grid.fetchedAt : null }
  if (grid ? query.isFetching : query.isPending) return { status: 'pending', data: null, olderFrom: null }
  return { status: 'error', data: null, olderFrom: null }
}

// What the map draws: the window at `now`, plus the dev test rain on top
export function rainMapAt(grid: ForecastGrid, now: number): RainMap | null {
  const map = pickWindow(grid, now)
  if (map && import.meta.env.DEV) applyTestRain(map.cells, currentHourEnd(now) - HOUR_MS)
  return map
}

type Square = GridCell & { level: RainLevel | null }

// Neighbouring warning squares (touching sides or corners) count as one area, so a big
// storm is "1 area" and not a dozen. Returns the squares of each area. Works on the
// forecast cells and on the combined squares alike.
export function warningAreas<T extends Square>(cells: T[]): T[][] {
  const warnings = cells.filter((c) => c.level !== null)
  const seen = new Set<T>()
  const areas: T[][] = []
  for (const start of warnings) {
    if (seen.has(start)) continue
    const area: T[] = []
    const queue = [start]
    seen.add(start)
    while (queue.length > 0) {
      const cell = queue.pop() as T
      area.push(cell)
      for (const other of warnings) {
        if (seen.has(other)) continue
        // 1.5 cell widths reaches the next cell over, diagonals too, but not two over
        if (
          Math.abs(other.lat - cell.lat) <= cell.halfLat * 3 &&
          Math.abs(other.lng - cell.lng) <= cell.halfLng * 3
        ) {
          seen.add(other)
          queue.push(other)
        }
      }
    }
    areas.push(area)
  }
  return areas
}

// Cells within this distance of the place get the fake rain, so it covers an area.
// The forecast fakes (see fakeRainMap.ts) are applied here, to the forecast cells.
const TEST_RADIUS_KM = 25

function applyTestRain(cells: RainCell[], hourStart: number) {
  for (const { fake, spot } of readFakeRainMap('forecast')) {
    if (!spot) continue
    const nearest = cells.reduce((a, b) => (kmFrom(b.lat, b.lng, spot) < kmFrom(a.lat, a.lng, spot) ? b : a))
    for (const cell of cells) {
      if (cell === nearest || kmFrom(cell.lat, cell.lng, spot) <= TEST_RADIUS_KM) {
        Object.assign(cell, {
          level: fake.level,
          mild: fake.mild,
          possible: fake.possible,
          mm: fake.mm,
          probability: fake.probability,
          hourStart,
        })
      }
    }
  }
}
