import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import i18n, { setLanguage, t } from './index'
import { isLang, LANGUAGES, pickFirstLanguage } from './languages'
import en from './locales/en'
import si from './locales/si'
import ta from './locales/ta'
import { expiresIn, routeDuration, sriLankaClock, sriLankaTime, timeAgo } from '../lib/time'
import { hazardLabel, HAZARD_TYPES, severityLabel, SEVERITIES } from '../lib/hazards'

type Tree = { [key: string]: string | Tree }

// "rain.where.near" -> "near {{km}} km"
function flatten(tree: Tree, prefix = ''): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(tree)) {
    const path = prefix ? `${prefix}.${key}` : key
    if (typeof value === 'string') out[path] = value
    else Object.assign(out, flatten(value, path))
  }
  return out
}

const files = { en: flatten(en), si: flatten(si), ta: flatten(ta) }
const placeholders = (text: string) => [...text.matchAll(/\{\{\s*(\w+)\s*\}\}/g)].map((m) => m[1]).sort()

describe('translation files', () => {
  it('have exactly the same keys in English, Sinhala and Tamil', () => {
    const keys = Object.keys(files.en).sort()
    expect(Object.keys(files.si).sort()).toEqual(keys)
    expect(Object.keys(files.ta).sort()).toEqual(keys)
  })

  it('keep the same {{placeholders}} in every language', () => {
    for (const [key, english] of Object.entries(files.en)) {
      for (const lang of ['si', 'ta'] as const) {
        expect(placeholders(files[lang][key]), `${lang}: ${key}`).toEqual(placeholders(english))
      }
    }
  })

  it('have no empty text', () => {
    for (const [lang, strings] of Object.entries(files)) {
      for (const [key, text] of Object.entries(strings)) expect(text.trim(), `${lang}: ${key}`).not.toBe('')
    }
  })

  it('keep plural keys in pairs, one and other', () => {
    for (const [lang, strings] of Object.entries(files)) {
      for (const key of Object.keys(strings)) {
        if (key.endsWith('_one')) expect(strings[key.replace(/_one$/, '_other')], `${lang}: ${key}`).toBeDefined()
        if (key.endsWith('_other')) expect(strings[key.replace(/_other$/, '_one')], `${lang}: ${key}`).toBeDefined()
      }
    }
  })

  it('use Western digits only, never Tamil or other native digits', () => {
    const nativeDigits = /[௦-௯෦-෯]/
    for (const [lang, strings] of Object.entries(files)) {
      for (const [key, text] of Object.entries(strings)) expect(text, `${lang}: ${key}`).not.toMatch(nativeDigits)
    }
  })

  it('carry the review note at the top of the Sinhala and Tamil files', () => {
    for (const lang of ['si', 'ta']) {
      const head = readFileSync(join(__dirname, 'locales', `${lang}.ts`), 'utf8').slice(0, 600)
      expect(head, lang).toContain('NEEDS REVIEW BY A NATIVE SPEAKER')
    }
  })
})

// Every t('some.key') written in the code must exist, so a typo can't ship as a raw key
describe('keys used in the code', () => {
  function sourceFiles(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
      const path = join(dir, name)
      if (statSync(path).isDirectory()) return name === 'locales' ? [] : sourceFiles(path)
      return /\.(ts|tsx)$/.test(name) && !name.endsWith('.test.ts') ? [path] : []
    })
  }

  it('all exist in the English file', () => {
    const known = new Set(Object.keys(files.en))
    const exists = (key: string) =>
      known.has(key) || known.has(`${key}_one`) || [...known].some((k) => k.startsWith(`${key}_`))
    const missing: string[] = []
    for (const file of sourceFiles(join(__dirname, '..'))) {
      const text = readFileSync(file, 'utf8')
      for (const match of text.matchAll(/\bt\(\s*'([a-zA-Z0-9_.]+)'/g)) {
        if (!exists(match[1])) missing.push(`${file.split('src')[1]}: ${match[1]}`)
      }
    }
    expect(missing).toEqual([])
  })
})

describe('first visit language', () => {
  it('uses Sinhala for si and its variants', () => {
    expect(pickFirstLanguage(['si-LK'])).toBe('si')
    expect(pickFirstLanguage(['si'])).toBe('si')
    expect(pickFirstLanguage(['SI-lk', 'en-US'])).toBe('si')
  })

  it('uses Tamil for ta and its variants', () => {
    expect(pickFirstLanguage(['ta-LK'])).toBe('ta')
    expect(pickFirstLanguage(['ta-IN', 'en'])).toBe('ta')
    expect(pickFirstLanguage(['ta'])).toBe('ta')
  })

  it('uses English for English, other languages and an empty list', () => {
    expect(pickFirstLanguage(['en-US'])).toBe('en')
    expect(pickFirstLanguage(['en-GB', 'si-LK'])).toBe('en')
    expect(pickFirstLanguage(['fr-FR'])).toBe('en')
    expect(pickFirstLanguage([])).toBe('en')
    expect(pickFirstLanguage(undefined)).toBe('en')
    expect(pickFirstLanguage(null)).toBe('en')
    expect(pickFirstLanguage([''])).toBe('en')
  })

  it('lists the three languages, each with a name in its own script', () => {
    expect(LANGUAGES.map((l) => l.code)).toEqual(['en', 'si', 'ta'])
    expect(LANGUAGES.map((l) => l.name)).toEqual(['English', 'සිංහල', 'தமிழ்'])
    expect(isLang('si')).toBe(true)
    expect(isLang('fr')).toBe(false)
  })
})

