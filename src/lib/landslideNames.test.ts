import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { readLewm, type Level, type LewmEntry, type LewmWarning, type PdfPage } from '../../supabase/functions/landslide-refresh/lewm.ts'
import { ALIASES, DISTRICT_ALIASES, indexOf, matchNames, nameKey, type Gazetteer } from '../../supabase/functions/landslide-refresh/names.ts'

// Matching the DS division names in NBRO's warnings to the Survey Department's p-codes. No network.

const ROOT = join(__dirname, '..', '..')
const gazetteer: Gazetteer = JSON.parse(readFileSync(join(ROOT, 'supabase', 'functions', 'landslide-refresh', 'ds-names.json'), 'utf8'))
const index = indexOf(gazetteer)
const FIXTURES = join(__dirname, 'fixtures', 'lewm')
const fromJson = (name: string): PdfPage[] => JSON.parse(readFileSync(join(FIXTURES, name), 'utf8')).pages

function warning(levels: Partial<Record<Level, LewmEntry[]>>): LewmWarning {
  return {
    parseOk: true,
    messageId: 'LEWM-14-11-2026-1600-09',
    update: 9,
    issuedAt: 0,
    validFrom: 0,
    validTo: 1,
    firstIssuedOn: null,
    previousMessageId: null,
    levels: { 1: [], 2: [], 3: [], ...levels },
  }
}
const entry = (district: string, name: string, shift = 0, added = false): LewmEntry => ({ district, name, shift, added })
const total = (w: LewmWarning) => w.levels[1].length + w.levels[2].length + w.levels[3].length

describe('the names list', () => {
  it('has the 25 districts and every DS division, built from the same data as the app boundaries', () => {
    expect(gazetteer.districts).toHaveLength(25)
    expect(gazetteer.divisions.length).toBeGreaterThanOrEqual(330)
  })

  it('can tell every DS division apart within its district, aliases included (indexOf would throw)', () => {
    expect(() => indexOf(gazetteer)).not.toThrow()
  })

  it('has aliases that point at a real division of the district they name, and are needed', () => {
    for (const [district, written, survey] of ALIASES) {
      const code = index.district.get(nameKey(district))!
      expect(code, district).toBeDefined()
      expect(gazetteer.divisions.some((d) => d.district === code && d.en === survey), `${survey} in ${district}`).toBe(true)
      // an alias whose spelling already matches would be noise
      expect(nameKey(written), written).not.toBe(nameKey(survey))
    }
    for (const [written, survey] of DISTRICT_ALIASES) {
      expect(gazetteer.districts.some((d) => d.en === survey), survey).toBe(true)
      expect(nameKey(written)).not.toBe(nameKey(survey))
    }
  })

  it('refuses an alias to a division that does not exist', () => {
    const broken: Gazetteer = { ...gazetteer, divisions: gazetteer.divisions.filter((d) => d.en !== 'Aranayake') }
    expect(() => indexOf(broken)).toThrow(/Aranayake/)
  })
})

describe('the name key', () => {
  it('ignores case, spaces, hyphens and underscores, "th" for "t", "dh" for "d" and doubled letters', () => {
    expect(nameKey('Hali_Ela')).toBe(nameKey('Hali-Ela'))
    expect(nameKey('Yatiyanthota')).toBe(nameKey('Yatiyantota'))
    expect(nameKey('Kotmale East')).toBe(nameKey('Kothmale East'))
    expect(nameKey('Haldumulla')).toBe(nameKey('Haldummulla'))
    expect(nameKey('Pasbage Korale')).toBe(nameKey('Pasbagekorale'))
    expect(nameKey('Galle Four Gravets')).toBe(nameKey('Galle 4 Gravets'))
    expect(nameKey('Mawanella DS')).toBe(nameKey('Mawanella'))
  })

  it('does not make different places the same', () => {
    expect(nameKey('Kothmale East')).not.toBe(nameKey('Kothmale West'))
    expect(nameKey('Weligama')).not.toBe(nameKey('Weligepola'))
    expect(nameKey('Ella')).not.toBe(nameKey('Hali-Ela'))
  })
})

