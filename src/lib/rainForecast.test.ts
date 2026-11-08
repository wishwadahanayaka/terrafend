import { describe, expect, it } from 'vitest'
import {
  FORECAST_MIN_PROBABILITY,
  forecastHour,
  forecastQuietText,
  forecastWord,
  mildRain,
  possibleText,
  rainLevel,
  THUNDER_MIN_MM,
  worstRain,
} from './rainForecast'

const warning = (level: string) => ({ level, mild: null, possible: null })
const possible = (p: string) => ({ level: null, mild: null, possible: p })
const mild = (m: string | null) => ({ level: null, mild: m, possible: null })

describe('forecast rules', () => {
  it('uses the agreed thresholds', () => {
    expect(FORECAST_MIN_PROBABILITY).toBe(60)
    expect(THUNDER_MIN_MM).toBe(7.5)
  })

  describe('thunderstorms (weather codes 95-99)', () => {
    it('warns with at least 7.5 mm and at least 60% chance', () => {
      expect(forecastHour(7.5, 95, 60)).toEqual(warning('thunder'))
      expect(forecastHour(20, 99, 95)).toEqual(warning('thunder'))
    })

    it('is only "possible" with too little rain', () => {
      expect(forecastHour(7.4, 95, 90)).toEqual(possible('thunderPossible'))
      expect(forecastHour(0, 96, 100)).toEqual(possible('thunderPossible'))
      expect(forecastHour(null, 95, 100)).toEqual(possible('thunderPossible'))
    })

    it('is only "possible" with too low a chance', () => {
      expect(forecastHour(20, 95, 59)).toEqual(possible('thunderPossible'))
    })

    it('treats a missing chance as low, never high', () => {
      expect(forecastHour(20, 95, null)).toEqual(possible('thunderPossible'))
    })
  })

  describe('heavy and very heavy rain', () => {
    it('warns from 7.5 mm (heavy) and 15 mm (very heavy) with at least 60% chance', () => {
      expect(forecastHour(7.5, 63, 60)).toEqual(warning('heavy'))
      expect(forecastHour(14.9, 63, 80)).toEqual(warning('heavy'))
      expect(forecastHour(15, 65, 60)).toEqual(warning('veryHeavy'))
    })

    it('becomes "heavy showers possible" below 60%, or with no chance given', () => {
      expect(forecastHour(10, 63, 59)).toEqual(possible('heavyShowers'))
      expect(forecastHour(30, 65, null)).toEqual(possible('heavyShowers'))
    })
  })

  describe('light and moderate rain', () => {
    it('goes by amount alone, whatever the chance', () => {
      expect(forecastHour(0.4, 61, 100)).toEqual(mild(null))
      expect(forecastHour(0.5, 61, 10)).toEqual(mild('light'))
      expect(forecastHour(2.4, 61, null)).toEqual(mild('light'))
      expect(forecastHour(2.5, 61, 10)).toEqual(mild('moderate'))
      expect(forecastHour(7.4, 61, 100)).toEqual(mild('moderate'))
    })

    it('is nothing at all when there is no data', () => {
      expect(forecastHour(null, null, null)).toEqual(mild(null))
    })
  })

  const near40 = { key: 'rain.where.near', params: { km: 40 } }

  it('words forecasts as "likely" or "possible", never as having happened', () => {
    expect(forecastWord(60)).toBe('likely')
    expect(forecastWord(59)).toBe('possible')
    expect(forecastWord(null)).toBe('possible')
    expect(forecastQuietText('light', near40, 70)).toBe('Light rain likely near 40 km')
    expect(forecastQuietText('moderate', near40)).toBe('Moderate rain possible near 40 km')
    expect(possibleText('thunderPossible', near40)).toBe('Thunderstorms possible near 40 km')
    expect(possibleText('heavyShowers', { key: 'rain.where.most' })).toBe(
      'Heavy showers possible along most of the route',
    )
  })
})

describe('measured rain levels', () => {
  it('needs no chance of rain, only the amount', () => {
    expect(rainLevel(7.4, null)).toBeNull()
    expect(rainLevel(7.5, null)).toBe('heavy')
    expect(rainLevel(15, null)).toBe('veryHeavy')
    expect(rainLevel(null, null)).toBeNull()
  })

  it('leaves heavy amounts to rainLevel, and unknown amounts unknown', () => {
    expect(mildRain(7.5)).toBeNull()
    expect(mildRain(null)).toBeNull()
    expect(mildRain(3)).toBe('moderate')
  })

  it('ranks thunder above very heavy above heavy', () => {
    expect(worstRain(['heavy', 'thunder', 'veryHeavy'])).toBe('thunder')
    expect(worstRain(['heavy', 'veryHeavy'])).toBe('veryHeavy')
    expect(worstRain([])).toBeNull()
  })
})
