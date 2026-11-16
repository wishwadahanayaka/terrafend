// Matches the DS division names in a landslide warning (lewm.ts) to the Survey Department's p-codes
// in ds-names.json, which scripts/build-areas.mjs writes from the same data as the app's boundaries.
// A name is looked for only in the district the warning puts it in. A name that can't be matched is
// reported, never dropped and never guessed.

import type { Level, LewmWarning } from './lewm.ts'

export type Gazetteer = {
  districts: { code: string; en: string }[]
  divisions: { code: string; district: string; en: string }[]
}

export type MatchedArea = {
  // The DS division's p-code (LK2209) and its district's (LK22)
  code: string
  district: string
  level: Level
  // As written in the warning, and the Survey Department's name it matched
  written: string
  name: string
  shift: number
  added: boolean
}

export type Unmatched = {
  level: Level
  district: string
  written: string
  why: string
}

export type Matched = { areas: MatchedArea[]; unmatched: Unmatched[] }

// How NBRO writes a name, where it differs from the Survey Department's: [district, as written, Survey name].
// Spellings that only differ by case, spaces, hyphens, "th"/"t" or a doubled letter match without being
// listed here (Hali_Ela is Hali-Ela, Yatiyanthota is Yatiyantota, Kotmale East is Kothmale East).
// Found in ten LEWMs from May to November 2026. Left out on purpose, because either answer would be a
// guess: "Kotmale" alone (Kothmale East or West?) and "Ratnapura-Ratnapura".
export const ALIASES: [district: string, written: string, survey: string][] = [
  ['Badulla', 'Meegahakivula', 'Meegahakiula'],
  ['Kandy', 'Udadumbara', 'Ududumbara'],
  ['Kandy', 'Kandy Four Gravets', 'Gangawata Korale'],
  ['Kandy', 'Kandy Four Gravets and Gangawata Korale', 'Gangawata Korale'],
  ['Kegalle', 'Aranayaka', 'Aranayake'],
  ['Kegalle', 'Bulathkohupitiya', 'Bulathkohipitiya'],
  ['Matale', 'Ambanganga Korale', 'Ambanganga'],
  ['Matara', 'Pitabeddara', 'Pitabaddara'],
  ['Monaragala', 'Bibila', 'Bibile'],
  ['Nuwara Eliya', 'Ambagamuwa', 'Ambagamuwa Korale'],
  ['Nuwara Eliya', 'Thalawalele', 'Thalawakele'],
  ['Ratnapura', 'Kuruwita', 'Kuruvita'],
  ['Ratnapura', 'Openayake', 'Opanayake'],
]

// District names as NBRO may write them ("Nuwaraeliya" needs no entry: spaces don't count)
export const DISTRICT_ALIASES: [written: string, survey: string][] = [['Moneragala', 'Monaragala']]

// Lowercase letters and digits only, "four" as 4, "th" as t, "dh" as d, and no doubled letters
export function nameKey(name: string): string {
  return name
    .normalize('NFKD')
    .toLowerCase()
    .replace(/\bfour\b/g, '4')
    .replace(/\b(ds|dsd|division|divisional secretariat)\b/g, '')
    .replace(/[^a-z0-9]/g, '')
    .replace(/th/g, 't')
    .replace(/dh/g, 'd')
    .replace(/(.)\1+/g, '$1')
}

// Every key a Survey name answers to: the whole name, and for "Vadamaradchi North (Point Pedro)" also
// the part outside and inside the brackets
function keysOf(name: string): string[] {
  const keys = [nameKey(name)]
  const bracket = /^(.*?)\s*\((.*)\)\s*$/.exec(name)
  if (bracket) keys.push(nameKey(bracket[1]), nameKey(bracket[2]))
  return [...new Set(keys.filter(Boolean))]
}

export type Index = {
  district: Map<string, string>
  division: Map<string, Map<string, { code: string; en: string }>>
  // A division key that appears in other districts, for the "found in" hint
  anywhere: Map<string, string[]>
}

export function indexOf(gazetteer: Gazetteer): Index {
  const district = new Map<string, string>()
  for (const d of gazetteer.districts) district.set(nameKey(d.en), d.code)
  for (const [written, survey] of DISTRICT_ALIASES) {
    const code = district.get(nameKey(survey))
    if (!code) throw new Error(`district alias ${written}: no district ${survey}`)
    district.set(nameKey(written), code)
  }
  const districtName = new Map(gazetteer.districts.map((d) => [d.code, d.en]))
  const division = new Map<string, Map<string, { code: string; en: string }>>()
  const anywhere = new Map<string, string[]>()
  for (const d of gazetteer.divisions) {
    const inDistrict = division.get(d.district) ?? new Map()
    division.set(d.district, inDistrict)
    for (const key of keysOf(d.en)) {
      const have = inDistrict.get(key)
      // Two divisions with the same key in one district couldn't be told apart: neither answers to it
      if (have && have.code !== d.code) throw new Error(`${d.en} and ${have.en} have the same key in ${d.district}`)
      inDistrict.set(key, { code: d.code, en: d.en })
      anywhere.set(key, [...(anywhere.get(key) ?? []), districtName.get(d.district) ?? d.district])
    }
  }
  for (const [districtName_, written, survey] of ALIASES) {
    const code = district.get(nameKey(districtName_))
    const target = code ? division.get(code)?.get(nameKey(survey)) : undefined
    if (!code || !target) throw new Error(`alias ${written}: no ${survey} in ${districtName_}`)
    division.get(code)!.set(nameKey(written), target)
  }
  return { district, division, anywhere }
}

export function matchNames(warning: LewmWarning, gazetteer: Gazetteer | Index): Matched {
  const index = 'districts' in gazetteer ? indexOf(gazetteer) : gazetteer
  const areas: MatchedArea[] = []
  const unmatched: Unmatched[] = []
  const levelOf = new Map<string, Level>()

  for (const level of [1, 2, 3] as Level[]) {
    for (const entry of warning.levels[level]) {
      const districtCode = index.district.get(nameKey(entry.district))
      if (!districtCode) {
        unmatched.push({ level, district: entry.district, written: entry.name, why: `no district called ${entry.district}` })
        continue
      }
      const found = index.division.get(districtCode)?.get(nameKey(entry.name))
      if (!found) {
        const elsewhere = index.anywhere.get(nameKey(entry.name))
        const why = elsewhere ? `not in ${entry.district}; a division with this name is in ${elsewhere.join(', ')}` : `no DS division of that name in ${entry.district}`
        unmatched.push({ level, district: entry.district, written: entry.name, why })
        continue
      }
      // The same division twice: fine at one level ("Kandy Four Gravets and Gangawata Korale" lists
      // it twice), but at two levels the warning contradicts itself
      const had = levelOf.get(found.code)
      if (had === level) continue
      if (had !== undefined) {
        unmatched.push({ level, district: entry.district, written: entry.name, why: `${found.en} is also at Level ${had}` })
        continue
      }
      levelOf.set(found.code, level)
      areas.push({ code: found.code, district: districtCode, level, written: entry.name, name: found.en, shift: entry.shift, added: entry.added })
    }
  }
  return { areas, unmatched }
}
