import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { HAZARDS, KEYWORDS, type Lists } from '../../supabase/functions/news-refresh/keywords'
import { detectLanguage, forMatching, judge, KEEP_SCORE } from '../../supabase/functions/news-refresh/logic'

// Every headline here is made up. They copy the shape of real ones, never their words.

const LINK = 'https://www.example-news.lk/news/12345'
const keep = (title: string, lang: 'en' | 'si' | 'ta', url = LINK) => judge(title, url, lang)

describe('English headlines', () => {
  it.each([
    ['Flooding cuts off villages near Kalutara after a night of downpours', 'flood'],
    ['Landslide warning extended to four districts', 'landslide'],
    ['Low-pressure area likely to bring showers to the island', 'cyclone'],
    ['Heavy rain over Sabaragamuwa tonight, says weather office', 'rain'],
    ['Fishermen told to stay ashore as rough seas forecast', 'wind_sea'],
    ['Families evacuated as river overflows in Ratnapura', 'flood'],
    ['Wild elephant attack leaves farmer injured in Ampara', 'elephant'],
    // Two hazards: the one earlier in HAZARDS wins
    ['Rain and wind warning issued for the southern coast', 'wind_sea'],
    ['Tsunami drill planned for coastal schools', 'tsunami'],
    ['Fallen tree blocks Kandy road for three hours', 'road'],
  ] as const)('keeps "%s" as %s', (title, hazard) => {
    const v = keep(title, 'en')
    expect(v.keep).toBe(true)
    expect(v.score).toBeGreaterThanOrEqual(KEEP_SCORE)
    expect(v.hazard).toBe(hazard)
  })

  it.each([
    'A flood of investment reaches the port city',
    'Opposition storms out of parliament over the budget',
    'Rain stops play as the cricket final is washed out',
    'Floods leave dozens dead in Spain',
    'Lawmakers call for new laws to protect tuskers',
    'Police issue warning and alert about online scams',
    'Treating depression: new mental health clinic opens',
    'Spinners storm through the batting order',
    'Budget debate enters its third day',
  ])('drops "%s"', (title) => {
    expect(keep(title, 'en').keep).toBe(false)
  })

  it('keeps a cyclone near India: storms in the Bay of Bengal can still reach the island', () => {
    expect(keep('Cyclone off the coast of India may bring rain to the north', 'en').keep).toBe(true)
  })

  it('keeps a foreign word when Sri Lanka or a district is named too', () => {
    expect(keep('Indian navy helps with flood relief in Mannar', 'en').keep).toBe(true)
  })

  it('drops anything linked from a world or international section, whatever it says', () => {
    expect(keep('Flooding in the valley forces evacuations', 'en', 'https://www.example-news.lk/international/flooding-123').keep).toBe(false)
    expect(keep('Flooding in the valley forces evacuations', 'en', 'https://www.example-news.lk/world/flooding-123').keep).toBe(false)
  })

  it('matches whole words only', () => {
    // "gale" is not in Galle, "flood" is not in floodlight
    expect(keep('Galle stadium floodlights repaired', 'en').keep).toBe(false)
    // and a * term takes its endings
    expect(keep('Residents evacuated overnight', 'en').matched).toContain('+evacuat')
  })

  it('needs an incident word before an elephant counts as strong', () => {
    expect(keep('Elephant herd seen near the reservoir', 'en').keep).toBe(true) // weak elephant + weak reservoir
    expect(keep('Elephant census begins next week', 'en').keep).toBe(false)
    expect(keep('Train hits wild elephant near Habarana', 'en').hazard).toBe('elephant')
  })

  it('says why, for tuning', () => {
    const v = keep('Rain stops play as the cricket final is washed out', 'en')
    expect(v.matched).toEqual(expect.arrayContaining(['~rain', '-cricket']))
  })
})

describe('Sinhala headlines (made up; the list needs native review)', () => {
  it.each([
    ['කළුතර දිස්ත්‍රික්කයේ ගංවතුර තත්ත්වයක්', 'flood'],
    ['නායයෑම් අනතුරු ඇඟවීම් දිස්ත්‍රික්ක හතරකට', 'landslide'],
    ['බෙංගාල බොක්කේ අඩු පීඩන කලාපයක්', 'cyclone'],
    ['පළාත් කිහිපයකට තද වැසි', 'rain'],
    ['වල් අලි ප්‍රහාරයෙන් ගොවියෙකු තුවාල ලබයි', 'elephant'],
  ] as const)('keeps "%s" as %s', (title, hazard) => {
    const v = keep(title, 'si')
    expect(v.keep).toBe(true)
    expect(v.hazard).toBe(hazard)
  })

  it.each([
    'ගම්වැසියන් හමුවක් පවත්වයි', // residents (වැසියන්) is not rain (වැසි)
    'ක්‍රිකට් තරගයට වැසි බාධා',
    'රුපියල් මිලියන 500ක ව්‍යාපෘතියක්',
    'අලි සංරක්ෂණය ගැන සාකච්ඡාවක්',
  ])('drops "%s"', (title) => {
    expect(keep(title, 'si').keep).toBe(false)
  })

  it('matches whether or not the zero-width joiner was typed', () => {
    const withJoiner = 'වල් අලි ප්‍රහාරයක්'
    const without = withJoiner.replace(/‍/g, '')
    expect(without).not.toBe(withJoiner)
    expect(keep(withJoiner, 'si').hazard).toBe('elephant')
    expect(keep(without, 'si').hazard).toBe('elephant')
  })
})

