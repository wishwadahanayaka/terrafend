import { describe, expect, it } from 'vitest'
import { HOUR_MS, labelForHourEnd, type Hourly } from './openMeteo'
import { buildGrid, landGrid, pickWindow, rainMapState, type ForecastGrid } from './rainMap'

// 4 Nov 2026 is the day. Hour labels are Sri Lanka time, so "14:00" is 08:30 UTC.
const MIDNIGHT = Date.parse('2026-11-03T18:30:00Z') // 00:00 on the 4th in Sri Lanka
const at = (hour: number, minute = 0) => MIDNIGHT + hour * HOUR_MS + minute * 60_000
const label = (hour: number) => labelForHourEnd(MIDNIGHT + hour * HOUR_MS)

const CELLS = landGrid().cells.length

type Hour = { mm?: number; code?: number; chance?: number }

// Two days of hours from 00:00 on the 4th. `rain` puts weather into chosen cells and hour labels
// (hour 16 means the label "16:00"). Every other hour is dry.
function hourly(rain: Record<number, Record<number, Hour>> = {}): Hourly[] {
  const time = Array.from({ length: 48 }, (_, h) => label(h))
  return Array.from({ length: CELLS }, (_, cell) => ({
    time,
    precipitation: time.map((_, h) => rain[cell]?.[h]?.mm ?? 0),
    weather_code: time.map((_, h) => rain[cell]?.[h]?.code ?? 0),
    probability: time.map((_, h) => rain[cell]?.[h]?.chance ?? 10),
  }))
}

describe('keeping the forecast', () => {
  it('stores the hours once for all cells, from the current hour on', () => {
    const grid = buildGrid(hourly(), at(14, 15))
    // At 2:15 pm the first hour that matters is the one labelled 15:00
    expect(grid.times[0]).toBe(label(15))
    expect(grid.times[grid.times.length - 1]).toBe(label(47))
    expect(grid.cells).toHaveLength(CELLS)
    expect(grid.cells[0].mm).toHaveLength(grid.times.length)
    expect(grid.cells[0].code).toHaveLength(grid.times.length)
    expect(grid.cells[0].chance).toHaveLength(grid.times.length)
    expect(grid.fetchedAt).toBe(at(14, 15))
  })

  it('refuses an answer where the cells disagree about the hours', () => {
    const answer = hourly()
    answer[3] = { ...answer[3], time: answer[3].time.map((t, i) => (i === 5 ? 'odd' : t)) }
    expect(() => buildGrid(answer, at(14))).toThrow()
    expect(() => buildGrid([], at(14))).toThrow()
  })
})

describe('picking the next 3 hours', () => {
  // Heavy, certain rain in cell 0 at 16:00 (the hour 3 to 4 pm), and in cell 1 at 18:00
  const wet = hourly({
    0: { 16: { mm: 9, chance: 80 } },
    1: { 18: { mm: 20, chance: 90 } },
  })
  const grid = buildGrid(wet, at(14, 15))

  it('looks at the 3 hours ending at 3, 4 and 5 pm when it is 2:15 pm', () => {
    const map = pickWindow(grid, at(14, 15))!
    expect(map.cells[0].level).toBe('heavy')
    expect(map.cells[0].hourStart).toBe(at(15))
    // 18:00 is a fourth hour away
    expect(map.cells[1].level).toBeNull()
    expect(map.to).toBe(at(17))
    expect(map.from).toBe(at(14, 15))
  })

  it('moves on with the clock, using the same forecast', () => {
    // At 3:20 pm the window is 4, 5 and 6 pm: rain in cell 1 comes in, and cell 0's is still there
    const map = pickWindow(grid, at(15, 20))!
    expect(map.cells[0].level).toBe('heavy')
    expect(map.cells[1].level).toBe('veryHeavy')
    expect(map.cells[1].hourStart).toBe(at(17))
    expect(map.to).toBe(at(18))
  })

  it('drops rain that has passed', () => {
    // At 4:30 pm the window is 5, 6 and 7 pm, so the 4 pm rain in cell 0 is gone
    const map = pickWindow(grid, at(16, 30))!
    expect(map.cells[0].level).toBeNull()
    expect(map.cells[1].level).toBe('veryHeavy')
  })

  it('keeps every cell, dry ones too, in the order of the grid', () => {
    const map = pickWindow(grid, at(14, 15))!
    expect(map.cells).toHaveLength(CELLS)
    expect(map.cells[5]).toMatchObject({ level: null, mild: null, possible: null })
    const cells = landGrid().cells
    expect(map.cells[7].lat).toBe(cells[7].lat)
    expect(map.cells[7].lng).toBe(cells[7].lng)
  })

  it('applies the forecast rules to the hour it picks', () => {
    // A thunder code with too little rain is only "possible", and never a level
    const stormy = buildGrid(hourly({ 0: { 15: { mm: 1, code: 95, chance: 90 } } }), at(14, 15))
    const map = pickWindow(stormy, at(14, 15))!
    expect(map.cells[0].level).toBeNull()
    expect(map.cells[0].possible).toBe('thunderPossible')
  })
})

