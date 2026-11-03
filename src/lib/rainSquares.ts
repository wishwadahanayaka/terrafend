import { HOUR_MS } from './openMeteo'
import { kmFrom } from './fakeRainMap'
import { mildRain, rainLevel, type MildLevel, type RainLevel } from './rainForecast'
import { landGrid, onLand, rainScore, type RainMap } from './rainMap'
import { satelliteCentre, SATELLITE_GRID, type SatelliteRain } from './rainMeasured'

const HALF_STEP = SATELLITE_GRID.step / 2

// One square on the rain map: the worse of what the satellite saw in the past 3 hours
// and what the forecast expects in the next 3, for the same patch of ground
export type RainSquare = {
  lat: number
  lng: number
  halfLat: number
  halfLng: number
  level: RainLevel | null
  mild: MildLevel | null
  // Millimetres per hour, the heaviest hour
  mm: number | null
  source: 'satellite' | 'forecast'
  // The time the number covers: the satellite's 3 hours, or the forecast's one hour
  from: number
  to: number
}

type Spot = { index: number; lat: number; lng: number; forecast: number }

let spots: Spot[] | null = null

// A square counts as land if its middle or any of its four corners passes the coastline
// check, so a coastal square with only part of itself on land (Colombo, Negombo, Galle)
// keeps its rain, and a square fully out at sea is still left out
function touchesLand(lat: number, lng: number): boolean {
  return [
    [0, 0],
    [HALF_STEP, HALF_STEP],
    [HALF_STEP, -HALF_STEP],
    [-HALF_STEP, HALF_STEP],
    [-HALF_STEP, -HALF_STEP],
  ].some(([dLat, dLng]) => onLand(lat + dLat, lng + dLng))
}

// The squares to draw: every satellite cell that touches land. Each one is paired
// with the forecast cell it falls in. Never changes, so it's built once.
function landSpots(): Spot[] {
  if (spots) return spots
  const forecastCells = landGrid().cells
  const found: Spot[] = []
  for (let index = 0; index < SATELLITE_GRID.nx * SATELLITE_GRID.ny; index++) {
    const [lat, lng] = satelliteCentre(index)
    if (!touchesLand(lat, lng)) continue

    // The forecast cell that contains this square's middle. A forecast cell only exists
    // where its own middle is on land, so on the coast there may be none, and then the
    // nearest one stands in.
    let forecast = forecastCells.findIndex(
      (c) => Math.abs(c.lat - lat) <= c.halfLat && Math.abs(c.lng - lng) <= c.halfLng,
    )
    if (forecast === -1) {
      let best = Infinity
      for (const [i, c] of forecastCells.entries()) {
        const km = kmFrom(lat, lng, [c.lat, c.lng])
        if (km < best) {
          best = km
          forecast = i
        }
      }
    }
    found.push({ index, lat, lng, forecast })
  }
  spots = found
  return found
}

// Either source can be missing (null), and the map then shows the other alone.
// A tie goes to the satellite, since it saw the rain and the forecast only expects it.
export function combineRain(forecast: RainMap | null, satellite: SatelliteRain | null): RainSquare[] {
  const squares: RainSquare[] = []
  for (const spot of landSpots()) {
    const seen = satellite?.mm[spot.index] ?? null
    const seenLevel = seen === null ? null : rainLevel(seen, null)
    const seenMild = seen === null || seenLevel ? null : mildRain(seen)

    const expected = forecast?.cells[spot.forecast]
    const useSatellite =
      rainScore(seenLevel, seenMild) >= rainScore(expected?.level ?? null, expected?.mild ?? null)

    const base = { lat: spot.lat, lng: spot.lng, halfLat: HALF_STEP, halfLng: HALF_STEP }
    if (useSatellite && satellite && rainScore(seenLevel, seenMild) > 0) {
      squares.push({
        ...base,
        level: seenLevel,
        mild: seenMild,
        mm: seen,
        source: 'satellite',
        from: satellite.from,
        to: satellite.to,
      })
    } else if (!useSatellite && expected) {
      squares.push({
        ...base,
        level: expected.level,
        mild: expected.mild,
        mm: expected.mm,
        source: 'forecast',
        from: expected.hourStart,
        to: expected.hourStart + HOUR_MS,
      })
    }
  }
  return squares
}