describe('the app text in each language', () => {
  beforeAll(() => {
    i18n.addResourceBundle('si', 'translation', si)
    i18n.addResourceBundle('ta', 'translation', ta)
  })
  afterAll(async () => {
    await setLanguage('en', false)
  })

  it('says one and many in English', async () => {
    await setLanguage('en', false)
    expect(t('chip.river', { count: 1 })).toBe('1 river at flood level')
    expect(t('chip.river', { count: 2 })).toBe('2 rivers at flood level')
    expect(t('route.hazardsHeader', { count: 1, parts: 'x' })).toBe('1 hazard: x')
    expect(t('reroute.prompt', { count: 1 })).toContain('1 blocked road.')
    expect(t('reroute.prompt', { count: 3 })).toContain('3 blocked roads.')
  })

  it('picks the right plural in Tamil', async () => {
    await setLanguage('ta', false)
    expect(t('chip.river', { count: 1 })).toBe('வெள்ள மட்டத்தில் 1 ஆறு')
    expect(t('chip.river', { count: 3 })).toBe('வெள்ள மட்டத்தில் 3 ஆறுகள்')
  })

  it('words forecasts in the right context', async () => {
    await setLanguage('si', false)
    const where = 'X'
    expect(t('rain.forecastQuiet', { context: 'likely', label: 'L', where })).toContain('ඉඩ ඇත')
    expect(t('rain.forecastQuiet', { context: 'possible', label: 'L', where })).toContain('හැක')
  })

  for (const lang of ['en', 'si', 'ta'] as const) {
    it(`never shows a raw key or a blank in ${lang}`, async () => {
      await setLanguage(lang, false)
      const now = Date.parse('2026-11-04T06:30:00Z')
      const iso = (ms: number) => new Date(ms).toISOString()
      const texts = [
        timeAgo(iso(now - 20 * 60_000), now),
        timeAgo(iso(now - 3 * 3_600_000), now),
        timeAgo(iso(now - 2 * 86_400_000), now),
        timeAgo(iso(now - 5_000), now),
        expiresIn(iso(now + 5 * 3_600_000), now),
        expiresIn(iso(now + 45 * 60_000), now),
        expiresIn(iso(now - 1), now),
        routeDuration(10),
        routeDuration(2 * 3600),
        routeDuration(2 * 3600 + 24 * 60),
        sriLankaClock(Date.parse('2026-11-04T08:40:00Z')),
        sriLankaTime('2026-11-04T06:32:00Z'),
        ...HAZARD_TYPES.map((h) => hazardLabel(h.value)),
        ...SEVERITIES.map((s) => severityLabel(s.value)),
      ]
      for (const text of texts) {
        expect(text.trim()).not.toBe('')
        // A raw key looks like word.word, and an unfilled placeholder like {{name}}
        expect(text).not.toMatch(/^[a-z_]+(\.[a-zA-Z_]+)+$/)
        expect(text).not.toContain('{{')
      }
    })
  }

  it('keeps Western digits and the Sri Lanka clock in every language', async () => {
    // 2:10 pm in Sri Lanka
    const ms = Date.parse('2026-11-04T08:40:00Z')
    await setLanguage('en', false)
    expect(sriLankaClock(ms)).toBe('2:10 pm')
    await setLanguage('si', false)
    expect(sriLankaClock(ms)).toBe('2:10 ප.ව.')
    expect(sriLankaTime('2026-11-04T06:32:00Z')).toBe('2026 නොවැ 4, 12:02 ප.ව. (ශ්‍රී ලංකා වේලාව)')
    await setLanguage('ta', false)
    expect(sriLankaClock(ms)).toBe('2:10 பிற்பகல்')
    expect(sriLankaTime('2026-11-04T19:00:00Z')).toBe('5 நவ., 2026, 12:30 முற்பகல் (இலங்கை நேரம்)')
  })

  it('falls back to English for a key a language is missing', async () => {
    await setLanguage('si', false)
    expect(t('banner.notOfficial')).toContain('DMC')
    expect(i18n.t('no.such.key.anywhere', { defaultValue: 'fallback' })).toBe('fallback')
  })
})
