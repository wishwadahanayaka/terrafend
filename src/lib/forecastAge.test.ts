import { describe, expect, it } from 'vitest'
import { FORECAST_MAX_AGE_MS, forecastTooOld } from './forecastAge'
import { HOUR_MS, labelForHourEnd, type Hourly } from './openMeteo'
import { buildGrid, landGrid, pickWindow } from './rainMap'

const MIN = 60_000
const FETCHED = Date.parse('2026-11-04T08:45:00Z') // 2:15 pm in Sri Lanka

describe('the age limit on a forecast', () => {
  it('is 6 hours', () => {
    expect(FORECAST_MAX_AGE_MS).toBe(6 * HOUR_MS)
  })

  it('shows a forecast of 5 h 59 min, and not one of 6 h 01 min', () => {
    expect(forecastTooOld(FETCHED, FETCHED + 5 * HOUR_MS + 59 * MIN)).toBe(false)
    expect(forecastTooOld(FETCHED, FETCHED + 6 * HOUR_MS + MIN)).toBe(true)
  })

  it('still shows one of exactly 6 hours, and a brand new one', () => {
    expect(forecastTooOld(FETCHED, FETCHED + 6 * HOUR_MS)).toBe(false)
    expect(forecastTooOld(FETCHED, FETCHED)).toBe(false)
  })
})

describe('the island forecast and its age', () => {
  // Hours for the 4th and 5th, so at 8:15 pm and 8:16 pm on the 4th the next 3 hours (9, 10 and
  // 11 pm) are all still inside what was fetched. Only the age limit tells the two times apart.
  const midnight = Date.parse('2026-11-03T18:30:00Z')
  const time = Array.from({ length: 48 }, (_, h) => labelForHourEnd(midnight + h * HOUR_MS))
  const cells = landGrid().cells.length
  const forecasts: Hourly[] = Array.from({ length: cells }, () => ({
    time,
    precipitation: time.map(() => 0),
    weather_code: time.map(() => 0),
    probability: time.map(() => 10),
  }))
  const grid = buildGrid(forecasts, FETCHED)

  it('is shown at 5 h 59 min old', () => {
    expect(pickWindow(grid, FETCHED + 5 * HOUR_MS + 59 * MIN)).not.toBeNull()
  })

  it('is not shown at 6 h 01 min old, though its hours still cover the next 3', () => {
    expect(pickWindow(grid, FETCHED + 6 * HOUR_MS + MIN)).toBeNull()
  })
})
