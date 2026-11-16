// For testing only. In the dev server, ?fakeLandslide= replaces the landslide warning with a made-up
// one, so the layer, the chip and the Layers panel can be tried on a dry day without the database
// or NBRO being involved. The areas are real DS divisions (their p-codes are looked up in the same
// names list the function uses), so they are drawn from the real boundaries.
//   level1      six Level 1 (Yellow) areas
//   level2      four Level 2 (Amber) areas
//   level3      three Level 3 (Red) areas
//   mixed       all three levels, with a raised, a lowered, a raised-by-two and a newly added area
//               (also what ?fakeLandslide or ?fakeLandslide= means)
//   unmatched   mixed, plus two names that could not be matched to a division
//   kegalle     one of each level, all in Kegalle district: Level 3 Aranayake, Level 2 Mawanella, Level 1
//               Ruwanwella, Galigamuwa and Kegalle. The Colombo to Mawanella test route (?fakeRouting=1)
//               passes through every one of them, so a route check shows all three kinds of line.
//   expired     a warning that ended 2 hours ago: "No active landslide warning"
//   unreadable  the newest warning could not be read
//   none        no warning stored
//   fail        the load fails
//   offline-expiry  mixed, valid for the next 2 minutes only (from the first time it is asked for):
//               load it, go offline in the browser's tools, and watch it run out without a refetch
// The answer is shaped like landslide_current()'s and goes through the same parseLandslide as a real
// one. Saved data is not touched: with any fake switch on, only the forecast is saved (see main.tsx).
// loadLandslide only loads this file inside an import.meta.env.DEV check, so the production build
// leaves it out.

import names from '../../supabase/functions/landslide-refresh/ds-names.json'
import { parseLandslide, type LandslideAnswer } from './landslide'

export const FAKE_LANDSLIDE_MODES = ['level1', 'level2', 'level3', 'mixed', 'unmatched', 'kegalle', 'expired', 'unreadable', 'none', 'fail', 'offline-expiry'] as const
export type FakeLandslideMode = (typeof FAKE_LANDSLIDE_MODES)[number]

// The mode asked for, or null when the switch is not in the address
export function fakeLandslideMode(search?: string): FakeLandslideMode | null {
  const query = search ?? (globalThis.location ? globalThis.location.search : '')
  const value = new URLSearchParams(query).get('fakeLandslide')
  if (value === null) return null
  const wanted = value.trim().toLowerCase()
  return FAKE_LANDSLIDE_MODES.find((m) => m === wanted) ?? 'mixed'
}

const MIN = 60_000
const HOUR = 60 * MIN

type Pick = { level: 1 | 2 | 3; district: string; division: string; shift?: number; added?: boolean }

const L1: Pick[] = [
  { level: 1, district: 'Badulla', division: 'Passara' },
  { level: 1, district: 'Badulla', division: 'Badulla' },
  { level: 1, district: 'Badulla', division: 'Ella' },
  { level: 1, district: 'Kandy', division: 'Udunuwara' },
  { level: 1, district: 'Kandy', division: 'Yatinuwara' },
  { level: 1, district: 'Nuwara Eliya', division: 'Norwood' },
]
const L2: Pick[] = [
  { level: 2, district: 'Kegalle', division: 'Mawanella' },
  { level: 2, district: 'Kegalle', division: 'Dehiowita' },
  { level: 2, district: 'Kegalle', division: 'Deraniyagala' },
  { level: 2, district: 'Nuwara Eliya', division: 'Ambagamuwa Korale' },
]
const L3: Pick[] = [
  { level: 3, district: 'Kegalle', division: 'Aranayake' },
  { level: 3, district: 'Ratnapura', division: 'Eheliyagoda' },
  { level: 3, district: 'Ratnapura', division: 'Kolonna' },
]
// One of each level along the Colombo to Mawanella test route
const KEGALLE: Pick[] = [
  { level: 3, district: 'Kegalle', division: 'Aranayake' },
  { level: 2, district: 'Kegalle', division: 'Mawanella' },
  { level: 1, district: 'Kegalle', division: 'Ruwanwella' },
  { level: 1, district: 'Kegalle', division: 'Galigamuwa' },
  { level: 1, district: 'Kegalle', division: 'Kegalle' },
]
// Every kind of change since the last message, one of each
const MIXED: Pick[] = [
  { level: 3, district: 'Kegalle', division: 'Aranayake', shift: 1 },
  { level: 3, district: 'Ratnapura', division: 'Eheliyagoda', shift: 2 },
  { level: 2, district: 'Kegalle', division: 'Mawanella', shift: -1 },
  { level: 2, district: 'Kegalle', division: 'Yatiyantota' },
  { level: 2, district: 'Nuwara Eliya', division: 'Ambagamuwa Korale' },
  { level: 1, district: 'Badulla', division: 'Passara' },
  { level: 1, district: 'Badulla', division: 'Badulla' },
  { level: 1, district: 'Badulla', division: 'Ella', added: true },
  { level: 1, district: 'Nuwara Eliya', division: 'Norwood' },
  { level: 1, district: 'Nuwara Eliya', division: 'Walapane' },
  { level: 1, district: 'Ratnapura', division: 'Balangoda' },
]