describe('when the forecast is too old to cover the next 3 hours', () => {
  // A forecast that reaches 17:00 (the hour 4 to 5 pm) and no further
  const short: ForecastGrid = (() => {
    const g = buildGrid(hourly(), at(14, 15))
    const keep = g.times.indexOf(label(17)) + 1
    return {
      ...g,
      times: g.times.slice(0, keep),
      cells: g.cells.map((c) => ({ mm: c.mm.slice(0, keep), code: c.code.slice(0, keep), chance: c.chance.slice(0, keep) })),
    }
  })()

  it('still works while the 3 hours are inside what was fetched', () => {
    // At 2:15 pm the window is 3, 4 and 5 pm: the last one that fits
    expect(pickWindow(short, at(14, 15))).not.toBeNull()
  })

  it('gives nothing once the window runs past the end', () => {
    // At 3:05 pm the window is 4, 5 and 6 pm, and 6 pm was never fetched
    expect(pickWindow(short, at(15, 5))).toBeNull()
  })

  it('gives nothing once the hours that were fetched have all gone by', () => {
    // Fetched at 2:15 pm on the 4th, it reaches 11 pm on the 5th. The window needs 3 hours of it.
    // The age limit is set aside here (fetchedAt follows the clock) to test the hours alone.
    const grid = buildGrid(hourly(), at(14, 15))
    const seenAt = (now: number) => pickWindow({ ...grid, fetchedAt: now }, now)
    expect(seenAt(at(24 + 20))).not.toBeNull() // 8 pm on the 5th: 9, 10 and 11 pm
    expect(seenAt(at(24 + 21, 30))).toBeNull() // 9:30 pm on the 5th: 10 pm, 11 pm and midnight
    expect(seenAt(at(24 + 30))).toBeNull() // 6 am on the 6th
  })

  it('gives nothing for a forecast from a different grid', () => {
    const odd: ForecastGrid = { ...buildGrid(hourly(), at(14)), cells: [] }
    expect(pickWindow(odd, at(14))).toBeNull()
  })
})

describe('what the screens are told', () => {
  const grid = buildGrid(hourly(), at(14, 15))
  const map = pickWindow(grid, at(14, 15))!
  const idle = { isError: false, isFetching: false, isPending: false }

  it('is a plain success when the last load worked', () => {
    expect(rainMapState(grid, map, idle)).toEqual({ status: 'success', data: map, olderFrom: null })
  })

  it('keeps the older forecast, with its time, after a failed refresh', () => {
    const state = rainMapState(grid, map, { ...idle, isError: true })
    expect(state).toEqual({ status: 'success', data: map, olderFrom: at(14, 15) })
  })

  it('has nothing to show when the older forecast no longer reaches the next 3 hours', () => {
    expect(rainMapState(grid, null, { ...idle, isError: true })).toEqual({ status: 'error', data: null, olderFrom: null })
  })

  it('says pending while a try is under way, and when nothing has loaded yet', () => {
    expect(rainMapState(grid, null, { ...idle, isError: true, isFetching: true }).status).toBe('pending')
    expect(rainMapState(undefined, null, { ...idle, isPending: true, isFetching: true }).status).toBe('pending')
  })

  it('says error when it never loaded and the try failed', () => {
    expect(rainMapState(undefined, null, { ...idle, isError: true })).toEqual({ status: 'error', data: null, olderFrom: null })
  })
})
