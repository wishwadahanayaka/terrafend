import { HOUR_MS } from './openMeteo'
import { kmFrom } from './fakeRainMap'
import { lightRainVerdict } from './lightRain'
import { mildRain, rainLevel, type MildLevel, type RainLevel } from './rainForecast'
import { landGrid, onLand, rainScore, WINDOW_HOURS, type RainMap } from './rainMap'
import { satelliteCentre, SATELLITE_GRID, type GaugeRain, type SatelliteRain } from './rainMeasured'

const HALF_STEP = SATELLITE_GRID.step / 2

// One square on the rain map. It is either what the satellite measured in the past 3 hours
// or what the forecast says for the next 3, never a mix: the two are separate sets (see
// pastSquares and nextSquares), because they cover different times.
export type RainSquare = {
  lat: number
  lng: number
  halfLat: number
  halfLng: number
  level: RainLevel | null
  mild: MildLevel | null
  // Millimetres per hour, the heaviest hour
  mm: number | null
  // Chance of rain in percent. Only forecasts have one, so it's null for the satellite.
  probability: number | null
  source: 'satellite' | 'forecast'
  // The time the number covers: the satellite's 3 hours, or the forecast's one worst hour
  from: number
  to: number
  // The whole stretch of time the map's view covers: the satellite's 3 hours, or the 3 hours the
  // forecast looks ahead. This is what the card's tag shows.
  windowFrom: number
  windowTo: number
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

// The past 3 hours: what the satellite measured. Heavy and moderate rain is drawn as it is. A
// square that reads only LIGHT rain is drawn only when the light-rain rule (lightRain.ts) backs it
// up, because the satellite sometimes shows light rain on a dry night. The gauges are needed for
// that rule. null means there is no satellite data, which is not the same as no rain.
export function pastSquares(
  satellite: SatelliteRain | null,
  gauges: GaugeRain[],
  now: number,
): RainSquare[] | null {
  if (!satellite) return null
  const squares: RainSquare[] = []
  for (const spot of landSpots()) {
    const seen = satellite.mm[spot.index]
    if (seen === null) continue
    const level = rainLevel(seen, null)
    const mild = level ? null : mildRain(seen)
    if (!level && !mild) continue
    if (mild === 'light' && !lightRainVerdict(spot.index, spot.lat, spot.lng, satellite, gauges, now).show) continue

    squares.push({
      lat: spot.lat,
      lng: spot.lng,
      halfLat: HALF_STEP,
      halfLng: HALF_STEP,
      level,
      mild,
      mm: seen,
      probability: null,
      source: 'satellite',
      from: satellite.from,
      to: satellite.to,
      windowFrom: satellite.from,
      windowTo: satellite.to,
    })
  }
  return squares
}

// The next 3 hours: what the forecast says, on the same 0.1 degree squares. null means there
// is no forecast, which is not the same as no rain.
export function nextSquares(forecast: RainMap | null): RainSquare[] | null {
  if (!forecast) return null
  const squares: RainSquare[] = []
  for (const spot of landSpots()) {
    const expected = forecast.cells[spot.forecast]
    if (!expected || rainScore(expected.level, expected.mild) === 0) continue
    squares.push({
      lat: spot.lat,
      lng: spot.lng,
      halfLat: HALF_STEP,
      halfLng: HALF_STEP,
      level: expected.level,
      mild: expected.mild,
      mm: expected.mm,
      probability: expected.probability,
      source: 'forecast',
      from: expected.hourStart,
      to: expected.hourStart + HOUR_MS,
      windowFrom: forecast.to - WINDOW_HOURS * HOUR_MS,
      windowTo: forecast.to,
    })
  }
  return squares
}