const districtCode = (en: string) => {
  const found = names.districts.find((d) => d.en === en)
  if (!found) throw new Error(`fakeLandslide: no district called ${en}`)
  return found.code
}
const divisionCode = (district: string, en: string) => {
  const found = names.divisions.find((d) => d.district === districtCode(district) && d.en === en)
  if (!found) throw new Error(`fakeLandslide: no DS division called ${en} in ${district}`)
  return found.code
}

function rowOf(p: Pick) {
  return {
    level: p.level,
    district: p.district,
    name: p.division,
    code: divisionCode(p.district, p.division),
    district_code: districtCode(p.district),
    shift: p.shift ?? 0,
    added: p.added ?? false,
    note: null,
  }
}

// Names the Survey Department's list can't match, as the function stores them
const UNMATCHED = [
  { level: 1, district: 'Nuwara Eliya', name: 'Kotmale', code: null, district_code: districtCode('Nuwara Eliya'), shift: 0, added: false, note: 'Kotmale is Kotmale East or West: not guessed' },
  { level: 2, district: 'Badulla', name: 'Nowhereville', code: null, district_code: districtCode('Badulla'), shift: 0, added: false, note: 'no DS division of that name in Badulla' },
]

// Fixed at the first call, so a refetch can't give the warning a fresh two minutes
let offlineExpiryAt: number | null = null

export function fakeLandslideAnswer(mode: FakeLandslideMode, now: number): LandslideAnswer {
  if (mode === 'fail') throw new Error('Landslide warnings unavailable (fake)')
  const listedAt = new Date(now - HOUR).toISOString()
  const pdfUrl = 'https://www.dmc.gov.lk/images/dmcreports/TEST_fake_landslide_warning.pdf'

  let raw: unknown
  if (mode === 'none') {
    raw = { found: false }
  } else if (mode === 'unreadable') {
    raw = { found: true, id: 1, message_id: null, update: null, issued_at: null, valid_from: null, valid_to: null, listed_at: listedAt, pdf_url: pdfUrl, parse_ok: false, valid: false, areas: [] }
  } else {
    const picks = mode === 'level1' ? L1 : mode === 'level2' ? L2 : mode === 'level3' ? L3 : mode === 'kegalle' ? KEGALLE : MIXED
    const areas = picks.map(rowOf)
    if (mode === 'unmatched') areas.push(...(UNMATCHED as unknown as ReturnType<typeof rowOf>[]))
    const issuedAt = now - 2 * HOUR
    let validTo = issuedAt + 24 * HOUR
    if (mode === 'expired') validTo = now - 2 * HOUR
    if (mode === 'offline-expiry') {
      offlineExpiryAt ??= now + 2 * MIN
      validTo = offlineExpiryAt
    }
    const validFrom = mode === 'expired' ? validTo - 24 * HOUR : issuedAt
    raw = {
      found: true,
      id: 1,
      message_id: 'LEWM-01-01-2026-1600-99',
      update: 99,
      issued_at: new Date(mode === 'expired' ? validFrom : issuedAt).toISOString(),
      valid_from: new Date(validFrom).toISOString(),
      valid_to: new Date(validTo).toISOString(),
      listed_at: listedAt,
      pdf_url: pdfUrl,
      parse_ok: true,
      // What the server would say. The app doesn't read it.
      valid: validTo > now,
      areas,
    }
  }
  const answer = parseLandslide(raw)
  if (!answer) throw new Error(`fakeLandslide: ${mode} did not pass parseLandslide`)
  return answer
}

// Lets a test start the offline-expiry clock again
export function resetFakeLandslide() {
  offlineExpiryAt = null
}