describe('the real warnings: every DS name in the fixtures matches', () => {
  it('LEWM-14-11-2026-1600-09, name by name', () => {
    const w = readLewm(fromJson('LEWM-14-11-2026-1600-09.json'))
    if (!w.parseOk) throw new Error(w.reason)
    const m = matchNames(w, index)
    expect(m.unmatched).toEqual([])
    expect(m.areas.map((a) => [a.written, a.name, a.code, a.district, a.level, a.shift])).toEqual([
      ['Soranathota', 'Soranathota', 'LK8115', 'LK81', 1, -1],
      ['Hali_Ela', 'Hali-Ela', 'LK8124', 'LK81', 1, -1],
      ['Badulla', 'Badulla', 'LK8121', 'LK81', 1, -1],
      ['Bandarawela', 'Bandarawela', 'LK8133', 'LK81', 1, -1],
      ['Passara', 'Passara', 'LK8118', 'LK81', 1, -1],
      ['Ella', 'Ella', 'LK8136', 'LK81', 1, -1],
      ['Udunuwara', 'Udunuwara', 'LK2139', 'LK21', 1, 0],
      ['Yatinuwara', 'Yatinuwara', 'LK2136', 'LK21', 1, 0],
      ['Yatiyanthota', 'Yatiyantota', 'LK9227', 'LK92', 1, 0],
      ['Mawanella', 'Mawanella', 'LK9206', 'LK92', 1, 0],
      ['Aranayake', 'Aranayake', 'LK9209', 'LK92', 1, 0],
      ['Norwood', 'Norwood', 'LK2330', 'LK23', 1, 0],
      ['Ambagamuwa Korale', 'Ambagamuwa Korale', 'LK2315', 'LK23', 1, 0],
      ['Eheliyagoda', 'Eheliyagoda', 'LK9103', 'LK91', 1, 0],
      ['Weligepola', 'Weligepola', 'LK9145', 'LK91', 1, 0],
      ['Elapatha', 'Elapatha', 'LK9127', 'LK91', 1, 0],
      ['Ayagama', 'Ayagama', 'LK9130', 'LK91', 1, 0],
    ])
  })

  // Every name the two other fixtures spell differently from the Survey Department, and what it matched
  const RESPELLED: Record<string, string> = {
    Aranayaka: 'Aranayake',
    'Ambanganga Korale': 'Ambanganga',
    Ambagamuwa: 'Ambagamuwa Korale',
    Bibila: 'Bibile',
    Bulathkohupitiya: 'Bulathkohipitiya',
    Delthota: 'Deltota',
    Haldumulla: 'Haldummulla',
    Hali_Ela: 'Hali-Ela',
    Hanguranketha: 'Hanguranketa',
    Haputhale: 'Haputale',
    Kahawatta: 'Kahawattha',
    Kuruwita: 'Kuruvita',
    Mathugama: 'Matugama',
    'Pasbage Korale': 'Pasbagekorale',
    Pitabeddara: 'Pitabaddara',
    Thumpane: 'Tumpane',
    Udadumbara: 'Ududumbara',
    Yatiyanthota: 'Yatiyantota',
  }

  it.each([
    ['LEWM-18-10-2026-1800-20.json', 45],
    ['LEWM-14-05-2026-2200-08.json', 67],
  ])('%s: all %i names', (file, count) => {
    const w = readLewm(fromJson(file))
    if (!w.parseOk) throw new Error(w.reason)
    const m = matchNames(w, index)
    expect(m.unmatched).toEqual([])
    expect(m.areas).toHaveLength(count)
    for (const a of m.areas) {
      if (a.written.toLowerCase() === a.name.toLowerCase()) continue
      expect(RESPELLED[a.written], `${a.written} matched ${a.name}`).toBe(a.name)
    }
    // every area is in the district the warning put it in
    for (const a of m.areas) expect(a.code.startsWith(a.district)).toBe(true)
  })
})