describe('Tamil headlines (made up; the list needs native review)', () => {
  it.each([
    ['மட்டக்களப்பில் வெள்ளப்பெருக்கு', 'flood'],
    ['மண்சரிவு அபாய எச்சரிக்கை நீடிப்பு', 'landslide'],
    ['வங்கக்கடலில் தாழமுக்கம் உருவாகிறது', 'cyclone'],
    ['மீனவர்கள் கடலுக்குச் செல்ல வேண்டாம் என எச்சரிக்கை', 'wind_sea'],
    ['காட்டு யானை தாக்கி ஒருவர் பலி', 'elephant'],
  ] as const)('keeps "%s" as %s', (title, hazard) => {
    const v = keep(title, 'ta')
    expect(v.keep).toBe(true)
    expect(v.hazard).toBe(hazard)
  })

  it.each([
    'வெள்ளிக்கிழமை விசேட கூட்டம்', // Friday, not a flood
    'வெள்ளை வான் தொடர்பில் விசாரணை', // white, not a flood
    'கிரிக்கெட் போட்டி மழையால் பாதிப்பு',
    'யானை பாதுகாப்பு தொடர்பில் கலந்துரையாடல்',
    'சீனி விலை குறைப்பு',
  ])('drops "%s"', (title) => {
    expect(keep(title, 'ta').keep).toBe(false)
  })

  it('matches words whose ending changes the last letter (கடல் → கடலுக்கு, புயல் → புயலால்)', () => {
    expect(keep('கடலுக்குச் செல்ல வேண்டாம் என மீனவர்களுக்கு அறிவிப்பு', 'ta').matched).toContain('~கடல')
    expect(keep('புயலால் பல வீடுகள் சேதம்', 'ta').hazard).toBe('cyclone')
    expect(keep('மண்சரிவில் சிக்கிய வீடு', 'ta').hazard).toBe('landslide')
  })
})

describe('reading the language from the letters', () => {
  it('tells the three apart, and goes by the larger share in a mixed headline', () => {
    expect(detectLanguage('Heavy rain tonight')).toBe('en')
    expect(detectLanguage('තද වැසි')).toBe('si')
    expect(detectLanguage('கனமழை')).toBe('ta')
    expect(detectLanguage('DMC: තද වැසි අනතුරු ඇඟවීමක්')).toBe('si')
    expect(detectLanguage('')).toBe('en')
  })

  it('lowercases, joins letter forms and drops joiners before matching', () => {
    expect(forMatching('HEAVY   Rain')).toBe('heavy rain')
    expect(forMatching('ශ්‍රී')).toBe('ශ්රී')
  })
})

describe('the lists themselves', () => {
  const langs = Object.entries(KEYWORDS) as ['en' | 'si' | 'ta', Lists][]

  it('have no empty, padded or repeated words', () => {
    for (const [lang, lists] of langs) {
      for (const [name, list] of Object.entries(lists)) {
        const words = (list as (string | readonly [string, string])[]).map((w) => (typeof w === 'string' ? w : w[0]))
        expect(words.length, `${lang}.${name}`).toBeGreaterThan(0)
        for (const w of words) expect(w, `${lang}.${name}`).toBe(w.trim())
        for (const w of words) expect(w.length, `${lang}.${name}`).toBeGreaterThan(1)
        expect(new Set(words).size, `${lang}.${name} has a repeat`).toBe(words.length)
      }
    }
  })

  it('never puts a word in both strong and weak', () => {
    for (const [lang, lists] of langs) {
      const strong = new Set(lists.strong.map(([w]) => w))
      for (const [w] of lists.weak) expect(strong.has(w), `${lang}: ${w}`).toBe(false)
    }
  })

  it('only name hazards the database allows', () => {
    const sql = readFileSync(join(__dirname, '..', '..', 'supabase', 'migrations', '0010_news_feed.sql'), 'utf8')
    const allowed = /hazard\s+text not null check \(hazard in \(([^)]*)\)\)/.exec(sql)?.[1]
    const inSql = (allowed ?? '').split(',').map((s) => s.trim().replace(/'/g, ''))
    expect(inSql).toEqual(HAZARDS)
    for (const [, lists] of langs) for (const [, h] of [...lists.strong, ...lists.weak]) expect(HAZARDS).toContain(h)
  })

  it('carry the native review note for Sinhala and Tamil', () => {
    const file = readFileSync(join(__dirname, '..', '..', 'supabase', 'functions', 'news-refresh', 'keywords.ts'), 'utf8')
    expect(file.match(/NEEDS REVIEW BY A NATIVE SPEAKER/g)?.length).toBeGreaterThanOrEqual(3)
  })

  it('keep the words that would be traps out of the lists', () => {
    // வெள்ள on its own also starts வெள்ளை (white) and வெள்ளி (Friday)
    expect(KEYWORDS.ta.strong.map(([w]) => w)).not.toContain('வெள்ள')
    // "us" is also the English word "us"
    expect(KEYWORDS.en.foreign).not.toContain('us')
    // காலி (Galle) also means "empty" in Tamil
    expect(KEYWORDS.ta.home).not.toContain('காலி')
  })
})
