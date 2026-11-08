import { describe, expect, it } from 'vitest'
import en from '../i18n/locales/en'
import si from '../i18n/locales/si'
import ta from '../i18n/locales/ta'
import {
  EMERGENCY_LAST_CHECKED,
  EMERGENCY_NUMBERS,
  emergencyNumbers,
  FAKE_EMERGENCY_NUMBER,
  fakeEmergencyRequested,
  telHref,
  withFakeNumbers,
} from './emergencyNumbers'
import { dayMonthYear } from './time'

type Tree = { [key: string]: string | Tree }
function lookup(tree: Tree, path: string): string | undefined {
  let node: string | Tree | undefined = tree
  for (const part of path.split('.')) node = typeof node === 'object' ? node[part] : undefined
  return typeof node === 'string' ? node : undefined
}

// A short number is 3 or 4 digits. A full number is + and the country code and digits.
const SHORT_TEL = /^tel:\d{3,4}$/
const FULL_TEL = /^tel:\+\d{8,15}$/

describe('the emergency numbers list', () => {
  it('has exactly the numbers it should, and no others', () => {
    expect(EMERGENCY_NUMBERS.map((n) => n.number).sort()).toEqual(
      ['117', '119', '110', '1990', '+94112136222', '+94112670002', '+94112421820'].sort(),
    )
  })

  it('puts 117 first', () => {
    expect(EMERGENCY_NUMBERS[0].number).toBe('117')
    expect(EMERGENCY_NUMBERS[0].group).toBe('short')
  })

  it('makes a valid tel: value for every number', () => {
    for (const n of EMERGENCY_NUMBERS) {
      expect(telHref(n.number), n.id).toMatch(n.group === 'short' ? SHORT_TEL : FULL_TEL)
    }
  })

  it('keeps short codes short and landlines in the full Sri Lankan form', () => {
    for (const n of EMERGENCY_NUMBERS) {
      if (n.group === 'short') expect(n.number, n.id).toMatch(/^\d{3,4}$/)
      else expect(n.number, n.id).toMatch(/^\+94\d{9}$/)
    }
  })

  it('writes each number on the screen as the same digits the phone dials', () => {
    for (const n of EMERGENCY_NUMBERS) {
      expect(n.display.replace(/\s/g, ''), n.id).toBe(n.number)
    }
  })

  it('has a unique id and a source with a web address for each', () => {
    const ids = EMERGENCY_NUMBERS.map((n) => n.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const n of EMERGENCY_NUMBERS) {
      expect(n.source.url, n.id).toMatch(/^https:\/\//)
      expect(n.source.label, n.id).not.toBe('')
      expect(['official', 'secondary']).toContain(n.source.kind)
    }
  })

  it('names every service in English, Sinhala and Tamil', () => {
    for (const n of EMERGENCY_NUMBERS) {
      for (const [name, tree] of [['en', en], ['si', si], ['ta', ta]] as const) {
        expect(lookup(tree as unknown as Tree, n.nameKey), `${n.id} in ${name}`).toBeTruthy()
      }
    }
  })

  it('has a last-checked date that is a real day, 8 Nov 2026', () => {
    expect(EMERGENCY_LAST_CHECKED).toBe('2026-11-08')
    expect(Number.isNaN(Date.parse(EMERGENCY_LAST_CHECKED))).toBe(false)
    expect(dayMonthYear(EMERGENCY_LAST_CHECKED)).toBe('8 Nov 2026')
  })
})

describe('the dev test switch ?fakeEmergency=1', () => {
  it('is only on for fakeEmergency=1', () => {
    expect(fakeEmergencyRequested('?fakeEmergency=1')).toBe(true)
    expect(fakeEmergencyRequested('?a=1&fakeEmergency=1')).toBe(true)
    expect(fakeEmergencyRequested('?fakeEmergency=0')).toBe(false)
    expect(fakeEmergencyRequested('?fakeEmergency')).toBe(false)
    expect(fakeEmergencyRequested('')).toBe(false)
  })

  it('swaps every number for 0000000000, on screen and in the tel: link', () => {
    const fake = withFakeNumbers(EMERGENCY_NUMBERS)
    expect(fake).toHaveLength(EMERGENCY_NUMBERS.length)
    for (const n of fake) {
      expect(n.number).toBe(FAKE_EMERGENCY_NUMBER)
      expect(n.display).toBe('0000000000')
      expect(telHref(n.number)).toBe('tel:0000000000')
    }
  })

  it('leaves the real list alone', () => {
    withFakeNumbers(EMERGENCY_NUMBERS)
    expect(EMERGENCY_NUMBERS[0].number).toBe('117')
  })

  it('gives the real numbers when the switch is not on', () => {
    // No page address here, so no switch: the list is the real one
    expect(emergencyNumbers()).toBe(EMERGENCY_NUMBERS)
  })
})