describe('names that cannot be matched are reported, never dropped or guessed', () => {
  it('"Kotmale" alone (East or West?) and "Ratnapura-Ratnapura", both seen in a real warning', () => {
    const w = warning({ 1: [entry('Ratnapura', 'Ratnapura-Ratnapura')], 2: [entry('Nuwara Eliya', 'Kotmale'), entry('Ratnapura', 'Ratnapura')] })
    const m = matchNames(w, index)
    expect(m.areas.map((a) => a.name)).toEqual(['Ratnapura'])
    expect(m.unmatched).toEqual([
      { level: 1, district: 'Ratnapura', districtCode: 'LK91', written: 'Ratnapura-Ratnapura', shift: 0, added: false, why: 'no DS division of that name in Ratnapura' },
      { level: 2, district: 'Nuwara Eliya', districtCode: 'LK23', written: 'Kotmale', shift: 0, added: false, why: 'no DS division of that name in Nuwara Eliya' },
    ])
  })

  it('a division put under the wrong district, with a hint where it is', () => {
    const m = matchNames(warning({ 1: [entry('Kandy', 'Ella')] }), index)
    expect(m.areas).toEqual([])
    expect(m.unmatched[0].why).toMatch(/not in Kandy; a division with this name is in Badulla/)
  })

  it('a district that does not exist, and one written another way', () => {
    const m = matchNames(warning({ 1: [entry('Atlantis', 'Ella'), entry('Moneragala', 'Bibila')] }), index)
    expect(m.unmatched).toEqual([{ level: 1, district: 'Atlantis', districtCode: null, written: 'Ella', shift: 0, added: false, why: 'no district called Atlantis' }])
    expect(m.areas.map((a) => [a.name, a.district, a.districtName])).toEqual([['Bibile', 'LK82', 'Moneragala']])
  })

  it('the same division at two levels is a contradiction: the second is reported', () => {
    const m = matchNames(warning({ 1: [entry('Kegalle', 'Mawanella')], 3: [entry('Kegalle', 'Mawanella')] }), index)
    expect(m.areas.map((a) => [a.name, a.level])).toEqual([['Mawanella', 1]])
    expect(m.unmatched).toEqual([{ level: 3, district: 'Kegalle', districtCode: 'LK92', written: 'Mawanella', shift: 0, added: false, why: 'Mawanella is also at Level 1' }])
  })

  it('the same division twice at one level is one area ("Kandy Four Gravets and Gangawata Korale" splits in two)', () => {
    const m = matchNames(warning({ 2: [entry('Kandy', 'Kandy Four Gravets'), entry('Kandy', 'Gangawata Korale')] }), index)
    expect(m.areas.map((a) => a.name)).toEqual(['Gangawata Korale'])
    expect(m.unmatched).toEqual([])
  })

  it('accounts for every entry: matched, reported, or a repeat at the same level', () => {
    const w = warning({
      1: [entry('Badulla', 'Ella'), entry('Badulla', 'Nowhere'), entry('Kandy', 'Kandy Four Gravets'), entry('Kandy', 'Gangawata Korale')],
      2: [entry('Badulla', 'Ella'), entry('Kegalle', 'Aranayaka', 1, true)],
    })
    const m = matchNames(w, index)
    const repeats = 1
    expect(m.areas.length + m.unmatched.length + repeats).toBe(total(w))
    expect(m.areas.find((a) => a.written === 'Aranayaka')).toMatchObject({ name: 'Aranayake', shift: 1, added: true, level: 2 })
  })

  it('names in brackets match either part ("Point Pedro" is Vadamaradchi North)', () => {
    const m = matchNames(warning({ 1: [entry('Jaffna', 'Point Pedro'), entry('Jaffna', 'Uduvil')] }), index)
    expect(m.unmatched).toEqual([])
    expect(m.areas.map((a) => a.name)).toEqual(['Vadamaradchi North (Point Pedro)', 'Valikamam South (Uduvil)'])
  })
})
