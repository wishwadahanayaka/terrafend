import { describe, expect, it } from 'vitest'
import { gdacsDetails, insideRing, islandDistanceKm, judgeEvent, parseEvent, type GdacsTrack } from './gdacs'

// A GDACS feature with small, made-up sample values
function feature(props: Record<string, unknown> = {}, at: [number, number] = [77.0, 7.0]) {
  return {
    type: 'Feature',
    geometry: { type: 'Point', coordinates: at },
    properties: {
      eventtype: 'EQ',
      eventid: 1001,
      name: 'Earthquake in the Indian Ocean',
      alertlevel: 'Orange',
      episodealertlevel: 'Orange',
      iscurrent: 'true',
      fromdate: '2026-11-03T22:10:00',
      datemodified: '2026-11-04T01:00:00',
      affectedcountries: [],
      severitydata: { severity: 6.1, severitytext: 'Magnitude 6.1M, Depth:18km' },
      url: { report: 'https://www.gdacs.org/report.aspx?eventid=1001', geometry: null },
      ...props,
    },
  }
}

const judge = (raw: unknown, track: GdacsTrack | null = null) => judgeEvent(parseEvent(raw)!, track)

describe('parseEvent', () => {
  it('reads an event, with times in UTC', () => {
    const e = parseEvent(feature())!
    expect(e.id).toBe('EQ-1001')
    expect(e.level).toBe('Orange')
    expect(e.current).toBe(true)
    expect(e.from).toBe(Date.parse('2026-11-03T22:10:00Z'))
  })

  it('uses the level now, not the event peak', () => {
    expect(parseEvent(feature({ alertlevel: 'Red', episodealertlevel: 'Green' }))!.level).toBe('Green')
  })

  it('sees Sri Lanka in the affected countries', () => {
    const e = parseEvent(feature({ affectedcountries: [{ iso3: 'LKA', countryname: 'Sri Lanka' }] }))!
    expect(e.affectsSriLanka).toBe(true)
    expect(parseEvent(feature())!.affectsSriLanka).toBe(false)
  })

  it('skips unknown types and keeps only GDACS links', () => {
    expect(parseEvent(feature({ eventtype: 'XX' }))).toBeNull()
    expect(parseEvent(feature({ url: { report: 'javascript:alert(1)' } }))!.url).toBe('https://www.gdacs.org/')
  })
})

describe('relevance', () => {
  it('measures the distance to the island, 0 on it', () => {
    expect(islandDistanceKm(7.29, 80.63)).toBe(0)
    // 7 degrees north, 2.6 degrees of longitude west of the island's box: about 287 km
    expect(islandDistanceKm(7.0, 77.0)).toBeCloseTo(287, -1)
  })

  it('keeps events within 500 km', () => {
    const e = judge(feature())!
    expect(e).not.toBeNull()
    expect(e.distanceKm).toBeLessThan(500)
  })

  it('drops events further than 500 km', () => {
    expect(judge(feature({}, [70.0, 7.0]))).toBeNull()
  })

  it('keeps far events that affect Sri Lanka', () => {
    const e = judge(feature({ affectedcountries: [{ iso3: 'LKA', countryname: 'Sri Lanka' }] }, [70.0, 20.0]))
    expect(e).not.toBeNull()
  })

  describe('cyclones', () => {
    // About 870 km north-east of the island
    const far = feature({ eventtype: 'TC', eventid: 2002, name: 'Cyclone TEST' }, [88.0, 15.0])

    it('ignores a past track that crossed the island', () => {
      const track: GdacsTrack = {
        lines: [
          { forecast: false, points: [[7.5, 81.0], [15.0, 88.0]] },
          { forecast: true, points: [[15.0, 88.0], [20.0, 88.0]] },
        ],
        cone: [],
      }
      expect(judge(far, track)).toBeNull()
    })

    it('counts a forecast track heading for the island', () => {
      const track: GdacsTrack = {
        lines: [{ forecast: true, points: [[15.0, 88.0], [8.0, 82.5]] }],
        cone: [],
      }
      const e = judge(far, track)!
      expect(e).not.toBeNull()
      expect(e.distanceKm).toBeLessThan(100)
    })

    it('is 0 km away when the forecast area covers the island', () => {
      const cone: [number, number][] = [
        [5, 78],
        [5, 83],
        [11, 83],
        [11, 78],
        [5, 78],
      ]
      expect(judge(far, { lines: [], cone: [cone] })!.distanceKm).toBe(0)
    })

    it('is judged by where it is now when the track is missing', () => {
      expect(judge(far, null)).toBeNull()
      expect(judge(feature({ eventtype: 'TC' }, [82.5, 8.0]), null)).not.toBeNull()
    })
  })

  it('tells inside from outside a ring', () => {
    const square: [number, number][] = [
      [0, 0],
      [0, 10],
      [10, 10],
      [10, 0],
    ]
    expect(insideRing(5, 5, square)).toBe(true)
    expect(insideRing(15, 5, square)).toBe(false)
  })
})

describe('card details', () => {
  it('names Sri Lanka once, first in the list', () => {
    const e = judge(
      feature({
        affectedcountries: [
          { iso3: 'IND', countryname: 'India' },
          { iso3: 'LKA', countryname: 'Sri Lanka' },
        ],
      }),
    )!
    expect(gdacsDetails(e)).toContain('Affected: Sri Lanka, India')
  })
})
